import { describe, expect, test } from "bun:test";
import { resources } from "@agenteschat/i18n";
import i18next, { type TFunction } from "i18next";
import { ApiError } from "../src/api/http";
import type { Agent } from "../src/api/types";
import {
  INVITE_LINK_MAX_USES,
  INVITE_LINK_TTLS,
  type InviteRefusal,
  inviteAgentCase,
  invitePickable,
  inviteRefusal,
  inviteRefusalText,
  inviteStart,
  linkStanding,
  PLAIN_LINK,
  sameChoices,
} from "../src/lib/invite-start";

const none = { channelIds: [], agentIds: [] };
const roles = [
  { id: "suporte", channelIds: ["c-suporte", "c-chamados"], agentIds: ["a-max"] },
  { id: "financeiro", channelIds: ["c-contas"], agentIds: ["a-fin", "a-max"] },
  { id: "vazio" },
];

describe("what an invitation starts someone with (ADR 0184)", () => {
  test("the picked cargos bring their channels and agents, then the ones added, less the ones taken out", () => {
    expect(inviteStart(roles, [], none, none)).toEqual(none);
    expect(inviteStart(roles, ["suporte"], none, none)).toEqual({
      channelIds: ["c-suporte", "c-chamados"],
      agentIds: ["a-max"],
    });
    // Two cargos: each once, in the cargos' order; one with no reach read adds nothing.
    expect(inviteStart(roles, ["suporte", "financeiro", "vazio"], none, none)).toEqual({
      channelIds: ["c-suporte", "c-chamados", "c-contas"],
      agentIds: ["a-max", "a-fin"],
    });
    // Taken out stays out, even when another cargo brings it again; added by hand comes after.
    const removed = { channelIds: ["c-chamados"], agentIds: ["a-max"] };
    const added = { channelIds: ["c-geral-2"], agentIds: ["a-ada"] };
    expect(inviteStart(roles, ["suporte", "financeiro"], added, removed)).toEqual({
      channelIds: ["c-suporte", "c-contas", "c-geral-2"],
      agentIds: ["a-fin", "a-ada"],
    });
  });

  test("each agent's case, as the server decides it", () => {
    const agent = (extra: Partial<Agent>) => ({ id: "a-fin", ownerUserId: "u-bruno", ...extra }) as Agent;
    const people = (extra: Partial<Agent> = {}) =>
      agent({ audienceMode: "people", audience: { mode: "people", userIds: [], roleIds: [] }, ...extra });
    const lia = { userId: "u-lia", managesAgents: false };
    const admin = { userId: "u-ana", managesAgents: true };
    expect(inviteAgentCase(agent({ audienceMode: "everyone" }), lia, [])).toBe("everyone");
    expect(inviteAgentCase(people(), lia, ["a-fin"])).toBe("cargo");
    expect(inviteAgentCase(people(), lia, [])).toBe("locked");
    expect(inviteAgentCase(people({ ownerUserId: "u-lia" }), lia, [])).toBe("opens");
    expect(inviteAgentCase(people(), admin, [])).toBe("opens");
    expect(inviteAgentCase(people(), admin, [], ["Bruno"])).toBe("mailbox");
    // On its owner's plan, answering nobody else: only its owner's own switch lets anyone in.
    const plan = { kind: "claude_code", account: "Claude Max" } as Agent["brain"];
    const kept = agent({ audienceMode: "owner", audience: { mode: "owner", userIds: [], roleIds: [] }, brain: plan });
    expect(inviteAgentCase(kept, { userId: "u-bruno", managesAgents: false }, [])).toBe("plan");
    // On a plan that already answers some people, it opens like any other.
    expect(
      inviteAgentCase(
        people({ brain: plan, audience: { mode: "people", userIds: ["u-rui"], roleIds: [] } }),
        admin,
        [],
      ),
    ).toBe("opens");
    expect(
      ["everyone", "cargo", "opens", "locked", "plan", "mailbox"].filter((c) => invitePickable(c as never)),
    ).toEqual(["everyone", "cargo", "opens"]);
  });
});

