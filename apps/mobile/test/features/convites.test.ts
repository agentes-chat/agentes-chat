import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Agent, InviteLink, JoinRequest, OrgRole } from "@agenteschat/client";
import { linkStanding, PLAIN_LINK, sameChoices } from "@agenteschat/client/lib/invite-start";
import { arrivalOf } from "../../src/features/chat/logic";
import { EMPTY_INVITE, type InviteDraft } from "../../src/features/members/draft";
import {
  agentLines,
  agentPicks,
  channelPicks,
  draftFrom,
  flipStart,
  givesLine,
  invitationExpired,
  invitationLine,
  linkChanges,
  linkChoicesOf,
  linkLine,
  linkTitle,
  listedInvitations,
  maxWord,
  requestLine,
  startChanges,
  startOf,
  ttlWord,
} from "../../src/features/members/logic";
import { areaValues, SETTINGS_SECTIONS } from "../../src/features/settings/logic";
import { translator } from "./fixtures";

const NOW = new Date("2026-11-14T12:00:00Z");
const DAY = 86_400_000;
const later = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();
const src = (path: string) => readFileSync(join(import.meta.dir, "..", "..", "src", path), "utf8");
const route = (path: string) => readFileSync(join(import.meta.dir, "..", "..", "app", "(app)", path), "utf8");

const role = (over: Partial<OrgRole> & { id: string; name: string }) =>
  ({
    kind: "custom",
    position: 1,
    permissions: [],
    givable: true,
    color: "teal",
    icon: "shield",
    channelIds: [],
    agentIds: [],
    ...over,
  }) as OrgRole;
const EVERYONE = role({ id: "todos", name: "Todos", kind: "everyone", position: 9, permissions: ["talk_to_agents"] });
const SUPORTE = role({ id: "suporte", name: "Suporte", position: 2, channelIds: ["c-suporte"], agentIds: ["max"] });
const FIN = role({ id: "fin", name: "Financeiro", position: 3, channelIds: ["c-contas"], agentIds: ["fin"] });
const ADMIN = role({ id: "admin", name: "Admin", position: 1, permissions: ["administrator"] });
const ROLES = [ADMIN, SUPORTE, FIN, EVERYONE];

const agent = (over: Partial<Agent> & { id: string; name: string }) =>
  ({ role: "", ownerUserId: "u-bruno", audienceMode: "everyone", ...over }) as Agent;
const people = (roleIds: string[] = [], userIds: string[] = []) =>
  ({ audienceMode: "people", audience: { mode: "people", userIds, roleIds } }) as Partial<Agent>;
const AGENTS = [
  agent({ id: "lodi", name: "Lodi", builtin: "right_hand" }),
  agent({ id: "ada", name: "Ada", role: "Dev" }),
  agent({ id: "max", name: "Max", ...people(["suporte"]) }),
  agent({ id: "fin", name: "Fin", ownerUserId: "u-me", ...people() }),
  agent({ id: "rex", name: "Rex", ...people() }),
  agent({ id: "nora", name: "Nora", ownerUserId: "u-me", ...people() }),
];
const VIEWER = { userId: "u-me", managesAgents: false };

const draft = (over: Partial<InviteDraft> = {}): InviteDraft => ({ ...EMPTY_INVITE, ...over });

