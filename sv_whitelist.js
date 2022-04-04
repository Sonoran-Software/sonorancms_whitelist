const utils = require('./sh_utils');

async function initialize() {
  let config = false;
  utils.infoLog('Checking resource version...');
  await utils.checkVersion(GetResourceMetadata(GetCurrentResourceName(), 'git_repo'), GetResourceMetadata(GetCurrentResourceName(), 'version'));
  try {
    config = require('./config.json');
  } catch (err) {
    if (err) {
      const apiKey = GetConvar('SONORAN_CMS_API_KEY', 'unknown');
      const communityId = GetConvar('SONORAN_CMS_COMMUNITY_ID', 'unknown');
      const serverId = GetConvar('SONORAN_CMS_SERVER_ID', 1);
      const apiIdType = GetConvar('SONORAN_CMS_API_ID_TYPE', 'unknown');
      const cmsApiUrl = GetConvar('SONORAN_CMS_API_URL', 'https://api.sonorancms.com');

      if (!config) {
        if (apiKey !== 'unknown' && communityId !== 'unknown' && apiIdType !== 'unknown') {
          config = {
            apiKey,
            communityId,
            serverId,
            apiIdType,
            apiUrl: cmsApiUrl
          };
        }
      } else {
        utils.errorLog(err);
      }
    }
  }

  if (config) {
    if (config.apiIdType.toLowerCase() !== 'discord' && config.apiIdType.toLowerCase() !== 'steam' && config.apiIdType.toLowerCase() !== 'license') {
      utils.errorLog('Invalid apiIdType given, must be "discord", "steam", or "license".');
    } else {
      const Sonoran = require('@sonoransoftware/sonoran.js');
      utils.infoLog('Initializing Sonoran Whitelist...');
      const instance = new Sonoran.Instance({
        communityId: config.communityId,
        apiKey: config.apiKey,
        serverId: config.serverId,
        product: Sonoran.productEnums.CMS,
        cmsApiUrl: config.apiUrl
      });

      instance.on('CMS_SETUP_SUCCESSFUL', () => {
        if (instance.cms.version < 2) return utils.errorLog(`Subscription version too low to use Sonoran Whitelist effectively... Current Sub Version: ${utils.subIntToName(instance.cms.version)} (${instance.cms.version}) | Needed Sub Version: ${utils.subIntToName(2)} (2)`);
        utils.infoLog(`Sonoran Whitelist Setup Successfully! Current Sub Version: ${utils.subIntToName(instance.cms.version)} (${instance.cms.version})`);
        
        on('playerConnecting', async (name, setNickReason, deferrals) => {
          const src = global.source;
          let apiId;
          deferrals.defer();
          deferrals.update('Grabbing API ID to check against the whitelist...');
          apiId = getAppropriateIdentifier(src, config.apiIdType.toLowerCase());
          if (!apiId) return utils.errorLog(`Could not find the correct API ID to cross check with the whitelist... Requesting type: ${config.apiIdType.toUpperCase()}`);
          deferrals.update('Checking whitelist...');
          await instance.cms.verifyWhitelist(apiId).then((whitelist) => {
            if (whitelist.success) {
              deferrals.done();
              utils.infoLog(`Successfully allowed ${name} () through whitelist, username returned: ${whitelist.reason}`);
            } else {
              deferrals.done(`Failed whitelist check: ${whitelist.reason}`);
              utils.infoLog(`Denied ${name} () through whitelist, reason returned: ${whitelist.reason}`);
            }
          }).catch((err) => {
            deferrals.done(`Error occured while checking whitelist... ${err}`);
            utils.errorLog(`An error occured while checking whitelist for ${name} ()... ${err}`, err);
          });
        });
      });

      instance.on('CMS_SETUP_UNSUCCESSFUL', (err) => {
        utils.errorLog(`Sonoran Whitelist Setup Unsuccessfully! Error provided: ${err}`);
      });
    }
  } else {
    utils.errorLog('No config found... looked for config.json & server convars...');
  }
}

function getAppropriateIdentifier(source, type) {
  const identifiers = getPlayerIdentifiers(source);
  let properIdentifiers = {
    discord: '',
    steam: '',
    license: ''
  }
  identifiers.forEach((identifier) => {
    const splitIdentifier = identifier.split(':');
    const identType = splitIdentifier[0];
    const identId = splitIdentifier[1];
    switch (identType) {
      case 'discord':
        properIdentifiers.discord = identId;
        break;
      case 'steam':
        properIdentifiers.steam = identId;
        break;
      case 'license':
        properIdentifiers.license = identId;
        break;
    }
  });

  if (properIdentifiers[type] === '') {
    return null;
  } else {
    return properIdentifiers[type];
  }
}


initialize();