describe("a link's choices, its standing and a refused pick (ADR 0184)", () => {
  test("the plain link is the defaults; picks compare in any order", () => {
    expect(sameChoices(PLAIN_LINK, { ...PLAIN_LINK })).toBe(true);
    const suporte = { ...PLAIN_LINK, roleIds: ["r1", "r2"], channelIds: ["c1"] };
    expect(sameChoices(suporte, { ...suporte, roleIds: ["r2", "r1"] })).toBe(true);
    expect(sameChoices(suporte, PLAIN_LINK)).toBe(false);
    // Any one choice past the defaults makes a link of its own.
    expect(sameChoices({ ...PLAIN_LINK, expiresIn: "7d" }, PLAIN_LINK)).toBe(false);
    expect(sameChoices({ ...PLAIN_LINK, maxUses: 10 }, PLAIN_LINK)).toBe(false);
    expect(sameChoices({ ...PLAIN_LINK, agentIds: ["a1"] }, PLAIN_LINK)).toBe(false);
    // The lists the server takes, in the order the choices show them.
    expect(INVITE_LINK_TTLS).toEqual(["30m", "1h", "1d", "7d", "30d", "never"]);
    expect(INVITE_LINK_MAX_USES).toEqual([1, 5, 10, 25, 50, 100, null]);
  });

  test("full when it took its people, soon with less than a day left; never-ending never soon", () => {
    const now = new Date("2026-11-14T12:00:00Z");
    const at = (h: number) => new Date(now.getTime() + h * 3_600_000).toISOString();
    expect(linkStanding({ uses: 10, maxUses: 10, expiresAt: at(480) }, now)).toEqual({ full: true, soon: false });
    expect(linkStanding({ uses: 3, maxUses: null, expiresAt: at(20) }, now)).toEqual({ full: false, soon: true });
    expect(linkStanding({ expiresAt: at(30) }, now)).toEqual({ full: false, soon: false });
    expect(
      linkStanding({ uses: 0, maxUses: 1, expiresAt: "9999-12-31T00:00:00.000Z", neverExpires: true }, now),
    ).toEqual({ full: false, soon: false });
  });

  test("a refused pick is read off the server's params and said with its way on", () => {
    const i18n = i18next.createInstance();
    void i18n.init({ lng: "pt-BR", resources, initAsync: false, interpolation: { escapeValue: false } });
    const t = { t: i18n.t.bind(i18n) as TFunction };
    const archived = inviteRefusal(
      new ApiError(400, "invitation.channel", "no", { channelId: "c1", name: "suporte", why: "archived" }),
    );
    expect(archived).toEqual({ kind: "channel", id: "c1", name: "suporte", why: "archived" });
    expect(inviteRefusalText(t.t, archived as InviteRefusal)).toBe(
      "O #suporte foi arquivado. Tire o canal para enviar.",
    );
    const left = { kind: "channel", id: "c2", name: "diretoria", why: "left" } as const;
    expect(inviteRefusalText(t.t, left)).toBe("Você não está mais no #diretoria. Tire o canal para enviar.");
    // A channel gone names none: the marked one is the one to take out.
    expect(inviteRefusalText(t.t, { kind: "channel", id: "c3", name: null, why: "gone" })).toBe(
      "Um dos canais não existe mais. Tire o marcado para enviar.",
    );
    const max = inviteRefusal(new ApiError(400, "invitation.agent", "no", { agentId: "a1", name: "Max", why: "gone" }));
    expect(inviteRefusalText(t.t, max as InviteRefusal)).toBe("O Max saiu do time. Tire do convite para enviar.");
    expect(inviteRefusalText(t.t, { kind: "agent", id: "a2", name: "Ada", why: "locked" })).toBe(
      "Você não pode mais liberar a Ada. Tire do convite para enviar.",
    );
    // Anything else is the caller's to say.
    expect(inviteRefusal(new ApiError(400, "invitation.channel", "no", { why: "archived" }))).toBeNull();
    expect(inviteRefusal(new ApiError(403, "role.above_you", "no"))).toBeNull();
    expect(inviteRefusal(new Error("offline"))).toBeNull();
  });
});
