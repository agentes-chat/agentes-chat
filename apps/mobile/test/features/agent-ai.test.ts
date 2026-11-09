import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentBrain, MachineAccount } from "@agenteschat/client";
import { newAgentStart } from "@agenteschat/client/lib/agent-setup";
import { accountTitle, ownSignInTitle } from "@agenteschat/client/lib/ai-accounts";
import { CURSOR_KEY_PLAN, geminiPersonal, planOf, planReplies, signInKey } from "@agenteschat/client/lib/plans";
import { markOf } from "@agenteschat/ui/brand/marks";
import type { TFunction } from "i18next";
import { flowBack, modelInput, modelRows, modelSections, newAgentAi, pickedAi } from "../../src/features/ai/logic";
import { translator } from "./fixtures";

const account = (id: string, over: Partial<MachineAccount> = {}): MachineAccount => ({
  id,
  kind: "claude_code",
  label: id,
  email: null,
  plan: "max",
  status: "active",
  ownerId: "u1",
  ownerName: "Walter Nogueira",
  mine: true,
  usedBy: [],
  usage: null,
  provider: null,
  keyHint: null,
  ...over,
});

describe("the agent's AI", () => {
  test("the line under Atende outras pessoas follows the switch: its key by state, for one agent or all of them", () => {
    const keyOf = ((key: string) => key) as unknown as TFunction;
    const line = (on: boolean, agent: string | null) => planReplies(keyOf, { on, agent, brain: "claude_code" }).line;
    expect([line(false, "Ada"), line(true, "Ada"), line(false, null), line(true, null)]).toEqual([
      "aiAccounts.share.line.off",
      "aiAccounts.share.line.on",
      "aiAccounts.share.line.offAll",
      "aiAccounts.share.line.onAll",
    ]);
  });

  test("its words: whom the agent answers in each state and on which plan, the plan's terms behind the ⓘ", async () => {
    const en = await translator("en");
    const pt = await translator("pt-BR");
    const says = (t: TFunction, on: boolean, over: Partial<Parameters<typeof planReplies>[1]> = {}) =>
      planReplies(t, { on, agent: "Ada", brain: "claude_code", plan: "max", ...over });
    expect(says(en, false)).toEqual({
      line: "Ada answers only you, on your Claude plan.",
      about: "About the plan's terms",
      text: "Claude plans are for personal use. Letting other people use yours is a gray area in Claude's terms.",
    });
    expect(says(en, true).line).toBe("Ada answers anyone who can talk to her, on your Claude plan.");
    expect(says(pt, false)).toEqual({
      line: "A Ada só atende você, pelo seu plano do Claude.",
      about: "Sobre os termos do plano",
      text: "Os planos do Claude são para uso pessoal. Deixar outras pessoas usarem o seu é uma zona cinzenta nos termos do Claude.",
    });
    expect(says(pt, true).line).toBe("A Ada atende quem pode falar com ela, pelo seu plano do Claude.");
    // A Grok plan (ADR 0142): the same note, in Grok's name.
    expect(says(en, false, { brain: "grok", plan: null })).toEqual({
      line: "Ada answers only you, on your Grok plan.",
      about: "About the plan's terms",
      text: "Grok plans are for personal use. Letting other people use yours is a gray area in Grok's terms.",
    });
    expect(says(pt, false, { brain: "grok", plan: null }).text).toBe(
      "Os planos do Grok são para uso pessoal. Deixar outras pessoas usarem o seu é uma zona cinzenta nos termos do Grok.",
    );
    // A Gemini Enterprise seat (ADR 0143): a seat's usual words; a personal plan has Google's warning, said plainly.
    expect(says(en, false, { brain: "antigravity", plan: "enterprise" }).line).toBe(
      "Ada answers only you, on your Gemini seat.",
    );
    expect(pt("connectAi.plan.gemini.warning")).toBe(
      "O Google diz que usar um plano pessoal do Gemini dentro de outros apps pode suspender a conta. Para não correr esse risco, use uma chave de API ou o Gemini Enterprise.",
    );
    expect(geminiPersonal({ provider: "enterprise" })).toBe(false);
    expect(geminiPersonal(undefined)).toBe(true);
    expect(says(pt, true, { agent: "Theo" }).line).toBe(
      "O Theo atende quem pode falar com ele, pelo seu plano do Claude.",
    );
    // Every agent of a plan's panel.
    expect([false, true].map((on) => says(en, on, { agent: null }).line)).toEqual([
      "They answer only you, on your Claude plan.",
      "They answer anyone who can talk to them, on your Claude plan.",
    ]);
    expect([false, true].map((on) => says(pt, on, { agent: null }).line)).toEqual([
      "Só atendem você, pelo seu plano do Claude.",
      "Atendem quem pode falar com eles, pelo seu plano do Claude.",
    ]);
    // ChatGPT's plan, a seat, a coding plan by its name in its maker's words.
    expect(says(en, false, { brain: "codex", plan: null }).line).toBe("Ada answers only you, on your ChatGPT plan.");
    expect(says(en, false, { plan: "Team" })).toMatchObject({
      line: "Ada answers only you, on your Claude seat.",
      text: "Each Claude seat is for one person. Letting other people use yours is a gray area in Claude's terms.",
    });
    expect(says(pt, false, { plan: "team" }).line).toBe("A Ada só atende você, pelo seu assento do Claude.");
    const glm = planOf("zai");
    expect(says(en, true, { coding: glm })).toMatchObject({
      line: "Ada answers anyone who can talk to her, on your GLM Coding plan.",
      text: "Z.ai says the plan is for its subscriber only. Letting other people use yours is a gray area in Z.ai's terms.",
    });
    expect(says(pt, false, { coding: glm }).line).toBe("A Ada só atende você, pelo seu plano GLM Coding.");
    // The phone's header over it.
    expect([en("mobile.ai.audience", { context: "female" }), pt("mobile.ai.audience", { context: "female" })]).toEqual([
      "Who she answers",
      "Quem ela atende",
    ]);
  });

  test("the new agent's AI step: Conectar uma IA opens the same sheet as Settings, for the agent being made", async () => {
    // The screens are components the tests can't render: what they wire in, as text.
    const read = (path: string) => Bun.file(new URL(`../../src/features/${path}`, import.meta.url).pathname).text();
    const [screen, sheet] = await Promise.all([read("agents/NewAgentScreen.tsx"), read("ai/ConnectAi.tsx")]);
    expect(screen).toContain('label={t("aiAccounts.page.connect")}');
    expect(screen).toContain('openConnectAi({ forNew: "1" });');
    // The plan it connects is what the agent thinks with once it shows up, over a pick made before; nothing new keeps it.
    expect(screen).toContain("newPlanAccountOption(brainOptions, optionsBefore)");
    expect(screen).toContain("connectedHere ?? picked");
    // For the agents I create: none of mine is offered, so a plan signs in for the new one.
    expect(sheet).toMatch(/params\.forNew === "1"\s*\? \[\]/);
    expect(sheet).toContain("queryKey: keys.brainMachines(orgId)");
  });

  test("under a hold, Uso's empty plans card says what comes first and invites no plan", async () => {
    // The screens are components the tests can't render: what they wire in, as text.
    const usage = await Bun.file(new URL("../../src/features/usage/UsageScreen.tsx", import.meta.url).pathname).text();
    expect(usage).toContain("usePlanHold(orgId, org)");
    expect(usage.indexOf("<PlanHoldNote")).toBeGreaterThan(-1);
    expect(usage.indexOf("<PlanHoldNote")).toBeLessThan(usage.indexOf('place="ai"'));
    expect(usage).toContain("data.accounts.length === 0 && hold ?");
  });

  test("the agent's AI and a plan's page draw the same switch and ⓘ, and nothing asks to accept the terms", async () => {
    // The screens are components the tests can't render: what they wire in, as text.
    const read = (file: string) => Bun.file(new URL(`../../src/features/ai/${file}`, import.meta.url).pathname).text();
    // The agent's switch is under its AI, as on the web.
    const [screen, connect, parts] = await Promise.all([
      read("AgentAiScreen.tsx"),
      read("ConnectAiSteps.tsx"),
      read("parts.tsx"),
    ]);
    for (const source of [screen, connect]) {
      expect(source).toMatch(/import \{[^}]*\bPlanReplies\b[^}]*\} from "\.\/parts"/);
      expect(source).toContain("<PlanReplies");
      expect(source).not.toMatch(/acceptPlanTerms|share\.title|share\.accept|connectAi\.onlyYou|own\.note/);
    }
    // One switch, its ⓘ right after the label: whom it answers in its state, on which plan, then the plan's words.
    expect(parts).toContain('const label = t("aiAccounts.share.switch");');
    expect(parts).toContain("planReplies(t, { on, agent, owner, brain, plan, coding })");
    expect(parts).toContain(["text: `$", "{says.line} $", "{says.text}`"].join(""));
    // The line names the agent.
    expect(screen).toMatch(/<PlanReplies\s+agent=\{name\}/);
    expect(connect).toMatch(/<PlanReplies\s+agent=\{done\?\.agent \?\? agent\?\.name \?\? ""\}/);
    // An admin who isn't the plan's owner gets the same switch, its words naming whose plan it is, and turning it on
    // over someone else's plan asks first.
    expect(screen).toContain("{...(whose ? { owner: whose } : {})}");
    expect(screen).toContain("if (on && !(await ask(EVERYONE_AUDIENCE)([]))) return;");
    expect(screen).not.toContain("PlanRepliesOf");
    // On a plan's page: on the page that says it's done.
    expect(connect).toContain("<View style={styles.doneReplies}>{repliesRow}</View>");
    // Both say the plan of what the agent thinks with, the computer's own sign-in's included (`signInPlan`).
    expect(screen).toContain("plan={signInPlan(view, computerRow, view.brain as MachineAccountKind)}");
    expect(connect).toContain("signInPlan(view, gates.row, kind)");
    expect(connect).toContain("plan={replies.plan}");
  });

  test("Claude's sign-in asks for no address: Claude's page picks the account, an account already there is offered", async () => {
    // The flow is a component the tests can't render: what it wires in, as text.
    const flow = await Bun.file(new URL("../../src/features/ai/AddAccount.tsx", import.meta.url).pathname).text();
    expect(flow).not.toMatch(/TextInput|emailAddress|aiAccounts\.add\.email/);
    // The hint (the account's own email, signing in again) goes through the shared start the client tests pin.
    expect(flow).toMatch(/beginLogin\(\s*\(input\) => api\.machines\.beginAccountLogin\(/);
    expect(flow).toMatch(/\{\s*again,\s*provider,\s*hint,\s*\}/);
    expect(flow).toContain("freeDuplicate(result)");
    expect(flow).toContain('t("connectAi.useAnyway"');
    // "Usar" only where an agent is in view (`onUse`); signing in again as someone else says both addresses.
    expect(flow).toContain("onPress={() => onUse(reuse)}");
    expect(flow).toContain("const otherEmail = other?.email ?? (hint ? result?.signedInAs : undefined);");
    expect(flow).toMatch(/otherEmail\s*\?\s*t\(`connectAi\.otherAccount\.\$\{kind\}`/);
    // A new login that comes back as another account than its hint never thinks by itself: Usar or Tentar de novo.
    expect(flow).toMatch(/if \(otherThanHint\(hint, result\.account\)\) setOther\(result\.account\);\s+else onAdded/);
    expect(flow).toContain("onPress={() => onAdded(other)}");
    expect(flow).toMatch(/if \(other && !again\) void api\.machines\.removeAccount\(orgId, machineId, other\.id\)/);
    const t = await translator("pt-BR");
    expect(t("agentPage.work.brain.add.duplicate.claude_code", { account: "ana@acme.com" })).toBe(
      "O Claude entrou como ana@acme.com, uma conta que você já conectou. Para usar outra, saia na página do Claude e tente de novo.",
    );
    expect(t("connectAi.otherAccount.claude_code", { email: "walt@gmail.com", account: "walt@acme.com" })).toBe(
      "O Claude entrou como walt@gmail.com, não como walt@acme.com. Saia na página do Claude e tente de novo.",
    );
    expect(t("connectAi.own.shared")).toBe("A conta que os seus agentes dividem");
  });

  test("signing in again sends the account's own email as the hint, from Settings and from Connect an AI", async () => {
    const read = (file: string) => Bun.file(new URL(`../../src/features/ai/${file}`, import.meta.url).pathname).text();
    const settings = await read("AiAccountsScreen.tsx");
    const connect = await read("ConnectAiSteps.tsx");
    expect(settings).toMatch(/again=\{again\.id\}\s+email=\{again\.email\}/);
    expect(connect).toMatch(
      /again=\{hint \? hint\.again : signedOut\?\.id\}\s+email=\{hint \? hint\.email : signedOut\?\.email\}/,
    );
    // One more login of another agent's account (`email`, or a row of what the person has) is never the agent's own
    // signed-out login again.
    expect(connect).toContain("= login ?? (email ? { email } : undefined);");
    expect(connect).toContain('const signedOut = !hint && current?.status === "signed_out" ? current : undefined;');
    // An account already connected thinks for an agent only where one is in view: Connect an AI, never Settings.
    expect(connect).toContain("onUse={(a) => void assign(a)}");
    expect(settings).not.toContain("onUse=");
  });

  test("Claude's code goes by itself however it lands in the field; anything else waits for Enviar, with a line", async () => {
    // The flow and its field are components the tests can't render: what they wire in, as text.
    const read = (file: string) => Bun.file(new URL(`../../src/features/ai/${file}`, import.meta.url).pathname).text();
    const [flow, parts] = await Promise.all([read("AddAccount.tsx"), read("parts.tsx")]);
    // Typed, pasted with the keyboard or by Colar: one path, and only this sign-in's code sends with no tap.
    expect(flow).toMatch(
      /const take = \(text: string\) => \{[^}]*if \(!plan && login && ready && !loading && isSignInCode\(text, login\.url\)\) void send\(text\);/,
    );
    expect(flow).toContain("onChangeText={take}");
    expect(flow).toContain("onPasted={take}");
    expect(flow).toMatch(
      /key && !isSignInCode\(key, login\.url\) \? \(\s*<Note icon="x">\{t\("agentPage\.work\.brain\.add\.notCode"\)\}<\/Note>/,
    );
    // Colar only while the field is empty, the text's edge then the same on both sides.
    expect(parts).toMatch(/const empty = !value\.trim\(\);/);
    expect(parts).toMatch(/\{empty \? \(\s*<View style=\{styles\.insetAction\}>/);
    expect(parts).toContain("!empty && styles.insetFull");
    const t = await translator("pt-BR");
    expect(t("agentPage.work.brain.add.notCode")).toBe("Isso não parece o código do Claude.");
  });

  test("while the code or the key goes and the computer signs in, the orbit and a line stand in for the field and Enviar", async () => {
    // The flow is a component the tests can't render: what it wires in, as text.
    const flow = await Bun.file(new URL("../../src/features/ai/AddAccount.tsx", import.meta.url).pathname).text();
    expect(flow).toContain("const busy = (sending || sent) && !ended;");
    // Claude's code, Gemini's and a plan's key: the line in place of the field and its button, never beside them.
    expect(flow.match(/\{busy\s+\? busyLine\s+: pasteRow\(/g)).toHaveLength(3);
    expect(flow).toMatch(/<Note icon=\{<InkOrbit size=\{15\} \/>\} live>\s*\{busyText\}/);
    // A failed send brings the field back with what was in it: only a code that went clears it.
    expect(flow).toMatch(/setSent\(true\);\s+setCode\(""\);/);
    const t = await translator("pt-BR");
    expect(t("agentPage.work.brain.add.sending", { computer: "MacBook" })).toBe("Enviando o código ao MacBook…");
    expect(t("aiAccounts.add.keySent", { computer: "MacBook" })).toBe(
      "Chave enviada. O MacBook está terminando de entrar.",
    );
  });

  test("a card whose plan's sign-in ended: the agent says so, and Entrar de novo opens on its own plan", async () => {
    const read = (file: string) => Bun.file(new URL(`../../src/features/ai/${file}`, import.meta.url).pathname).text();
    const [card, sheet] = await Promise.all([read("NoAiCard.tsx"), read("ConnectAi.tsx")]);
    expect(card).toContain("t(noAiLineKey(card), agentGrammar(name))");
    // The plan the client tests pin (`signInAgainPlan`): ChatGPT for a Codex agent, never Claude's page.
    expect(card).toContain("const again = signInAgainPlan(card, agent);");
    expect(card).toContain('t(again ? "agentPage.work.brain.signInAgain" : "noAi.action")');
    expect(card).toContain("...(plan ? { plan } : {}),");
    expect(sheet).toContain("PLAN_CHOICES.find((c) => c === params.plan) ?? choiceOfIntent(");
    const t = await translator("pt-BR");
    expect(t("noAi.signedOut", { name: "Ada", context: "female" })).toBe(
      "Ada não vai responder porque a IA dela saiu da\u00a0conta.",
    );
  });

  test("the computer's own sign-in: listed only where it can think for the agent, and a card that says how when it isn't", async () => {
    // The screens are components the tests can't render: what they wire in, as text.
    const read = (file: string) => Bun.file(new URL(`../../src/features/ai/${file}`, import.meta.url).pathname).text();
    const [pick, card, connect] = await Promise.all([
      read("AiPick.tsx"),
      read("NoAiCard.tsx"),
      read("ConnectAiSteps.tsx"),
    ]);
    // Its row only where the client tests say (`aiRows`, `ownSignInListed`): never on the workspace's computer.
    expect(pick).toContain("aiRows(t, i18n.language, {");
    expect(pick).toContain("computer: computerRow,");
    // A plan's page waits for the computer's row for ChatGPT too, not only Claude (`ownSignInFor`).
    expect(connect).toContain("brain: view && (ai.data || !(isPlanId(choice) || view.ownSignIn)) ? view : undefined,");
    // Its card: what isn't signed in and where to connect, and Conectar on that CLI's plan.
    expect(card).toContain("t(noAiLineKey(card), agentGrammar(name))");
    expect(card).toContain("const plan = card.own ? planOfKind(card.own) : again;");
    const pt = await translator("pt-BR");
    expect(pt("noAi.notSignedIn.codex", { context: "female", name: "Ada" })).toBe(
      "O Codex está sem login neste computador. Conecte uma conta do ChatGPT na página da Ada.",
    );
    const en = await translator("en");
    expect(en("noAi.notSignedIn.codex", { name: "Ada" })).toBe(
      "Codex isn't signed in on this computer. Connect a ChatGPT account on Ada's page.",
    );
    expect(en("noAi.notSignedIn.claude_code", { name: "Ada" })).toBe(
      "Claude Code isn't signed in on this computer. Connect a Claude account on Ada's page.",
    );
  });

  test("nothing to pick on someone else's computer says who adds sign-ins there; Conectar opens on the agent's plan", async () => {
    const read = (path: string) => Bun.file(new URL(`../../src/${path}`, import.meta.url).pathname).text();
    const [grouped, card, connect, profile] = await Promise.all([
      read("ui/Grouped.tsx"),
      read("features/ai/NoAiCard.tsx"),
      read("features/ai/ConnectAiSteps.tsx"),
      read("features/agents/AgentProfileScreen.tsx"),
    ]);
    // No empty card: a list with nothing in it isn't drawn.
    expect(grouped).toContain("if (items.length === 0) return null;");
    // Still waiting, a waiting pill (its sentence wraps to two or three lines on a phone): the breathing mark and
    // Connect tinted for who may connect, a quiet bolt and who can for anyone else.
    expect(card).toContain(
      '<AskWaiting forMe={action !== null} mark="bolt" words={title} actions={action} below={action ? null : locked} />',
    );
    expect(card).not.toContain("<Button");
    // "Ada's page": its Conectar opens on the plan she thinks with (`agentPlan`), ChatGPT for Codex.
    expect(profile).toContain("openConnectAi({ agentId: id, plan: agentPlan(agent) ?? undefined })");
    // A plan's page asks the computers for their own sign-ins again: Codex's is known by a usage read with it.
    expect(connect).toContain("if (asks) void api.machines.refreshAccountUsage(orgId).catch(() => undefined);");
    const pt = await translator("pt-BR");
    expect(pt("connectAi.accountsLocked", { name: "Theo", computer: "MacBook" })).toBe(
      "Só Theo conecta um plano no MacBook.",
    );
    // The line above the card, and the conversation lists' preview: never "saiu da conta" where nobody signed in.
    expect(pt("chat.body.no_ai_not_signed_in", { brain: "Codex" })).toBe(
      "Ainda não consigo responder: o Codex está sem login no meu computador.",
    );
    const en = await translator("en");
    expect(en("chat.body.no_ai_not_signed_in", { brain: "Claude Code" })).toBe(
      "I can't answer yet: Claude Code isn't signed in on my computer.",
    );
  });

  test("on the Cloud the account's sign-in says the computer, never its name; its being ready is a card of its own", async () => {
    const connect = await Bun.file(
      new URL("../../src/features/ai/ConnectAiSteps.tsx", import.meta.url).pathname,
    ).text();
    expect(connect).toMatch(/computer=\{edition === "cloud" \? t\("connectAi\.theComputer"\) : computer\}/);
    // Where the wait's card was: never read as the head of the account choice under it.
    expect(connect).toMatch(/<InfoCard icon="check" live>\s*\{t\("connectAi\.wait\.ready"\)\}/);
    const said = {
      "pt-BR": [
        "Enviar ao computador",
        "Pedindo ao computador…",
        "Código enviado. O computador está terminando de entrar.",
        "O computador não respondeu. Tente de novo em instantes.",
      ],
      en: [
        "Send to the computer",
        "Asking the computer…",
        "Code sent. Finishing the sign-in on the computer.",
        "No answer from the computer. Try again in a moment.",
      ],
    };
    for (const lang of ["pt-BR", "en"] as const) {
      const t = await translator(lang);
      const computer = t("connectAi.theComputer");
      expect(
        ["send", "starting", "sent", "startFailed"].map((k) => t(`agentPage.work.brain.add.${k}`, { computer })),
      ).toEqual(said[lang]);
    }
  });

  test("an account says its plan once, after its name, and Claude's plans go by Anthropic's names", async () => {
    expect(accountTitle(account("Claude", { plan: "ultra" }))).toBe("Claude · Ultra");
    expect(accountTitle(account("Claude 2"))).toBe("Claude 2 · Max");
    expect(accountTitle(account("GLM Coding", { plan: null, provider: "zai" }))).toBe("GLM Coding");
    // The agent's AI and Connect an AI (their rows), Contas de IA and Você name accounts so, and a computer's own
    // sign-in by its maker the same way ("Claude · Max").
    expect(ownSignInTitle(await translator("pt-BR"), { kind: "claude_code", plan: "max" })).toBe("Claude · Max");
    const read = (file: string) => Bun.file(new URL(`../../src/features/${file}`, import.meta.url).pathname).text();
    const rows = await Bun.file(
      new URL("../../../../packages/client/src/lib/ai-select.ts", import.meta.url).pathname,
    ).text();
    expect(rows).toContain("label: accountTitle(a),");
    // AI accounts' grouped rows take a `label`, the Me page's rows a `title`.
    for (const [screen, row, prop] of [["ai/AiAccountsScreen.tsx", "a", "label"]]) {
      const source = await read(screen);
      expect(source).toContain(`${prop}={accountTitle(${row})}`);
      expect(source).toContain(`${prop}={ownSignInTitle(t, o)}`);
      expect(source).not.toContain("planWordOf(o.plan)");
    }
    expect((await translator("pt-BR"))("connectAi.plan.claude.tiers")).toBe("Pro, Max, Ultra, Team ou Enterprise");
    expect((await translator("en"))("connectAi.plan.claude.tiers")).toBe("Pro, Max, Ultra, Team or Enterprise");
  });

  test("its model: Automático, then every model of its plan with what it's sold as, the one it runs checked", async () => {
    const t = await translator("pt-BR");
    const claude: AgentBrain["options"][number] = {
      kind: "claude_code",
      available: true,

      models: [
        { value: "opus", label: "Opus" },
        { value: "sonnet", label: "Sonnet", recommended: true },
        { value: "haiku", label: "Haiku" },
      ],
      defaultModel: "sonnet",
    };
    const view = (effectiveModel: string) => ({ brain: "claude_code" as const, effectiveModel, options: [claude] });
    const go = modelRows(t, view("deepseek-v4.1-flash"), planOf("opencode"));
    expect(go).toHaveLength(31);
    expect(go[0]).toEqual({
      value: "auto",
      label: "Automático",
      sub: "Escolhe o modelo e o esforço para cada tarefa",
      checked: false,
    });
    expect(go.slice(1, 4).map((r) => [r.value, r.label, r.maker])).toEqual([
      ["sonnet", "MiniMax M3", "minimax"],
      ["minimax-m3.1-flash", "MiniMax M3.1 Flash", "minimax"],
      ["haiku", "Claude Haiku 5.5", "anthropic"],
    ]);
    // What it's sold as, and what the plan's account must allow first (read out with its name).
    expect(go.filter((r) => r.checked)).toEqual([
      {
        value: "deepseek-v4.1-flash",
        label: "DeepSeek V4.1 Flash",
        sub: "Econômico",
        note: "Precisa da região Global no OpenCode.",
        needs: "globalRegion",
        maker: "deepseek",
        checked: true,
      },
    ]);
    // A list per maker after Automático's, as the web groups them.
    const sections = modelSections(go);
    expect(sections.map((s) => s.maker ?? null)).toEqual([
      null,
      "minimax",
      "anthropic",
      "zai",
      "moonshot",
      "Alibaba",
      "deepseek",
      "Xiaomi",
      "openai",
      "gemini",
      "xAI",
      "Meituan",
      "Tencent",
      "StepFun",
      "Meta",
      "Reflection",
      "OpenCode",
    ]);
    expect(sections[0]?.rows.map((r) => r.label)).toEqual(["Automático"]);
    // Every maker beside its own mark, never a letter.
    expect(sections.slice(1).filter((s) => !markOf(s.maker))).toEqual([]);
    // A model that trains on what it's sent: its provider does, said behind the row's ⓘ.
    expect(go.find((r) => r.value === "iceman-contributor-free")?.note).toBe(
      "Grátis. O provedor pode usar os pedidos para treinar o modelo. Ligue a permissão no OpenCode.",
    );
    expect(sections.flatMap((s) => s.rows)).toEqual(go);
    expect(modelSections(modelRows(t, view("k3-256k"), planOf("kimi")))).toHaveLength(1);
    // On Claude's sign-in: its aliases; a plan's model kept from before runs Sonnet there.
    const own = modelRows(t, view("deepseek-v4.1-flash"), undefined);
    expect(own.map((r) => r.label)).toEqual(["Automático", "Opus", "Sonnet", "Haiku"]);
    expect(own.find((r) => r.checked)?.label).toBe("Sonnet");
    // An alias the plan leaves out runs its main model.
    expect(modelRows(t, view("opus"), planOf("zai")).find((r) => r.checked)?.label).toBe("GLM-5.3");
    // OpenCode (ADR 0132): the models its CLI listed, the free ones marked Grátis.
    const opencode: AgentBrain["options"][number] = {
      kind: "opencode",
      available: true,
      models: [
        { value: "opencode/big-pickle", label: "Big Pickle", free: true },
        { value: "opencode/glm-5.3", label: "glm-5.3" },
      ],
      defaultModel: null,
    };
    const oc = modelRows(
      t,
      { brain: "opencode", effectiveModel: "opencode/big-pickle", options: [opencode] },
      undefined,
    );
    expect(oc.map((r) => [r.label, r.sub ?? null, r.checked])).toEqual([
      ["Automático", "Escolhe o modelo e o esforço para cada tarefa", false],
      ["Big Pickle", "Grátis", true],
      ["glm-5.3", null, false],
    ]);
    // An OpenCode key: the computer listed its CLI's models with no key (the free tier), so OpenCode Go's models come
    // after them, as its CLI names them with that key. DeepSeek V4.1 Flash is there, with the region it needs.
    const keyed = modelRows(
      t,
      {
        brain: "opencode",
        effectiveModel: "opencode-go/deepseek-v4.1-flash",
        options: [opencode],
        account: "oc",
        accounts: [account("oc", { kind: "opencode", provider: "zen", keyHint: "Q7f2" })],
      },
      undefined,
    );
    expect(keyed.slice(0, 3).map((r) => r.label)).toEqual(["Automático", "Big Pickle", "glm-5.3"]);
    expect(keyed.find((r) => r.checked)).toMatchObject({
      value: "opencode-go/deepseek-v4.1-flash",
      label: "DeepSeek V4.1 Flash",
      maker: "deepseek",
      needs: "globalRegion",
    });
    expect(keyed).toHaveLength(3 + 30);
  });

  test("picking a model saves as the web does: Automático picks the effort too, a fixed one after it starts at Médio", () => {
    const options: AgentBrain["options"] = [
      { kind: "claude_code", available: true, models: [], defaultModel: "sonnet" },
    ];
    const view = (effort: AgentBrain["effort"]) => ({ brain: "claude_code" as const, options, effort });
    expect(modelInput("auto", view(null))).toEqual({ model: "auto", effort: "auto" });
    expect(modelInput("k3-256k", view("auto"))).toEqual({ model: "k3-256k", effort: "medium" });
    expect(modelInput("k3-256k", view("high"))).toEqual({ model: "k3-256k" });
    // The brain's default is stored as none.
    expect(modelInput("sonnet", view("low"))).toEqual({ model: null });
  });

  test("the agent's AI opens its model on a page of its own, pushed over it", async () => {
    // The screens are components the tests can't render: what they wire in, as text.
    const screen = await Bun.file(new URL("../../src/features/ai/AgentAiScreen.tsx", import.meta.url).pathname).text();
    expect(screen).toContain("router.push(`/agent-model/");
    expect(screen).toContain("onPress={() => openAgentModel(agentId)}");
    expect(screen).toContain("void save(modelInput(r.value, view), done);");
    expect(screen).toContain("modelSections(rows).map(");
    expect(screen).toContain("<GroupedHeader>{providerLabel(s.maker)}</GroupedHeader>");
    expect(screen).toContain('hint: { name: t("common.about", { label: r.label }), text: r.note }');
    const route = await Bun.file(new URL("../../app/(app)/agent-model/[id].tsx", import.meta.url).pathname).text();
    expect(route).toContain("<AgentModelScreen agentId={id");
  });

  test("a sign-in through a restart or a reconnect: Reconectando while reads fail, the same sign-in kept, then a failure", async () => {
    // The flow and its panel are components the tests can't render: what they wire in, as text. How long reads may
    // fail, and which failures pass, are the client's `loginRead` (its tests pin them).
    const read = (file: string) => Bun.file(new URL(`../../src/features/ai/${file}`, import.meta.url).pathname).text();
    const [flow, connect] = await Promise.all([read("AddAccount.tsx"), read("ConnectAiSteps.tsx")]);
    expect(flow).toContain("const read = loginRead(status);");
    expect(flow).not.toContain("status.isError");
    expect(flow).toMatch(/read === "reconnecting" \? t\("agentPage\.work\.brain\.add\.reconnecting"\)/);
    // Past the wait, the computer that didn't answer; what the computer says still shows at once.
    expect(flow).toContain('const noAnswer = startFailed !== null || read === "noAnswer";');
    expect(flow).toMatch(
      /: noAnswer\s*\?\s*\(startFailed \?\? t\("agentPage\.work\.brain\.add\.startFailed", \{ computer \}\)\)/,
    );
    expect(flow).toContain('result?.state === "failed" || result?.state === "expired"');
    // Its computer offline mid-sign-in: the steps stay, with no offline card or key over them, and nothing restarts.
    expect(connect).toContain(
      'const steps = ready || gate.state === "preparing" || (gate.state === "offline" && signingIn);',
    );
    expect(connect).toContain('} else if (why && !(gate.state === "offline" && signingIn)) {');
    expect(connect).toContain("offersKeyNow(gate, hold !== null) && !signingIn");
    expect(connect).toContain("onSigningIn={setSigningIn}");
    expect(flow).toMatch(
      /useEffect\(\(\) => \{\s*onSigningIn\?\.\(begun\);\s*return \(\) => onSigningIn\?\.\(false\);/,
    );
    // Claude's code meanwhile: Reconectando by its field, a code that lands there waits for Enviar (`take` sends only
    // to a ready computer), and one that couldn't go says the computer didn't answer, never to check the code.
    expect(flow).toContain('side={read === "reconnecting" ? waiting : undefined}');
    expect(flow).toContain('setSendFailed(loginReadPasses(error) ? "away" : "refused");');
    expect(flow).toMatch(
      /sendFailed === "away"\s*\?\s*t\("agentPage\.work\.brain\.add\.startFailed", \{ computer \}\)/,
    );
    expect((await translator("pt-BR"))("agentPage.work.brain.add.reconnecting")).toBe("Reconectando…");
    expect((await translator("en"))("agentPage.work.brain.add.reconnecting")).toBe("Reconnecting…");
  });

  test("Criar agente on the phone thinks with the last setup: the API's model and key, or a plan saved right after", async () => {
    expect(newAgentAi(null)).toEqual({
      model: "auto",
      credentialId: null,
      contextTokens: null,
      plan: null,
      connect: null,
    });
    const api = { brain: "model" as const, model: "claude-opus-5-5", key: "k1", contextTokens: 400_000 };
    expect(newAgentAi(api)).toEqual({
      model: "claude-opus-5-5",
      credentialId: "k1",
      contextTokens: 400_000,
      plan: null,
      connect: null,
    });
    // A model no key runs now starts on Automático, and a key the creator can't see isn't sent, as on the web.
    const runs = { ownerIsMe: true, usable: new Set(["claude-opus-5-5"]), keys: [] };
    expect(newAgentAi(newAgentStart(api, { ...runs, usable: new Set() }))).toMatchObject({
      model: "auto",
      credentialId: null,
    });
    expect(newAgentAi(newAgentStart(api, runs))).toMatchObject({ model: "claude-opus-5-5", credentialId: null });
    const screen = await Bun.file(
      new URL("../../src/features/agents/NewAgentScreen.tsx", import.meta.url).pathname,
    ).text();
    expect(screen).toContain('{ brain: "model", contextTokens: thinks.contextTokens }');
    const input = { brain: "claude_code" as const, account: "a1", model: "opus", effort: "high" as const };
    expect(
      newAgentAi({
        brain: "claude_code",
        machineId: "m1",
        computer: "MacBook",
        account: { id: "a1", label: "Claude" },
        input,
      }),
    ).toEqual({
      model: "auto",
      credentialId: null,
      contextTokens: null,
      plan: { machineId: "m1", input },
      connect: null,
    });
    // The setup's Autonomia goes at creation, with the API's model or a plan.
    expect(newAgentAi({ ...api, autonomy: "never" })).toMatchObject({ model: "claude-opus-5-5", autonomy: "never" });
    const plan = { brain: "claude_code" as const, machineId: "m1", computer: "MacBook", account: null, input };
    expect(newAgentAi({ ...plan, autonomy: "always" })).toMatchObject({ model: "auto", autonomy: "always" });
    expect(newAgentAi(null).autonomy).toBeUndefined();
    expect(screen).toContain("...(thinks.autonomy ? { autonomy: thinks.autonomy } : {})");
  });

  test("Criar agente on the phone: anything Quem pensa offers, as the web's step sends it", async () => {
    expect(pickedAi({ kind: "model", model: "claude-sonnet-5-5" }, [])).toMatchObject({
      model: "claude-sonnet-5-5",
      plan: null,
      connect: null,
    });
    expect(
      pickedAi({ kind: "claude_code", choice: "opencode", machineId: "m1", accountId: "acc-go", model: "glm-5.3" }, []),
    ).toMatchObject({
      model: "auto",
      connect: null,
      plan: { machineId: "m1", input: { brain: "claude_code", account: "acc-go", model: "glm-5.3" } },
    });
    // Automático on a plan is the agent's own already: only the brain is saved. The computer's own ChatGPT sign-in
    // thinks for my agents there: nothing to connect.
    const signedIn = [
      { machineId: "m1", name: "Mac", online: true, mine: true, canAdd: true, keys: true, own: { codex: {} } },
    ] as never;
    const codex = pickedAi({ kind: "codex", choice: "chatgpt", machineId: "m1", model: "auto" }, signedIn);
    expect(codex.plan).toEqual({ machineId: "m1", input: { brain: "codex" } });
    expect(codex.connect).toBeNull();
    // Not signed in there (or not my computer): the plan is saved, then ChatGPT's sign-in opens, as on the web.
    expect(pickedAi({ kind: "codex", choice: "chatgpt", machineId: "m1", model: "auto" }, []).connect).toBe("chatgpt");
    expect(pickedAi({ kind: "claude_code", choice: "claude", machineId: "m1", model: "auto" }, signedIn).connect).toBe(
      "claude",
    );
    // A coding plan with no key yet: made on Automático, Connect opens on that plan once it exists.
    expect(pickedAi({ kind: "connect", choice: "opencode" }, [])).toMatchObject({
      model: "auto",
      plan: null,
      connect: "opencode",
    });
    const screen = await Bun.file(
      new URL("../../src/features/agents/NewAgentScreen.tsx", import.meta.url).pathname,
    ).text();
    expect(screen).toContain("openConnectAi({ agentId: agent.id, plan: thinks.connect })");
    expect(screen).toContain("<BrainPickSheet");
    // No last setup: a plan account of mine (one connected before I had an agent) thinks for it, as on the web.
    expect(screen).toContain("(proposed || start ? null : (ownPlan ?? null))");
    expect(screen).toContain("const ownPlan = planAccountOption(brainOptions);");
  });
});

test("a Cursor sign-in on the phone: its own steps, or its API key when chosen, never Claude's code", async () => {
  // The flow is a component the tests can't render: what it wires in, as text.
  const flow = await Bun.file(new URL("../../src/features/ai/AddAccount.tsx", import.meta.url).pathname).text();
  expect(flow).toContain('} else if (kind === "cursor") {');
  expect(flow).toContain("agentPage.work.brain.add.cursorFinish");
  expect(flow).toContain("signInKey(planId, kind, cursorKey)");
  expect(signInKey(undefined, "cursor", false)).toEqual({ plan: undefined, provider: undefined });
  expect(signInKey(undefined, "cursor", true)).toEqual({ plan: CURSOR_KEY_PLAN, provider: "cursor" });
  expect(signInKey(undefined, "claude_code", true).plan).toBeUndefined();
  expect(signInKey("zai", "claude_code", false)).toEqual({ plan: planOf("zai") as never, provider: "zai" });
});

describe("Seus planos' rows", () => {
  test("a list row keeps 14 above and below its words and a card's 16 at its sides", () => {
    const row = readFileSync(join(import.meta.dir, "../../src/ui/Row.tsx"), "utf8");
    expect(row).toContain("paddingHorizontal: CARD_PAD,\n        paddingVertical: 14,");
    expect(row).toContain("left: leading ? CARD_PAD + LEAD + 12 : CARD_PAD,");
  });
});

describe("Back in Connect an AI", () => {
  test("a plan picked from the list goes back to the list, a sign-in from a row of what the person has to that row", () => {
    const plan = { page: "plan", choice: "chatgpt" } as const;
    expect(flowBack(plan, false)).toEqual({ page: "plans" });
    expect(flowBack(plan, true)).toEqual({ page: "home" });
    expect(flowBack({ page: "plans" }, false)).toEqual({ page: "home" });
    expect(flowBack({ page: "makers" }, false)).toEqual({ page: "key" });
    expect(flowBack({ page: "key" }, false)).toEqual({ page: "home" });
    expect(flowBack({ page: "home" }, false)).toBeNull();
  });
});

describe("Outro provedor on the phone", () => {
  test("the API under a header across the width, Buscar modelos on the add line's header, + in the field, × per model", async () => {
    // The screen is a component the tests can't render: what it wires in, as text.
    const form = await Bun.file(new URL("../../src/features/ai/EndpointForm.tsx", import.meta.url).pathname).text();
    expect(form).toContain('<GroupedHeader>{t("endpoint.style")}</GroupedHeader>');
    expect(form).toContain('wide="fit"');
    expect(form.indexOf('t("endpoint.style")')).toBeLessThan(form.indexOf('t("endpoint.address")'));
    expect(form).toMatch(
      /<GroupedHeader\s+aside=\{\s*<Button\s+variant="text"\s+size="sm"\s+label=\{t\("endpoint\.fetch"\)\}/,
    );
    expect(form).toContain('<IconButton icon="plus" label={t("endpoint.add")}');
    expect(form).toContain("withoutModel(d, m.id)");
  });
});