describe("a form's cargos bring their channels and agents (ADR 0184)", () => {
  test("a link's or an invitation's start reads back as the cargos' own, the added and the removed", () => {
    const given = { roleIds: ["suporte"], channelIds: ["c-vendas"], agentIds: ["max", "ada"] };
    const d = draftFrom(ROLES, given);
    // #suporte was taken out, #vendas added; Max is the cargo's, Ada added.
    expect(d).toEqual({
      roleIds: ["suporte"],
      added: { channelIds: ["c-vendas"], agentIds: ["ada"] },
      removed: { channelIds: ["c-suporte"], agentIds: [] },
    });
    expect(startOf(ROLES, d)).toEqual({ channelIds: ["c-vendas"], agentIds: ["max", "ada"] });
  });

  test("ticking and unticking: a cargo's own goes to removed and back; any other to added and back", () => {
    let d: Pick<InviteDraft, "roleIds" | "added" | "removed"> = draft({ roleIds: ["suporte"] });
    d = { ...d, ...flipStart(ROLES, d, "channelIds", "c-suporte") };
    expect(startOf(ROLES, d).channelIds).toEqual([]);
    d = { ...d, ...flipStart(ROLES, d, "channelIds", "c-suporte") };
    expect(startOf(ROLES, d).channelIds).toEqual(["c-suporte"]);
    d = { ...d, ...flipStart(ROLES, d, "agentIds", "ada") };
    expect(startOf(ROLES, d).agentIds).toEqual(["max", "ada"]);
    d = { ...d, ...flipStart(ROLES, d, "agentIds", "ada") };
    expect(startOf(ROLES, d).agentIds).toEqual(["max"]);
    // Another cargo brings its own in; the one taken out stays out.
    d = { ...d, ...flipStart(ROLES, d, "agentIds", "max"), roleIds: ["suporte", "fin"] };
    expect(startOf(ROLES, d)).toEqual({ channelIds: ["c-suporte", "c-contas"], agentIds: ["fin"] });
  });

  test("Link mode: the workspace's own link at the defaults, a link of its own past them", () => {
    expect(sameChoices(linkChoicesOf(ROLES, draft()), PLAIN_LINK)).toBe(true);
    expect(sameChoices(linkChoicesOf(ROLES, draft({ roleIds: ["suporte"] })), PLAIN_LINK)).toBe(false);
    expect(sameChoices(linkChoicesOf(ROLES, draft({ expiresIn: "1d" })), PLAIN_LINK)).toBe(false);
    expect(sameChoices(linkChoicesOf(ROLES, draft({ maxUses: 5 })), PLAIN_LINK)).toBe(false);
    // Editar link's "Até 13 de dez." reads as the 30 days a new link would have.
    expect(linkChoicesOf(ROLES, draft({ expiresIn: null })).expiresIn).toBe("30d");
  });

  test("Editar link and Editar convite save only what changed", () => {
    const link = { roleIds: ["suporte"], channelIds: ["c-suporte"], agentIds: ["max"], maxUses: 10 };
    const same = { roleIds: ["suporte"], channelIds: ["c-suporte"], agentIds: ["max"] };
    expect(startChanges(link, same)).toEqual({});
    expect(linkChanges(link, same, { expiresIn: null, maxUses: 10 })).toEqual({});
    expect(linkChanges(link, { ...same, channelIds: [] }, { expiresIn: "7d", maxUses: null })).toEqual({
      channelIds: [],
      maxUses: null,
      expiresIn: "7d",
    });
    // A link that never ends, left at "Não expira", keeps its date.
    expect(linkChanges({ ...link, neverExpires: true }, same, { expiresIn: "never", maxUses: 10 })).toEqual({});
    // The picks compare in any order.
    expect(startChanges({ roleIds: ["a", "b"] }, { roleIds: ["b", "a"], channelIds: [], agentIds: [] })).toEqual({});
  });
});

