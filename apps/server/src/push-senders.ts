import {
  type ApnsKey,
  createApnsPushSender,
  createFcmPushSender,
  createPhonePushSender,
  type PushSender,
} from "@agenteschat/adapters";
import type { Config } from "@agenteschat/config";

/** The config a server's own phone credentials come from. */
type PushConfig = Pick<
  Config,
  "FIREBASE_SERVICE_ACCOUNT" | "APNS_KEY" | "APNS_KEY_ID" | "APNS_TEAM_ID" | "APNS_APP_IDS" | "PUSH_SENDER"
>;

/** This server's APNs key (ADR 0178): only with the key, its id and the team together. */
export function apnsKeyOf(config: PushConfig): ApnsKey | null {
  const { APNS_KEY: key, APNS_KEY_ID: keyId, APNS_TEAM_ID: teamId } = config;
  return key && keyId && teamId ? { key, keyId, teamId } : null;
}

/** Which of the three APNs variables are set while another is missing: the key does nothing until all are. */
export function apnsKeyGaps(config: PushConfig): string[] {
  const set = { APNS_KEY: config.APNS_KEY, APNS_KEY_ID: config.APNS_KEY_ID, APNS_TEAM_ID: config.APNS_TEAM_ID };
  const missing = Object.entries(set).flatMap(([name, value]) => (value ? [] : [name]));
  return missing.length === Object.keys(set).length ? [] : missing;
}

/** The senders this server has credentials for: Firebase (Android, ADR 0152) and APNs (iPhone, ADR 0178). */
export function directPushSenders(config: PushConfig): { android: PushSender | null; ios: PushSender | null } {
  const account = config.FIREBASE_SERVICE_ACCOUNT;
  const key = apnsKeyOf(config);
  return {
    android: account ? createFcmPushSender({ serviceAccount: account }) : null,
    ios: key ? createApnsPushSender({ key, appIds: config.APNS_APP_IDS }) : null,
  };
}

/** The push relay's own sender (`PUSH_RELAY_SERVE`): both platforms it has credentials for, or null with neither. */
export function relayServeSender(direct: { android: PushSender | null; ios: PushSender | null }): PushSender | null {
  return direct.android || direct.ios ? createPhonePushSender(direct) : null;
}

/** How this server sends one platform's pushes: `PUSH_SENDER`, with `auto` resolved by its own credentials. */
export function phonePushMode(config: PushConfig, own: PushSender | null): "direct" | "relay" | "off" {
  if (config.PUSH_SENDER !== "auto") return config.PUSH_SENDER;
  return own ? "direct" : "relay";
}
