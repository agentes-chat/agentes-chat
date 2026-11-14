import { describe, expect, test } from "bun:test";

// The config plugin is plain CommonJS (expo prebuild loads it); only its pure parts are tested here.
const { signManually, profilesFrom } = require("../plugins/with-ios-manual-signing") as {
  signManually: (configurations: Record<string, unknown>, profiles: Record<string, string>, team: string) => string[];
  profilesFrom: (text: string | undefined) => Record<string, string>;
};

/** The shape of a project's XCBuildConfiguration section: configurations, and a comment string per entry. */
const section = () => ({
  A1: { isa: "XCBuildConfiguration", name: "Debug", buildSettings: { PRODUCT_BUNDLE_IDENTIFIER: "chat.agentes.app" } },
  A1_comment: "Debug",
  A2: {
    isa: "XCBuildConfiguration",
    name: "Release",
    buildSettings: { PRODUCT_BUNDLE_IDENTIFIER: "chat.agentes.app", CODE_SIGN_STYLE: "Automatic" },
  },
  B1: {
    isa: "XCBuildConfiguration",
    name: "Release",
    buildSettings: { PRODUCT_BUNDLE_IDENTIFIER: '"chat.agentes.app.share-extension"' },
  },
  P1: { isa: "XCBuildConfiguration", name: "Release", buildSettings: { SDKROOT: "iphoneos" } },
});

describe("iOS manual signing", () => {
  const profiles = { "chat.agentes.app": "App profile", "chat.agentes.app.share-extension": "Share profile" };

  test("each target with a profile is signed by hand with its own profile, quoted ids included", () => {
    const configurations = section();
    expect(signManually(configurations, profiles, "TEAM").sort()).toEqual([
      "chat.agentes.app",
      "chat.agentes.app.share-extension",
    ]);
    for (const key of ["A1", "A2"] as const) {
      expect(configurations[key].buildSettings).toMatchObject({
        CODE_SIGN_STYLE: "Manual",
        DEVELOPMENT_TEAM: "TEAM",
        CODE_SIGN_IDENTITY: '"Apple Distribution"',
        PROVISIONING_PROFILE_SPECIFIER: '"App profile"',
      });
    }
    expect(configurations.B1.buildSettings).toMatchObject({ PROVISIONING_PROFILE_SPECIFIER: '"Share profile"' });
  });

  test("what has no profile is left as it was", () => {
    const configurations = section();
    signManually(configurations, profiles, "TEAM");
    expect(configurations.P1.buildSettings).toEqual({ SDKROOT: "iphoneos" });
  });

  test("a target the build named no profile for is not in the answer", () => {
    expect(signManually(section(), { "chat.agentes.app": "App profile" }, "TEAM")).toEqual(["chat.agentes.app"]);
  });

  test("the profiles come from a JSON object of names; anything else is none", () => {
    expect(profilesFrom('{"chat.agentes.app":"App profile"}')).toEqual({ "chat.agentes.app": "App profile" });
    expect(profilesFrom(undefined)).toEqual({});
    expect(profilesFrom("not json")).toEqual({});
    expect(profilesFrom('["a"]')).toEqual({});
    expect(profilesFrom('{"chat.agentes.app":""}')).toEqual({});
  });
});