describe("Convites' rows (ADR 0184)", () => {
  const link = (over: Partial<InviteLink> = {}): InviteLink => ({
    id: "l1",
    url: "https://agentes.example.com/invite/abc",
    expiresAt: later(6),
    createdAt: later(-1),
    createdBy: "Ana Souza",
    createdByUserId: "u-ana",
    waiting: 0,
    roleIds: [],
    channelIds: [],
    agentIds: [],
    maxUses: null,
    uses: 0,
    ...over,
  });

  test("a link's name is its cargos, Membro with none; its line, how full it is, when it ends and whose", async () => {
    const pt = await translator("pt-BR");
    expect(linkTitle(pt, ROLES, link())).toBe("Membro");
    expect(linkTitle(pt, ROLES, link({ roleIds: ["fin", "suporte"] }))).toBe("Suporte e Financeiro");
    expect(linkLine(pt, "pt-BR", link({ maxUses: 1 }), "u-me", NOW)).toBe(
      "0 de 1 pessoa · expira em 6 dias · de Ana Souza",
    );
    expect(linkLine(pt, "pt-BR", link({ maxUses: 10, uses: 10 }), "u-ana", NOW)).toBe(
      "10 de 10 pessoas · expira em 6 dias",
    );
    expect(linkLine(pt, "pt-BR", link({ uses: 4, neverExpires: true }), "u-ana", NOW)).toBe("4 entraram · não expira");
    expect(linkLine(pt, "pt-BR", link({ expiresAt: later(20 / 24) }), "u-ana", NOW)).toBe("expira em 20 h");
    // Full, or less than a day left: the row says it in amber.
    expect(linkStanding(link({ maxUses: 10, uses: 10 }), NOW).full).toBe(true);
    expect(linkStanding(link({ expiresAt: later(20 / 24) }), NOW).soon).toBe(true);
    const en = await translator("en");
    expect(linkLine(en, "en", link({ maxUses: 5, uses: 1 }), "u-me", NOW)).toBe(
      "1 of 5 people · expires in 6 days · by Ana Souza",
    );
  });

  test("a request says how it came and what its link gives; a suggestion who made it", async () => {
    const pt = await translator("pt-BR");
    const known = {
      roles: ROLES,
      channels: [
        { id: "c-suporte", name: "suporte" },
        { id: "c-urgente", name: "chamados-urgentes" },
      ],
      agents: AGENTS,
    };
    const via = {
      createdAt: new Date(NOW.getTime() - 3 * 3_600_000).toISOString(),
      link: {
        id: "l1",
        createdBy: "Paula Reis",
        roleIds: ["suporte"],
        channelIds: ["c-suporte"],
        agentIds: ["max"],
        full: false,
      },
    } as Pick<JoinRequest, "createdAt" | "suggestedBy" | "link">;
    const gives = givesLine(pt, known, via.link ?? {});
    expect(gives).toEqual(["Suporte", "#suporte", "Max"]);
    expect(requestLine(pt, "pt-BR", via, gives, NOW)).toBe(
      "Pediu pelo link de Paula Reis há 3 h · Suporte · #suporte · Max",
    );
    const suggested = { createdAt: later(-1), suggestedBy: "Bruno" };
    expect(requestLine(pt, "pt-BR", suggested, [], NOW)).toBe("Bruno sugeriu ontem");
    // Many channels say two and how many more.
    expect(
      givesLine(
        pt,
        { ...known, channels: [...known.channels, { id: "c3", name: "vendas" }] },
        {
          channelIds: ["c-suporte", "c-urgente", "c3"],
        },
      ),
    ).toEqual(["#suporte, #chamados-urgentes e mais 1"]);
  });

  test("e-mail invitations: working and expired, the newest first", async () => {
    const pt = await translator("pt-BR");
    const open = {
      id: "i1",
      email: "marina@example.com",
      role: "member" as const,
      roleIds: ["suporte"],
      status: "pending" as const,
      expiresAt: later(5),
      createdAt: later(-2),
    };
    const gone = {
      ...open,
      id: "i2",
      email: "rafael@example.com",
      roleIds: [],
      status: "expired" as const,
      expiresAt: later(-6),
      createdAt: later(-13),
    };
    expect(invitationLine(pt, "pt-BR", open, ROLES, {}, NOW)).toBe("Suporte · expira em 5 dias");
    expect(invitationExpired(gone, NOW)).toBe(true);
    expect(invitationLine(pt, "pt-BR", gone, ROLES, {}, NOW)).toMatch(/^Membro · expirou em /);
    // Past its date, a list that still says pending is expired too.
    expect(invitationExpired({ ...open, expiresAt: later(-1) }, NOW)).toBe(true);
    expect(listedInvitations([gone, open]).map((i) => i.id)).toEqual(["i1", "i2"]);
  });

  test("Validade and Máximo de pessoas in words", async () => {
    const pt = await translator("pt-BR");
    expect(ttlWord(pt, "30m")).toBe("30 minutos");
    expect(ttlWord(pt, "never")).toBe("Não expira");
    expect(maxWord(pt, 1)).toBe("1 pessoa");
    expect(maxWord(pt, 25)).toBe("25 pessoas");
    expect(maxWord(pt, null)).toBe("Sem limite");
  });
});

