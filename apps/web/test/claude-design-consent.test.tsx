import { afterEach, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { ClaudeDesignConsent } from "@agenteschat/client";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { ClaudeDesignConsentCard } from "../src/components/ai/ClaudeDesignConsent";
import { NoticeLine } from "../src/components/ChatNotices";
import { createFakeApi, ORG_ID } from "./fake-api";
import { renderPage, screen, settle, showIn } from "./render";

afterEach(cleanup);
const row: ClaudeDesignConsent = {
  id: crypto.randomUUID(),
  jobId: crypto.randomUUID(),
  status: "pending",
  title: "Synthetic design",
  accountLabel: "Claude local",
  remoteUrl: new URL("/artifact/synthetic", "https://claude.ai").href,
  description: "read an artifact (read-only)\n<script>untrusted</script>",
  expiresAt: new Date(Date.now() + 60000).toISOString(),
  canDecide: true,
};
test("review opens the complete request with acknowledgement off before one approval", async () => {
  const api = createFakeApi();
  const decisions: unknown[] = [];
  api.claudeDesign.getConsent = async () => row;
  api.claudeDesign.decideConsent = async (o, id, input) => {
    expect(o).toBe(ORG_ID);
    expect(id).toBe(row.id);
    decisions.push(input);
    return { ...row, status: "approved", canDecide: false };
  };
  await renderPage(
    <NoticeLine
      message={{
        id: "native-message",
        channelId: "dm",
        threadId: null,
        author: { type: "agent", id: "a1" },
        body: "Review",
        mentionedAgentIds: [],
        agentRunId: null,
        createdAt: new Date().toISOString(),
        meta: { notice: { kind: "design_consent", text: "Review this request", refs: { designConsentId: row.id } } },
      }}
    />,
    { api, org: true },
  );
  await settle();
  expect(screen().queryByRole("checkbox")).toBeNull();
  expect(screen().queryByRole("button", { name: "Aprovar esta leitura" })).toBeNull();
  await act(async () => fireEvent.click(screen().getByRole("button", { name: "Revisar pedido" })));
  await settle();
  expect(screen().getByRole("dialog").textContent).toContain(row.description);
  expect(screen().getByRole("link", { name: row.remoteUrl }).getAttribute("href")).toBe(row.remoteUrl);
  expect(screen().getByRole("dialog").querySelector("script")).toBeNull();
  const check = screen().getByRole("checkbox");
  expect(check.getAttribute("aria-checked")).toBe("false");
  expect((screen().getByRole("button", { name: "Aprovar esta leitura" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => fireEvent.click(check));
  await act(async () => fireEvent.click(screen().getByRole("button", { name: "Aprovar esta leitura" })));
  await settle();
  expect(decisions).toEqual([{ decision: "approve", reviewed: true }]);
  expect(screen().queryByRole("button", { name: /sempre|tudo/i })).toBeNull();
});
test("expired and revoked requests show their state with no review or approval action", async () => {
  for (const status of ["expired", "canceled"] as const) {
    const api = createFakeApi();
    api.claudeDesign.getConsent = async () => ({ ...row, status, canDecide: false });
    const r = await renderPage(<ClaudeDesignConsentCard consentId={row.id} />, { api, org: true });
    await settle();
    expect(screen().queryByRole("button", { name: "Revisar pedido" })).toBeNull();
    expect(screen().queryByRole("checkbox")).toBeNull();
    r.unmount();
  }
});

test("closing review discards acknowledgement and long native text stays visible before denial", async () => {
  const api = createFakeApi();
  const large = {
    ...row,
    title: "Very long private artifact ".repeat(10),
    accountLabel: "Local account ".repeat(12),
    description: "Native provider text <>& ".repeat(70),
  };
  const decisions: unknown[] = [];
  api.claudeDesign.getConsent = async () => large;
  api.claudeDesign.decideConsent = async (_o, _id, input) => {
    decisions.push(input);
    return { ...large, status: "denied", canDecide: false };
  };
  const { services } = await renderPage(<ClaudeDesignConsentCard consentId={row.id} />, { api, org: true });
  await settle();
  await showIn(services, "de");
  const t = services.i18n.t;
  const open = async () => {
    await act(async () => fireEvent.click(screen().getByRole("button", { name: t("claudeDesign.review") })));
    await settle();
  };
  await open();
  expect(screen().getByRole("dialog").textContent).toContain(large.description);
  await act(async () => fireEvent.click(screen().getByRole("checkbox")));
  await act(async () => fireEvent.click(screen().getByRole("button", { name: t("common.close") })));
  await settle();
  await open();
  expect(screen().getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
  await act(async () => fireEvent.click(screen().getByRole("button", { name: t("claudeDesign.deny") })));
  await settle();
  expect(decisions).toEqual([{ decision: "deny", reviewed: false }]);
});
