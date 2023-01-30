const utils = require("./sh_utils");
const fetch = require('node-fetch');
const { unwatchFile } = require("fs");
let APIKey = '';
let activePlayers = {};
async function initialize() {
	if (GetResourceState('sonorancms') != "started") {
		utils.errorLog('SonoranCMS Core Is Not Started!')
	} else {
		APIKey = GetConvar("SONORAN_CMS_API_KEY")
		TriggerEvent("sonorancms::RegisterPushEvent", "ACCOUNT_UPDATED", "sonoran_whitelist::rankupdate")
	}

	let config = false;
	utils.infoLog("Checking resource version...");
	await utils.checkVersion(
		GetResourceMetadata(GetCurrentResourceName(), "git_repo"),
		GetResourceMetadata(GetCurrentResourceName(), "version")
	);
	try {
		config = require("./config.json");
	} catch (err) {
		if (err) {
			const apiKey = GetConvar("SONORAN_CMS_API_KEY", "unknown");
			const communityId = GetConvar(
				"SONORAN_CMS_COMMUNITY_ID",
				"unknown"
			);
			const serverId = GetConvar("SONORAN_CMS_SERVER_ID", 1);
			const apiIdType = GetConvar("SONORAN_CMS_API_ID_TYPE", "unknown");
			const cmsApiUrl = GetConvar(
				"SONORAN_CMS_API_URL",
				"https://api.sonorancms.com"
			);

			if (!config) {
				if (
					apiKey !== "unknown" &&
					communityId !== "unknown" &&
					apiIdType !== "unknown"
				) {
					config = {
						apiKey,
						communityId,
						serverId,
						apiIdType,
						apiUrl: cmsApiUrl
					};
				}
			} else {
				utils.errorLog(JSON.stringify(err));
			}
		}
	}

	if (config) {
		if (
			config.apiIdType.toLowerCase() !== "discord" &&
			config.apiIdType.toLowerCase() !== "steam" &&
			config.apiIdType.toLowerCase() !== "license"
		) {
			utils.errorLog(
				'Invalid apiIdType given, must be "discord", "steam", or "license".'
			);
		} else {
			const Sonoran = require("@sonoransoftware/sonoran.js");
			utils.infoLog("Initializing Sonoran Whitelist...");
			const instance = new Sonoran.Instance({
				communityId: config.communityId,
				apiKey: config.apiKey,
				serverId: config.serverId,
				product: Sonoran.productEnums.CMS,
				cmsApiUrl: config.apiUrl
			});

			let backup = JSON.parse(
				LoadResourceFile(GetCurrentResourceName(), "backup.json")
			);

			instance.on("CMS_SETUP_SUCCESSFUL", () => {
				if (instance.cms.version < 2)
					return utils.errorLog(
						`Subscription version too low to use Sonoran Whitelist effectively... Current Sub Version: ${utils.subIntToName(
							instance.cms.version
						)} (${instance.cms.version
						}) | Needed Sub Version: ${utils.subIntToName(2)} (2)`
					);
				utils.infoLog(
					`Sonoran Whitelist Setup Successfully! Current Sub Version: ${utils.subIntToName(
						instance.cms.version
					)} (${instance.cms.version})`
				);

				updateBackup(config);

				RegisterNetEvent('sonoran_whitelist::rankupdate')
				on(
					'sonoran_whitelist::rankupdate',
					async (data) => {
						const accountID = data.data.accId;
						if (activePlayers[accountID]) {
							let apiId;
							apiId = getAppropriateIdentifier(
								activePlayers[accountID],
								config.apiIdType.toLowerCase()
							);
							if (!apiId)
								return utils.errorLog(
									`Could not find the correct API ID to cross check with the whitelist... Requesting type: ${config.apiIdType.toUpperCase()}`
								);
							if (data.key === APIKey) {
								await instance.cms
									.verifyWhitelist(apiId)
									.then((whitelist) => {
										if (whitelist.success) {
											utils.infoLog(
												`After role update, ${data.data.accName} (${accountID}) is still whitelisted, username returned: ${JSON.stringify(whitelist.reason.msg)} `
											);
										} else {
											DropPlayer(activePlayers[accountID], 'After SonoranCMS role update, you were no longer whitelisted: ' + JSON.stringify(whitelist.reason.msg))
											utils.infoLog(
												`After SonoranCMS role update ${data.data.accName} (${accountID}) was no longer whitelisted, reason returned: ${JSON.stringify(whitelist.reason.msg)}`
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
							config.apiIdType.toLowerCase()
						);
						if (!apiId)
							return utils.errorLog(
								`Could not find the correct API ID to cross check with the whitelist... Requesting type: ${config.apiIdType.toUpperCase()}`
							);
						deferrals.update("Checking whitelist...");
						updateBackup(config);
						await instance.cms
							.verifyWhitelist(apiId)
							.then(async (whitelist) => {
								if (whitelist.success) {
									deferrals.done();
									utils.infoLog(
										`Successfully allowed ${name} (${apiId}) through whitelist, username returned: ${JSON.stringify(whitelist.reason.msg)} `
									);
									await instance.cms.rest.request('GET_COM_ACCOUNT', apiId, whitelist.reason, undefined).then((data) => {
										activePlayers[data[0].accId] = src
									})
								} else {
									deferrals.done(
										`Failed whitelist check: ${JSON.stringify(whitelist.reason.msg)} \n\nAPI ID used to check: ${apiId}`
									);
									utils.infoLog(
										`Denied ${name} (${apiId}) through whitelist, reason returned: ${JSON.stringify(whitelist.reason.msg)}`
									);
								}
							})
							.catch((err) => {
								if (backup.includes(apiId)) {
									deferrals.done();
								} else {
									deferrals.done(
										`The Sonoran CMS backend is offline and you are not in the offline backup.`
									);
									utils.errorLog(
										`An error occured while checking whitelist for ${name} (${apiId})... ${err}`,
										err
									);
								}
							});
					}
				);

				setInterval(() => { updateBackup(config) }, 1800000);
			});

			instance.on("CMS_SETUP_UNSUCCESSFUL", (err) => {
				utils.errorLog(
					`Sonoran Whitelist Setup Unsuccessfully! Error provided: ${err}`
				);
			});
		}
	} else {
		utils.errorLog(
			"No config found... looked for config.json & server convars..."
		);
	}
}

function updateBackup(config) {
	fetch("https://api.sonorancms.com/servers/full_whitelist", {
		method: "POST",
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify({
			id: config.communityId,
			key: config.apiKey,
			type: "GET_FULL_WHITELIST",
			data: [
				{
					serverId: config.serverId
				}
			]
		})
	}).then((resp) => {
		resp.json().then((res) => {
			if (resp.status == 201) {
				let IDarray = [];
				for (x in res) {
					let v = res[x];
					IDarray.concat(v.apiIds);
				}
				backup = IDarray;
				SaveResourceFile(
					GetCurrentResourceName(),
					"backup.json",
					JSON.stringify(backup)
				);
			}
		});
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