describe("the choices pushed over a form", () => {
  test("Canais: the cargo's first, then the categories, #general ticked and fixed; a cargo's private one on offer", async () => {
    const pt = await translator("pt-BR");
    const channels = [
      {
        id: "c-general",
        name: "general",
        visibility: "public" as const,
        isMember: true,
        categoryId: null,
        position: 0,
      },
      {
        id: "c-suporte",
        name: "suporte",
        visibility: "private" as const,
        isMember: false,
        audienceRoleIds: ["suporte"],
        categoryId: "k-time",
        position: 0,
      },
      {
        id: "c-vendas",
        name: "vendas",
        visibility: "public" as const,
        isMember: false,
        categoryId: "k-time",
        position: 1,
      },
      { id: "c-dir", name: "diretoria", visibility: "private" as const, isMember: true, categoryId: null, position: 1 },
      { id: "c-folha", name: "folha", visibility: "private" as const, isMember: false, categoryId: null, position: 2 },
    ];
    const groups = channelPicks(pt, {
      channels,
      categories: [{ id: "k-time", name: "Time" }],
      roles: ROLES,
      draft: draft({ roleIds: ["suporte"] }),
    });
    expect(groups.map((g) => [g.title, g.picks.map((p) => [p.channel.name, p.on, p.fixed, p.sub ?? ""])])).toEqual([
      ["Do cargo Suporte", [["suporte", true, false, "Pelo cargo Suporte"]]],
      [
        null,
        [
          ["general", true, true, "Todo mundo entra"],
          ["diretoria", false, false, "Privado · você está nele"],
        ],
      ],
      ["Time", [["vendas", false, false, ""]]],
    ]);
    // Without the cargo, its private channel isn't on offer (the viewer isn't in it).
    const none = channelPicks(pt, { channels, categories: [], roles: ROLES, draft: draft() });
    expect(none.flatMap((g) => g.picks.map((p) => p.channel.name))).not.toContain("suporte");
  });

  test("Agentes: every case the server decides, with its reason, and only the pickable ones tickable", async () => {
    const pt = await translator("pt-BR");
    const picks = agentPicks(pt, {
      agents: AGENTS.filter((a) => a.builtin !== "right_hand"),
      viewer: VIEWER,
      roles: ROLES,
      draft: draft({ roleIds: ["suporte"] }),
      ownerName: (id) => (id === "u-bruno" ? "Bruno" : id === "u-me" ? "Você" : null),
      mailboxOwners: (id) => (id === "nora" ? ["Bruno"] : id === "fin" ? [] : []),
    });
    const said = (list: typeof picks.others) =>
      list.map((p) => [p.agent.name, p.case, p.sub, p.on, p.disabled, p.opens ?? ""]);
    expect(said(picks.fromCargo)).toEqual([["Max", "cargo", "Pelo cargo Suporte", true, false, ""]]);
    expect(said(picks.others)).toEqual([
      ["Ada", "everyone", "Dev", false, false, ""],
      ["Fin", "opens", "Restrito · você libera", false, false, ""],
      ["Nora", "mailbox", "Lê o e-mail de Bruno", false, false, "agent"],
      ["Rex", "locked", "Restrito · só Bruno libera", false, true, ""],
    ]);
    // While its mailboxes are being asked, one the viewer would open waits.
    const asking = agentPicks(pt, {
      agents: [AGENTS[3] as Agent],
      viewer: VIEWER,
      roles: ROLES,
      draft: draft(),
      ownerName: () => null,
      mailboxOwners: () => undefined,
    });
    expect(asking.others[0]?.disabled).toBe(true);
    // One already in the form can always come out, whatever its case now.
    const kept = agentPicks(pt, {
      agents: [AGENTS[4] as Agent],
      viewer: VIEWER,
      roles: ROLES,
      draft: draft({ added: { channelIds: [], agentIds: ["rex"] } }),
      ownerName: () => "Bruno",
      mailboxOwners: () => [],
    });
    expect([kept.others[0]?.on, kept.others[0]?.disabled]).toEqual([true, false]);
  });

  test("the lines under Agentes: no talking, an Administrador, restricted agents that start answering", async () => {
    const pt = await translator("pt-BR");
    const noTalk = [{ ...EVERYONE, permissions: [] }, SUPORTE];
    expect(
      agentLines(pt, { roles: noTalk, roleIds: ["suporte"], agents: AGENTS, agentIds: [], viewer: VIEWER }),
    ).toEqual({ off: true, lines: ["Com esse cargo, a pessoa não conversa com agentes."] });
    expect(
      agentLines(pt, { roles: ROLES, roleIds: ["admin"], agents: AGENTS, agentIds: ["fin"], viewer: VIEWER }).lines,
    ).toEqual(["Com Admin, a pessoa vê todos os agentes.", "Fin passa a responder a quem entrar por este convite."]);
    expect(agentLines(pt, { roles: ROLES, roleIds: [], agents: AGENTS, agentIds: ["ada"], viewer: VIEWER })).toEqual({
      off: false,
      lines: [],
    });
  });

  test("each choice is a pushed screen writing to the form its route names", () => {
    const fields = src("features/members/InviteFields.tsx");
    expect(fields).toContain('router.push({ pathname: "/invite-pick", params: { draft, what } })');
    const picks = src("features/members/InvitePickers.tsx");
    expect(picks).toContain("const draft = useInviteDraft(key);");
    // Validade and Máximo go back on their pick; Máximo never offers fewer than the link took.
    expect(picks).toContain("INVITE_LINK_MAX_USES.filter((max) => max === null || max >= uses)");
    expect(route("invite-pick.tsx")).toContain("<InvitePickScreen />");
    const layout = route("_layout.tsx");
    for (const name of ["invite-pick", "invite-link", "invite-edit", "settings/invites"])
      expect(layout).toContain(`name="${name}" options={{ ...pushed, ...scrollUnder }}`);
  });
});

