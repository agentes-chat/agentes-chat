/**
 * A connected server that asks for approval itself (ADR 0180): a tool result that says `approval-required`, answered
 * through the server's own `resume` tool. Executor (`elicitation_mode=model`) answers this way:
 *
 *     {"status":"approval-required","requestId":"apr_…","invocation":{"tool":"…"},
 *      "elicitation":{"mode":"form","message":"Approve …?"}}
 *
 * The Tool Gateway turns it into our own approval card and calls `resume` itself with the person's answer, instead of
 * leaving that to the model.
 */

/** The server's own tool that answers a paused request: offered only by a server that lists it. */
export const RESUME_TOOL = "resume";

/** A paused request, as read from a tool's result. */
export interface ServerPause {
  requestId: string;
  /** What the server asks the person, in its own words (cut). */
  message: string;
  /** The action it wants to run (`invocation.tool`), when it names one. */
  action: string | null;
}

/** How a person's decision is answered: approved, refused, or never answered in time. */
export type ResumeAction = "accept" | "decline" | "cancel";

const REQUEST_ID = /^apr_[A-Za-z0-9_.:-]{1,200}$/;
const MESSAGE_CHARS = 1000;
const ACTION_CHARS = 200;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The paused request a tool's result carries, or null for anything else. The whole result must be that one JSON
 * object: text that only mentions it (a page, an email) never opens a card. A form that asks the person for fields
 * (`requestedSchema` with properties) is not an approval: the model answers it, as before.
 */
export function serverPauseOf(content: string): ServerPause | null {
  const text = content.trim();
  if (!text.startsWith("{") || text.length > 20_000) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.status !== "approval-required") return null;
  const { requestId, elicitation, invocation } = value;
  if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) return null;
  if (elicitation !== undefined && !isRecord(elicitation)) return null;
  const form = isRecord(elicitation) ? elicitation.requestedSchema : undefined;
  if (isRecord(form) && isRecord(form.properties) && Object.keys(form.properties).length > 0) return null;
  const said = isRecord(elicitation) && typeof elicitation.message === "string" ? elicitation.message.trim() : "";
  const tool = isRecord(invocation) && typeof invocation.tool === "string" ? invocation.tool.trim() : "";
  return {
    requestId,
    message: said.slice(0, MESSAGE_CHARS),
    action: tool ? tool.slice(0, ACTION_CHARS) : null,
  };
}

/** The `resume` call that answers a paused request. */
export const resumeInput = (requestId: string, action: ResumeAction): Record<string, unknown> => ({
  requestId,
  response: { action },
});
