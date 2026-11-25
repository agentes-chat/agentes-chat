import { REPORT_OPTIONS, scrubEvent, urlPattern } from "@agenteschat/adapters/error-scrub";
import type { ErrorReportsConfig } from "@agenteschat/client";
import { captureException, type Event, init, setTags, setUser } from "@sentry/browser";
import { reloadingForNewVersion } from "./app-version";
import { desktopReportTags } from "./desktop";
import { appFiles, type ErrorSdk, foreignStack, shortErrorId } from "./error-reports";

/**
 * A frame of an inline script, or of a script an extension injected into the page, names the page it ran on as its
 * file: that address goes as its pattern, like the request's (ADR 0104), since it holds the workspace's and the
 * person's ids and a wiki page's name. The app's own files (`/assets/`) and other origins' stay as they are.
 *
 * In a copy of the exception: `beforeSend` gets a shallow copy of the event the SDK's dedupe keeps, to compare the next
 * report's message and frames with. Scrubbed in place, a repeat would read as a new report and go too. What
 * `scrubEvent` rewrites in the exception (its message) then lands in the copy as well.
 */
function scrubPageFrames(event: Event) {
  const page = `${location.origin}/`;
  const scrub = (file: string) => (file.startsWith(page) && !file.startsWith(appFiles()) ? urlPattern(file) : file);
  if (event.exception)
    event.exception = {
      ...event.exception,
      values: event.exception.values?.map((value) => ({
        ...value,
        stacktrace: value.stacktrace && {
          ...value.stacktrace,
          frames: value.stacktrace.frames?.map((frame) => ({
            ...frame,
            ...(frame.filename && { filename: scrub(frame.filename) }),
            ...(frame.abs_path && { abs_path: scrub(frame.abs_path) }),
          })),
        },
      })),
    };
}

/**
 * The Sentry browser SDK for errors only (no sessions, traces or replays), every event scrubbed (ADR 0104). Its own
 * handlers report the page's errors and unhandled rejections from now on. `taken`: each report it sends, by id.
 */
export function startSdk(config: ErrorReportsConfig, taken: (eventId: string) => void): ErrorSdk {
  init({
    ...REPORT_OPTIONS,
    // After the SDK's own dedupe, which drops a repeat of the last report: what reaches here is sent.
    beforeSend: (event) => {
      // Its own handlers too: what fails while the app reloads into a new version is the old version's, and what
      // fails in an extension's code is the extension's. This file's chunk holds the SDK too: nothing else imports it.
      if (reloadingForNewVersion() || foreignStack(event, import.meta.url)) return null;
      if (event.event_id) taken(event.event_id);
      scrubPageFrames(event);
      return scrubEvent(event);
    },
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    integrations: (defaults) => defaults.filter((integration) => integration.name !== "BrowserSession"),
  });
  setTags(desktopReportTags());
  return {
    capture(error, eventId) {
      captureException(error, { event_id: eventId, captureContext: { tags: { error_id: shortErrorId(eventId) } } });
    },
    scope({ route, orgId, userId }) {
      setTags({ route, org_id: orgId });
      setUser(userId ? { id: userId } : null);
    },
  };
}