describe("Convidar pessoas on the phone", () => {
  const invite = src("features/members/InvitePeople.tsx");

  test("E-mail or Link on top, full width; a server that sends no e-mail has links only", () => {
    expect(invite).toContain("{byLink ? null : (");
    expect(invite).toMatch(/<Segmented\s+wide\s+items=\{\[/);
    expect(invite).toContain('{ key: "email", label: t("invites.how.email"), icon: "mail" }');
  });

  test("each label over its field, the field at the row's whole width (the owner's note C)", () => {
    expect(invite).toMatch(/<GroupedField\s+key="to"\s+stacked/);
    const fields = src("features/members/InviteFields.tsx");
    expect(fields.match(/<GroupedField\s+key="\w+"\s+stacked/g)?.length).toBe(3);
    const kit = src("ui/Grouped.tsx");
    // The label's line, then the value under it at the row's width, 4 apart.
    expect(kit).toContain("<View style={styles.stackValue} pointerEvents={passive}>");
    expect(kit).toContain("stackValue: { marginTop: 4 },");
  });

  test("it sends every good address with the cargos, channels and agents; while it sends nothing goes back", () => {
    expect(invite).toContain("emails: ready.map((a) => a.email),");
    expect(invite).toContain("usePreventRemove(sending, () => undefined);");
    // A refused pick marks its token and says why, the form kept as it was.
    expect(invite).toContain('if (!refusedBy(e)) toast({ title: errorText(t, e, i18n.language), icon: "x" });');
    expect(invite).toContain('playSound("approved");');
  });

  test("Link mode: the workspace's link renewed as the mode opens, any other choice makes its own", () => {
    expect(invite).toMatch(/renew\s*\.mutateAsync\(\)\s*\.then\(setWorkspace,/);
    expect(invite).toContain("const link = await make.mutateAsync(choices);");
    expect(invite).toContain('label={t("members.link.make")}');
  });
});

describe("the kit's token (a 32 pt pill with a 44 pt ×)", () => {
  const token = src("ui/Token.tsx");

  test("its numbers", () => {
    expect(token).toContain("export const TOKEN_H = 32;");
    expect(token).toContain("const X_BOX = 24;");
    // The × grows to a finger's 44.
    expect(token).toContain("hitSlop={(TOUCH - X_BOX) / 2}");
  });

  test("a long address ends in … and keeps its note and its ×; lines past the limit leave and say how many", () => {
    expect(token).toMatch(/<RNText numberOfLines=\{1\}[^>]*style=\{\[TEXT, styles\.label/);
    expect(token).toContain(
      "const out = limit === null ? 0 : items.filter((it) => (tops[String(it.key)] ?? 0) >= limit).length;",
    );
    expect(src("features/members/InviteFields.tsx").match(/<TokenWrap lines=\{2\} more=\{more\}>/g)?.length).toBe(2);
  });
});

describe("Configurações › Pessoas: Membros · Convites · Cargos", () => {
  test("Convites sits between Membros and Cargos, for whoever invites, with the requests waiting as its value", async () => {
    const people = SETTINGS_SECTIONS.filter((s) => s.group === "people").map((s) => s.id);
    expect(people).toEqual(["members", "invites", "roles"]);
    const invites = SETTINGS_SECTIONS.find((s) => s.id === "invites");
    expect(invites?.allowed({ id: "o", name: "Acme", role: "member", permissions: ["read"] })).toBe(false);
    expect(invites?.allowed({ id: "o", name: "Acme", role: "member", permissions: ["invite_people"] })).toBe(true);
    const pt = await translator("pt-BR");
    expect(areaValues(pt, "pt-BR", { waiting: 2 }).invites).toBe("2");
    expect(areaValues(pt, "pt-BR", { waiting: 0 }).invites).toBeUndefined();
  });

  test("Membros keeps people; who waits and what was sent are Convites'", () => {
    const members = src("features/members/MembersPage.tsx");
    expect(members).not.toContain("WaitingYou");
    expect(members).not.toContain("SentInvitations");
    const convites = src("features/members/InvitesScreen.tsx");
    expect(convites).toContain('router.push({ pathname: "/join-requests", params: { request: r.id } })');
    expect(convites).toContain('right={<IconButton icon="plus" label={t("members.inviteTitle")} onPress={invite} />}');
    // An e-mail invitation's sheet: Editar in place of Mudar o papel; expired, Renovar and Tirar.
    const sheets = src("features/members/InviteSheets.tsx");
    expect(sheets).toContain('label: t("invites.edit"),');
    expect(sheets).not.toContain("changeRole");
    expect(sheets).toContain('label: t("members.invitations.drop"),');
  });

  test("a request's review starts on its link's choices, and a full link waits for a bigger maximum", () => {
    const sheet = src("features/members/JoinRequestsSheet.tsx");
    expect(sheet).toContain(
      "const given = (r.link?.roleIds ?? []).filter((id) => roles.some((x) => x.id === id && x.givable));",
    );
    expect(sheet).toContain("disabled={busy || full || linkFull || !draft}");
    expect(sheet).toContain('t("errors.join.linkFullApproval")');
  });
});

describe("the arrival card (#general for a newcomer's first day)", () => {
  test("the invitation's agents first, a few people, the first agent to talk to, the channels besides #general", () => {
    const arrival = arrivalOf({
      agents: [
        { id: "ada", canTalk: true },
        { id: "max", canTalk: true },
        { id: "rex", canTalk: false },
        { id: "theo", canTalk: true },
        { id: "lia", canTalk: true },
      ],
      pinned: ["max", "rex"],
      people: [{ userId: "u-me" }, { userId: "u-carla" }, { userId: "u-diego" }, { userId: "u-eva" }],
      meId: "u-me",
      channels: [
        { name: "general", isMember: true },
        { name: "suporte", isMember: true },
        { name: "vendas", isMember: false },
        { name: "chamados-urgentes", isMember: true },
      ],
    });
    expect(arrival).toEqual({
      agents: ["max", "ada", "theo"],
      people: ["u-carla", "u-diego"],
      host: "max",
      alsoIn: ["#suporte", "#chamados-urgentes"],
    });
    const card = src("features/chat/ChannelWelcome.tsx");
    expect(card).toContain('t("members.arrival.alsoIn", { channels: namesText(t, arrival.alsoIn, 3) })');
    // Three buttons as wide as the card: say hi here, talk to the first agent, meet the team.
    expect(card.match(/variant="(primary|ghost)"\s+wide/g)?.length).toBe(3);
    expect(card).toContain('requestComposerText(channelId, "");');
  });

  test("the Agentes tab shows the pinned agents first, the invitation's included", () => {
    expect(src("features/agents/AgentsScreen.tsx")).toContain("freeSections(free, groups, pins.pins.agents)");
  });
});

describe("the worst case (break-ui): long names, one of each, a thousand of them", () => {
  // The server's limits: a cargo's name 40 letters, a channel's 80, an agent's 32, an address 320 (64 is the classic).
  const LONG_CARGO = role({ id: "long", name: "Desenvolvimento de Produto e Engenharia!", position: 4 });
  const VIET = role({ id: "viet", name: "Đặng Thị Ngọc Hân", position: 5 });
  const LONG_EMAIL = "bartholomew.fitzgerald@northwind-industries-holdings.example.com";

  test("exactly one of everything is said in the singular, a thousand with its separator", async () => {
    const pt = await translator("pt-BR");
    const one = { uses: 1, maxUses: 1, expiresAt: later(1 / 48), createdBy: null, createdByUserId: null };
    expect(linkLine(pt, "pt-BR", one, "u-me", NOW)).toBe("1 de 1 pessoa · expira em 30 min");
    expect(linkLine(pt, "pt-BR", { ...one, maxUses: null }, "u-me", NOW)).toBe("1 entrou · expira em 30 min");
    expect(maxWord(pt, 1)).toBe("1 pessoa");
    expect(areaValues(pt, "pt-BR", { waiting: 1284 }).invites).toBe("1.284");
    const convites = src("features/members/InvitesScreen.tsx");
    expect(convites).toContain("formatInt(i18n.language, waiting.length)");
    expect(convites).toContain("formatInt(i18n.language, sent.length)");
  });

  test("long cargo, channel and agent names: a link's name and a request's line wrap whole, never cut", async () => {
    const pt = await translator("pt-BR");
    const roles = [...ROLES, LONG_CARGO, VIET];
    // Every cargo is named on the link's row; it wraps as far as it needs.
    expect(linkTitle(pt, roles, { roleIds: ["long", "viet", "fin"] })).toBe(
      "Financeiro, Desenvolvimento de Produto e Engenharia! e Đặng Thị Ngọc Hân",
    );
    // What a link gives names two of each and counts the rest, so its line stays short.
    const channels = Array.from({ length: 12 }, (_, i) => ({
      id: `c${i}`,
      name: `atendimento-ao-cliente-regiao-${i}`,
    }));
    const gives = givesLine(
      pt,
      { roles, channels, agents: AGENTS },
      {
        roleIds: ["long", "viet", "fin"],
        channelIds: channels.map((c) => c.id),
        agentIds: ["max", "ada", "fin", "rex"],
      },
    );
    expect(gives).toEqual([
      "Financeiro, Desenvolvimento de Produto e Engenharia! e mais 1",
      "#atendimento-ao-cliente-regiao-0, #atendimento-ao-cliente-regiao-1 e mais 10",
      "Max, Ada e mais 2",
    ]);
    const convites = src("features/members/InvitesScreen.tsx");
    expect(convites).toMatch(/label=\{linkTitle\(t, roles, link\)\}\s*labelLines=\{0\}/);
    // How it came, then what it gives on a line of its own, neither cut.
    expect(convites).toMatch(/sub=\{requestLine\(t, i18n\.language, r, \[\]\)\}\s*subLines=\{0\}/);
    expect(convites).toContain('belowText: gives.join(" · ")');
    // A channel's 80 letters wrap in Canais.
    expect(src("features/members/InvitePickers.tsx")).toMatch(/label=\{p\.channel\.name\}\s*labelLines=\{0\}/);
  });

  test("the classic long address: three lines on Convites, whole on Editar convite, cut only inside its token", async () => {
    const pt = await translator("pt-BR");
    expect(LONG_EMAIL.length).toBe(64);
    const convites = src("features/members/InvitesScreen.tsx");
    expect(convites).toMatch(/label=\{inv\.email\}\s*labelLines=\{3\}/);
    expect(src("features/members/InviteEdit.tsx")).toContain('t("members.invitations.label", { email: inv.email })');
    expect(pt("members.invitations.label", { email: LONG_EMAIL })).toBe(`Convite para ${LONG_EMAIL}`);
    // In its token the address ends in "…" while its note and its × stay whole (the plan's choice).
    const token = src("ui/Token.tsx");
    expect(token).toMatch(/\{note \? \(\s*<RNText numberOfLines=\{1\}/);
    expect(token).toContain("label: { flexShrink: 1, minWidth: 0 },");
  });

  test("empty and loading: Convites' rows of the final shape, then the empty line with its two ways in", () => {
    const convites = src("features/members/InvitesScreen.tsx");
    expect(convites).toContain("<RowBones />");
    expect(convites).toContain('<GroupedFooter>{t("members.invitations.empty")}</GroupedFooter>');
    expect(convites).toContain('label={t("members.copyInviteLink")}');
    // A request's card waits for the cargos, so it opens on its link's choices.
    expect(src("features/members/JoinRequestsSheet.tsx")).toContain("else if (!list.data || !roles.data)");
    // Convidar opens on its cargo in the first frame.
    expect(src("features/members/InvitePeople.tsx")).toContain("const draft = useInviteDraft(KEY) ?? opening;");
  });
});
