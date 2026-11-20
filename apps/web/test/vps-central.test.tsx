import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { CentralTask, CentralView } from "@agenteschat/client";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { Markdown } from "@/lib/markdown";
import { ADA_ID, ATLAS_ID, createFakeApi, ENG_ID, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const task = (over: Partial<CentralTask>): CentralTask => ({
  runId: "run-1",
  agentId: ADA_ID,
  channelId: ENG_ID,
  channelKind: "channel",
  channelName: "eng",
  betweenAgents: false,
  threadId: null,
  title: "Corrigir o login",
  state: "working",
  waitsOn: null,
  startedAt: ago(30),
  createdAt: ago(30),
  finishedAt: null,
  lastSignalAt: ago(1),
  progress: { done: 3, total: 4, percent: 75 },
  latestUpdate: null,
  requester: { kind: "agent", id: ATLAS_ID },
  origin: "Rodrigo",
  now: { tool: "Bash", detail: "bun test" },
  steps: 12,
  helpers: 0,
  error: null,
  canStop: true,
  canContinue: false,
  ...over,
});
const agent = (id: string, name: string) => ({
  id,
  name,
  handle: name.toLowerCase(),
  role: "",
  brain: "claude_code",
  model: "claude-opus-5-5",
  effort: "high",
  approvals: "risky",
  hasInstructions: true,
  machine: { id: "m1", name: "impactados", online: true },
  activity: [0, 2, 1],
  doneThisWeek: 4,
  failedThisWeek: 0,
  reportsToAgentId: null,
  memory: id === ADA_ID ? { rssMb: 640, processes: 3, at: new Date().toISOString() } : null,
});
const view = (tasks: CentralTask[]): CentralView => ({
  at: new Date().toISOString(),
  agents: [agent(ADA_ID, "Ada"), agent(ATLAS_ID, "Atlas")],
  tasks,
  talks: [
    {
      id: "t1",
      fromAgentId: ATLAS_ID,
      toAgentId: ADA_ID,
      kind: "question",
      status: "answered",
      createdAt: ago(2),
      answeredAt: ago(1),
      question: "Qual arquivo quebrou?",
      answer: "auth.ts",
    },
  ],
  pullRequests: [],
  computers: [
    {
      id: "m1",
      name: "impactados",
      online: true,
      version: "0.13.0",
      cpus: 8,
      memoryGb: 32,
      memoryAvg: 0.5,
      memoryPeak: 0.6,
      diskFreeGb: 300,
      working: 1,
      inLine: 0,
    },
  ],
  links: [
    { from: { kind: "agent", id: ATLAS_ID }, toAgentId: ADA_ID, asks: 2, tasks: 1, lastAt: ago(3) },
    { from: { kind: "person", id: "u1", name: "Rodrigo" }, toAgentId: ATLAS_ID, asks: 0, tasks: 5, lastAt: ago(4) },
  ],
  hiddenTasks: 0,
});

async function open(tasks: CentralTask[]) {
  const api = createFakeApi(
    seedState({
      central: view(tasks),
      taskManager: {
        tasks: [],
        ended: [],
        hidden: { total: 0, working: 0, byAgent: {} },
        computers: [],
        activity: {},
        followUps: [],
        canceledFollowUps: [],
      },
    }),
  );
  const r = await renderApp(`/org/${ORG_ID}/central`, { api });
  await settle(5);
  return r;
}

describe("the Central", () => {
  test("says who works on what, for whom, how far, and who asked whom", async () => {
    await open([task({})]);
    expect((await screen().findAllByText("Corrigir o login")).length).toBeGreaterThan(0);
    expect(screen().getAllByText("75% · 3/4").length).toBeGreaterThan(0);
    expect(screen().getAllByText(/Pedido por Atlas · começou com Rodrigo/).length).toBeGreaterThan(0);
    expect(screen().getByText("Quem fala com quem")).toBeTruthy();
    expect(screen().getByText("respondida")).toBeTruthy();
    expect(screen().getByText(/16\.0 \/ 32 GB/)).toBeTruthy();
    expect(screen().getByText("Quem orquestra quem")).toBeTruthy();
    expect(screen().getByText("2 perguntas, 1 tarefa")).toBeTruthy();
    expect(screen().getByText("5 pedidos")).toBeTruthy();
    expect(screen().getByText("640 MB em 3 processos")).toBeTruthy();
  });

  test("no plan, no percentage; a task gone quiet is said to be, and opens with its way out", async () => {
    await open([task({ state: "stalled", progress: null, lastSignalAt: ago(40) })]);
    const card = document.querySelector(".central-task");
    expect(card?.textContent).not.toContain("%");
    await act(async () => fireEvent.click(card as Element));
    await settle(3);
    expect(screen().getByText(/Nenhum passo há bastante tempo/)).toBeTruthy();
    expect(screen().getByText("sem plano, então sem porcentagem")).toBeTruthy();
    expect(document.querySelector(".central-panel")?.textContent).toContain("Parar");
  });
});

describe("an HTML block in a message", () => {
  test("shows as a sandboxed page, its code a press away", async () => {
    const { container } = render(<Markdown source={"```html\n<h1>Oi</h1>\n```"} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const frame = container.querySelector("iframe");
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
    expect(container.querySelector(".code-card")).toBeTruthy();
  });
});
