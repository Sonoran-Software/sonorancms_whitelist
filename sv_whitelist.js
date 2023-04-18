const utils = require("./sh_utils");
const fetch = require('node-fetch');
const { unwatchFile } = require("fs");
let activePlayers = {};
let apiKey, communityId, apiUrl, serverId, apiIdType, debugMode

RegisterNetEvent('SonoranCMS::Plugins::GiveInfo')
on('SonoranCMS::Plugins::GiveInfo', async (pluginName, payload) => {
	if (pluginName !== GetCurrentResourceName()) return;
	apiKey = payload.apiKey
	communityId = payload.communityId
	apiUrl = payload.apiUrl
	serverId = payload.serverId
	apiIdType = payload.apiIdType
	debugMode = payload.debugMode

})

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

on('SonoranCMS::Started', async () => {
    utils.infoLog('sonorancms core has been (re)started! reinitializing addon!')
    initialize()
})

async function initialize() {
	if (GetResourceState('sonorancms') != "started") {
		utils.errorLog('SonoranCMS Core Is Not Started! Not loading addon...')
	} else {
		TriggerEvent("sonorancms::RegisterPushEvent", "ACCOUNT_UPDATED", "sonoran_whitelist::rankupdate")
		utils.infoLog("Checking resource version...");
		TriggerEvent('SonoranCMS::Plugins::Loaded', GetCurrentResourceName())
		await sleep(2000)
		let backup = JSON.parse(
			LoadResourceFile(GetCurrentResourceName(), "backup.json")
		);
		updateBackup();
		RegisterNetEvent('sonoran_whitelist::rankupdate')
		on(
			'sonoran_whitelist::rankupdate',
			async (data) => {
				const accountID = data.data.accId;
				if (activePlayers[accountID]) {
					let apiId;
					apiId = getAppropriateIdentifier(
						activePlayers[accountID],
						apiIdType.toLowerCase()
					);
					if (!apiId)
						return utils.errorLog(
							`Could not find the correct API ID to cross check with the whitelist... Requesting type: ${apiIdType.toUpperCase()}`
						);
					if (data.key === apiKey) {
						exports.sonorancms.checkCMSWhitelist(apiId, function (whitelist) {
							if (whitelist.success) {
								utils.infoLog(
									`After role update, ${data.data.accName} (${accountID}) is still whitelisted, username returned: ${JSON.stringify(whitelist.reason)} `
								);
							} else {
								DropPlayer(activePlayers[accountID], 'After SonoranCMS role update, you were no longer whitelisted: ' + utils.apiMsgToEnglish(whitelist.reason.message))
								utils.infoLog(
									`After SonoranCMS role update ${data.data.accName} (${accountID}) was no longer whitelisted, reason returned: ${utils.apiMsgToEnglish(whitelist.reason.message)}`
								);
								activePlayers[accountID] = null
							}
						})
					}
				}
			}
		);
		on(
			"playerConnecting",
			async (name, setNickReason, deferrals) => {
				const src = global.source;
				let apiId;
				deferrals.defer();
				deferrals.update(
					"Grabbing API ID to check against the whitelist..."
				);
				apiId = getAppropriateIdentifier(
					src,
					apiIdType.toLowerCase()
				);
				if (!apiId)
					return utils.errorLog(
						`Could not find the correct API ID to cross check with the whitelist... Requesting type: ${apiIdType.toUpperCase()}`
					);
				deferrals.update("Checking whitelist...");
				updateBackup();
				await exports.sonorancms.checkCMSWhitelist(apiId, function (whitelist) {
					if (whitelist.success) {
						deferrals.done();
						utils.infoLog(
							`Successfully allowed ${name} (${apiId}) through whitelist, username returned: ${JSON.stringify(whitelist.reason)} `
						);
						exports.sonorancms.performApiRequest([{ "apiId": apiId, }], "GET_COM_ACCOUNT", function (data) {
							activePlayers[data[0].accId] = src
						})
					} else {
						deferrals.done(
							`Failed whitelist check: ${utils.apiMsgToEnglish(whitelist.reason.message)} \n\nAPI ID used to check: ${apiId}`
						);
						utils.infoLog(
							`Denied ${name} (${apiId}) through whitelist, reason returned: ${utils.apiMsgToEnglish(whitelist.reason.message)}`
						);
					}
				})
			}
		);
		setInterval(() => { updateBackup() }, 1800000);
	}
}

function updateBackup() {
	exports.sonorancms.getFullWhitelist(function (fullWhitelist) {
		if (fullWhitelist.success) {
			const idArray = [];
			fullWhitelist.data.forEach((fW) => {
				idArray.push(...fW.apiIds);
			});
			backup = idArray;
			SaveResourceFile(
				GetCurrentResourceName(),
				"backup.json",
				JSON.stringify(backup)
			);
		}
	});
}

function getAppropriateIdentifier(sourcePlayer, type) {
	const identifiers = getPlayerIdentifiers(sourcePlayer);
	let properIdentifiers = {
		discord: "",
		steam: "",
		license: ""
	};
	identifiers.forEach((identifier) => {
		const splitIdentifier = identifier.split(":");
		const identType = splitIdentifier[0];
		const identId = splitIdentifier[1];
		switch (identType) {
			case "discord":
				properIdentifiers.discord = identId;
				break;
			case "steam":
				properIdentifiers.steam = identId;
				break;
			case "license":
				properIdentifiers.license = identId;
				break;
		}
	});

	if (properIdentifiers[type] === "") {
		return null;
	} else {
		return properIdentifiers[type];
	}
}

initialize();