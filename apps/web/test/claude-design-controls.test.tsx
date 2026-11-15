import { afterEach, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { ClaudeDesignGrant, ClaudeDesignJob } from "@agenteschat/client";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { ClaudeDesignGrantControl } from "../src/components/ai/ClaudeDesignGrant";
import { ClaudeDesignJobCard } from "../src/components/ai/ClaudeDesignJob";
import { ArtifactViewerProvider } from "../src/components/artifacts/ArtifactViewer";
import { ADA_ID, createFakeApi } from "./fake-api";
import { renderPage, screen, settle } from "./render";

afterEach(cleanup);
test("completed publication and recovery deliver a verified link without a preview, with sources secondary", async () => {
  for (const recovered of [false, true]) {
    const api = createFakeApi();
    const inputs = [
      {
        relativePath: "project/canvas.json",
        text: JSON.stringify({
          v: 3,
          boards: { "sample.dc.html": { w: 480, h: 320, title: "Status card" } },
          order: ["sample.dc.html"],
        }),
      },
      {
        relativePath: "project/sample.dc.html",
        text: "<div style='background:#EAF2FF;width:480px;height:320px'>Operational layout</div>",
      },
    ];
    const row: ClaudeDesignJob = {
      id: crypto.randomUUID(),
      title: recovered ? "Recovered design" : "Published design",
      state: "succeeded",
      designId: crypto.randomUUID(),
      revision: 1,
      remote: { id: "synthetic", url: new URL("/artifact/synthetic", "https://claude.ai").href, version: "opaque" },
      artifactIds: ["reference", "0", "1"],
      preview: {
        version: "opaque",
        files: inputs.map((file, i) => ({
          artifactId: String(i),
          version: 1,
          relativePath: file.relativePath,
          sha256: "a".repeat(64),
          size: new TextEncoder().encode(file.text).length,
          contentType: i ? "text/html" : "application/json",
        })),
      },
    };
    api.claudeDesign.getJob = async () => row;
    api.artifacts.get = async (_org, id, version) =>
      ({ shownVersion: version, content: { kind: "file", ...row.preview!.files[Number(id)] } }) as never;
    api.artifacts.fileBlob = async (_org, id) => new Blob([inputs[Number(id)]!.text]);
    await renderPage(
      <ArtifactViewerProvider>
        <ClaudeDesignJobCard jobId={row.id} />
      </ArtifactViewerProvider>,
      { api, org: true },
    );
    await settle(6);
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen().queryByText(/Prévia|previewUnavailable|staticPreview/)).toBeNull();
    expect(screen().getByRole("link", { name: "Abrir no Claude" }).getAttribute("href")).toBe(row.remote!.url);
    expect(screen().queryByText("Pede aprovação")).toBeNull();
    expect(document.querySelector(".artifact-cards")).toBeNull();
    expect(screen().getByText("Arquivos-fonte")).toBeTruthy();
    await act(async () => fireEvent.click(screen().getByRole("button", { name: "Arquivos-fonte" })));
    expect(document.querySelector(".artifact-cards")).toBeTruthy();
    await act(async () => fireEvent.click(screen().getByRole("button", { name: "Arquivos-fonte" })));
    expect(document.querySelector(".artifact-cards")).toBeNull();
    cleanup();
  }
});
test("completed jobs remain link-only even when source rendering would be unsupported", async () => {
  const api = createFakeApi();
  const row: ClaudeDesignJob = {
    id: crypto.randomUUID(),
    state: "succeeded",
    designId: null,
    revision: 1,
    artifactIds: [],
    remote: { id: "synthetic", url: new URL("/artifact/synthetic", "https://claude.ai").href, version: "opaque" },
    preview: { version: "opaque", files: [] },
  };
  api.claudeDesign.getJob = async () => row;
  await renderPage(
    <ArtifactViewerProvider>
      <ClaudeDesignJobCard jobId={row.id} />
    </ArtifactViewerProvider>,
    { api, org: true },
  );
  await settle(6);
  expect(screen().queryByText("Prévia indisponível. Abra o design no Claude.")).toBeNull();
  expect(screen().queryByRole("button", { name: "Tentar de novo" })).toBeNull();
  expect(screen().getByRole("link", { name: "Abrir no Claude" }).getAttribute("href")).toBe(row.remote!.url);
  expect(document.querySelector("iframe")).toBeNull();
});
test("a per-agent grant follows backend availability and can be revoked when its account becomes unsupported", async () => {
  const api = createFakeApi();
  let row: ClaudeDesignGrant = { enabled: false, available: true, accountId: null, revision: 0, reason: null };
  const changed: (string | null)[] = [];
  api.claudeDesign.getGrant = async (_o, a, candidate) => {
    expect(a).toBe(ADA_ID);
    expect(candidate).toBe("account");
    return row;
  };
  api.claudeDesign.setGrant = async (_o, a, id) => {
    expect(a).toBe(ADA_ID);
    changed.push(id);
    row = {
      enabled: !!id,
      available: false,
      accountId: id ?? "account",
      revision: row.revision + 1,
      reason: "unsupported",
    };
    return row;
  };
  await renderPage(<ClaudeDesignGrantControl accountId="account" agentId={ADA_ID} agentName="Ada" />, {
    api,
    org: true,
  });
  await settle();
  const toggle = () => screen().getByRole("switch", { name: "Usar Claude Design com Ada" });
  await act(async () => fireEvent.click(toggle()));
  await settle();
  expect(changed).toEqual(["account"]);
  expect((toggle() as HTMLButtonElement).disabled).toBe(false);
  await act(async () => fireEvent.click(toggle()));
  await settle();
  expect(changed).toEqual(["account", null]);
  expect((toggle() as HTMLButtonElement).disabled).toBe(true);
});
test("unreleased disabled grants offer no enablement control", async () => {
  const api = createFakeApi();
  await renderPage(<ClaudeDesignGrantControl accountId="account" agentId={ADA_ID} agentName="Ada" />, {
    api,
    org: true,
  });
  await settle();
  expect(screen().queryByRole("switch")).toBeNull();
});
test("a partial publication stays visible and recovery requires an explicit manual association", async () => {
  const api = createFakeApi();
  const row: ClaudeDesignJob = {
    id: crypto.randomUUID(),
    state: "published",
    designId: crypto.randomUUID(),
    revision: 1,
    remote: { id: "synthetic", url: new URL("/artifact/synthetic", "https://claude.ai").href, version: "opaque" },
    artifactIds: [],
    error: { code: "sources_incomplete", message: "sources incomplete" },
  };
  const requests: unknown[] = [];
  api.claudeDesign.getJob = async () => row;
  api.claudeDesign.recover = async (_o, _j, input) => {
    requests.push(input);
    return row;
  };
  await renderPage(
    <ArtifactViewerProvider>
      <ClaudeDesignJobCard jobId={row.id} />
    </ArtifactViewerProvider>,
    { api, org: true },
  );
  await settle();
  expect(
    screen().getByText("“Claude Design” está publicado no Claude. Os arquivos-fonte ainda não foram todos importados."),
  ).toBeTruthy();
  expect(screen().getByRole("link", { name: "Abrir no Claude" }).getAttribute("href")).toBe(row.remote?.url ?? "");
  await act(async () => fireEvent.click(screen().getByRole("button", { name: "Recuperar fontes" })));
  await settle();
  expect((screen().getByRole("button", { name: "Associar e ler" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => fireEvent.click(screen().getByRole("checkbox")));
  await act(async () => fireEvent.click(screen().getByRole("button", { name: "Associar e ler" })));
  await settle();
  expect(requests).toEqual([{ remoteUrl: row.remote?.url, confirmAssociation: true }]);
  expect(
    screen().getByText("“Claude Design” está publicado no Claude. Os arquivos-fonte ainda não foram todos importados."),
  ).toBeTruthy();
  expect(screen().queryByRole("button", { name: /criar novamente|repetir|html/i })).toBeNull();
});

test.each([
  ["waiting_approval", "Aguardando sua aprovação nesta conversa"],
  ["working", "Criando o design no Claude"],
  ["unknown", "Resultado incerto; é preciso verificar"],
] as const)("Design chat shows live %s progress and its board task without a preview", async (stage, label) => {
  const api = createFakeApi();
  const row: ClaudeDesignJob = {
    id: crypto.randomUUID(),
    state: "running",
    title: "Synthetic",
    designId: null,
    revision: 0,
    artifactIds: [],
    remote: null,
    issue: { id: crypto.randomUUID(), number: 42 },
    progress: {
      stage,
      updatedAt: new Date().toISOString(),
      pendingConsentId: stage === "waiting_approval" ? crypto.randomUUID() : null,
      issue: null,
    },
  };
  api.claudeDesign.getJob = async () => row;
  await renderPage(<ClaudeDesignJobCard jobId={row.id} />, { api, org: true });
  await settle(6);
  expect(screen().getByText(label)).toBeTruthy();
  expect(screen().getByRole("link", { name: "Ver tarefa #42" }).getAttribute("href")).toContain("/issues/42");
  expect(document.querySelector("iframe")).toBeNull();
});
