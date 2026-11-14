/**
 * Expo config plugin: the iOS app and its extensions signed by hand for the App Store, when the build names a
 * provisioning profile for each of them (the "iOS build" workflow, .github/workflows/ios.yml):
 * `IOS_SIGNING_PROFILES`, a JSON object of bundle id → profile name, and `APPLE_TEAM_ID`.
 * Without them the project keeps the template's signing (a local build, Xcode's automatic signing), as before.
 * No certificate, profile or team id enters the repo: the names come from the build's environment.
 *
 * Listed before the plugins that add targets (the share extension): a project's changes run from the last
 * plugin to the first, so this one sees every target.
 */
const { withXcodeProject } = require("expo/config-plugins");

const IDENTITY = "Apple Distribution";

const unquoted = (value) => (typeof value === "string" ? value.replace(/^"(.*)"$/, "$1") : value);

/**
 * Sets manual signing on every build configuration whose bundle id has a profile (`configurations`: the
 * project's XCBuildConfiguration section, edited in place). Returns the bundle ids it signed.
 */
function signManually(configurations, profiles, team) {
  const signed = new Set();
  for (const configuration of Object.values(configurations)) {
    const settings = configuration && typeof configuration === "object" ? configuration.buildSettings : null;
    if (!settings) continue;
    const id = unquoted(settings.PRODUCT_BUNDLE_IDENTIFIER);
    const profile = profiles[id];
    if (!profile) continue;
    settings.CODE_SIGN_STYLE = "Manual";
    settings.DEVELOPMENT_TEAM = team;
    settings.CODE_SIGN_IDENTITY = `"${IDENTITY}"`;
    settings['"CODE_SIGN_IDENTITY[sdk=iphoneos*]"'] = `"${IDENTITY}"`;
    settings.PROVISIONING_PROFILE_SPECIFIER = `"${profile}"`;
    signed.add(id);
  }
  return [...signed];
}

/** The profiles the build named (`{}` when it named none, or something that isn't an object of names). */
function profilesFrom(text) {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, name]) => typeof name === "string" && name));
  } catch {
    return {};
  }
}

module.exports = function withIosManualSigning(config) {
  const profiles = profilesFrom(process.env.IOS_SIGNING_PROFILES);
  const team = process.env.APPLE_TEAM_ID;
  if (Object.keys(profiles).length === 0 || !team) return config;
  return withXcodeProject(config, (mod) => {
    const signed = signManually(mod.modResults.pbxXCBuildConfigurationSection(), profiles, team);
    const missing = Object.keys(profiles).filter((id) => !signed.includes(id));
    // A profile for a target the project doesn't have is a mistake in the build, said before Xcode runs.
    if (missing.length > 0) {
      throw new Error(`with-ios-manual-signing: no target with the bundle id ${missing.join(", ")}`);
    }
    return mod;
  });
};

module.exports.signManually = signManually;
module.exports.profilesFrom = profilesFrom;
