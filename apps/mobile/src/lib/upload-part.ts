import { File } from "expo-file-system";

/**
 * A file on the phone as a `FormData` part for `api.artifacts.upload`. The app's `fetch` is Expo's, whose FormData
 * takes a part that has `bytes()` (its filename and type from `name` and `type`) and refuses React Native's
 * `{ uri, name, type }` part: with one the request threw "Unsupported FormDataPart implementation" before any byte
 * left the phone (the same cause as the voice notes', src/features/voice/outbox.ts).
 */
export function uploadPart(file: { uri: string; name: string; type: string }): globalThis.File {
  const source = new File(file.uri);
  return { name: file.name, type: file.type, bytes: () => source.bytes() } as unknown as globalThis.File;
}
