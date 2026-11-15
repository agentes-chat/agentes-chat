/** Pinned CLI SDK wire. Unknown, duplicate or overlapping controls never acquire authority. */
export class DesignSdkControl {
  private initId = crypto.randomUUID();
  private prompt?: string;
  private ready = false;
  private closed = false;
  private pending = false;
  private seen = new Set<string>();
  constructor(
    private readonly io: {
      write(value: unknown): void;
      permission(request: unknown): Promise<boolean>;
      fail(): void;
    },
  ) {}
  start(prompt: string) {
    if (this.prompt !== undefined || this.closed) throw new Error("SDK already started");
    this.prompt = prompt;
    this.io.write({
      type: "control_request",
      request_id: this.initId,
      request: { subtype: "initialize", hooks: null },
    });
  }
  close() {
    this.closed = true;
  }
  async accept(raw: unknown): Promise<void> {
    if (this.closed || !raw || typeof raw !== "object") return;
    const frame = raw as Record<string, unknown>;
    if (frame.type === "control_response") {
      const r = frame.response as Record<string, unknown> | undefined;
      if (r?.request_id !== this.initId) return;
      if (this.ready || r.subtype !== "success" || this.prompt === undefined) return this.io.fail();
      this.ready = true;
      this.io.write({ type: "user", message: { role: "user", content: this.prompt } });
      return;
    }
    if (frame.type !== "control_request") return;
    const id = frame.request_id;
    if (typeof id !== "string" || id.length < 1 || id.length > 128 || this.seen.has(id) || this.seen.size >= 512)
      return this.io.fail();
    this.seen.add(id);
    const request = frame.request as Record<string, unknown> | undefined;
    const canHandle = this.ready && !this.pending && request?.subtype === "can_use_tool";
    let allow = false;
    if (canHandle) {
      this.pending = true;
      try {
        allow = await this.io.permission(request);
      } catch {
        /* deny */
      } finally {
        this.pending = false;
      }
    }
    if (this.closed) return;
    this.io.write({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: id,
        response:
          allow && request
            ? { behavior: "allow", updatedInput: request.input }
            : { behavior: "deny", message: "No matching reviewed live Design authorization", interrupt: true },
      },
    });
  }
}
