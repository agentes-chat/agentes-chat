import { afterEach, beforeEach, expect, test } from "bun:test";
import { schema } from "@agenteschat/db";
import { browser, createTestServer, type TestServer } from "./harness";

/** The landing page's own site. */
const LANDING = "https://agentes.example";

let t: TestServer;
beforeEach(async () => {
  t = await createTestServer({ env: { LANDING_URL: LANDING } });
});
afterEach(() => t.close());

const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
const ana = { email: "  Ana@Agencia.com.br ", name: " Ana Souza ", whatsapp: "+55 11 91234-5678", locale: "pt-BR" };

test("without LANDING_URL there is no partner waiting list", async () => {
  await t.close();
  t = await createTestServer();
  expect((await browser(t)("/api/partners/waitlist", { json: ana })).status).toBe(404);
});

test("joining keeps the entry and its answers, and sends no email", async () => {
  const res = await browser(t)("/api/partners/waitlist", {
    json: { ...ana, answers: { clients: " 6-20 ", picks: ["recurring", "certification", "recurring"], empty: " " } },
  });
  expect(res.status).toBe(202);
  expect(await res.json()).toEqual({ ok: true });
  const rows = await t.db.select().from(schema.partnerWaitlistEntries);
  expect(rows.map((r) => [r.email, r.name, r.whatsapp, r.locale, r.source, r.answers])).toEqual([
    [
      "ana@agencia.com.br",
      "Ana Souza",
      "+55 11 91234-5678",
      "pt-BR",
      "partners",
      { clients: "6-20", picks: ["recurring", "certification"] },
    ],
  ]);
  // Not the product's waiting list.
  expect(await t.db.select().from(schema.waitlistEntries)).toEqual([]);
  await t.drain();
  expect(t.email.sent).toEqual([]);
});

test("the contact gets only partner_ keys, so the product's waiting list segments never pick it up", async () => {
  await browser(t)("/api/partners/waitlist", { json: { ...ana, answers: { clients: "6-20", picks: ["a", "b"] } } });
  expect(t.email.contacts).toEqual([]); // never inline in the request
  await t.drain();
  const [row] = await t.db.select().from(schema.partnerWaitlistEntries);
  expect(t.email.contacts).toEqual([
    {
      email: "ana@agencia.com.br",
      properties: {
        partner_clients: "6-20",
        partner_picks: "a, b",
        partner_waitlist: "joined",
        partner_name: "Ana Souza",
        partner_whatsapp: "+55 11 91234-5678",
        partner_locale: "pt-BR",
        partner_source: "partners",
        partner_joined_at: row?.createdAt.toISOString() ?? "",
        partner_updated_at: row?.updatedAt.toISOString() ?? "",
      },
    },
  ]);
  for (const key of Object.keys(t.email.contacts[0]?.properties ?? {})) expect(key).toStartWith("partner_");
});

test("the partner page's own body: its questions beside the contact become answers, consent as yes or no", async () => {
  const res = await browser(t)("/api/partners/waitlist", {
    json: {
      ...ana,
      company: "",
      site: "",
      city: " Recife ",
      kind: "agency",
      clients: "6-20",
      segments: ["health", "retail"],
      size: "",
      consent: true,
    },
  });
  expect(res.status).toBe(202);
  const [row] = await t.db.select().from(schema.partnerWaitlistEntries);
  expect(row?.answers).toEqual({
    city: "Recife",
    kind: "agency",
    clients: "6-20",
    segments: ["health", "retail"],
    consent: "yes",
  });
  await t.drain();
  expect(t.email.contacts[0]?.properties).toMatchObject({
    partner_waitlist: "joined",
    partner_kind: "agency",
    partner_segments: "health, retail",
    partner_consent: "yes",
  });
  await browser(t)("/api/partners/waitlist", { json: { ...ana, segments: [], consent: false } });
  const [again] = await t.db.select().from(schema.partnerWaitlistEntries);
  expect(again?.answers).toEqual({ consent: "no" });
});

test("sending the form again updates the entry and the contact; the first join date stays", async () => {
  const anon = browser(t);
  await anon("/api/partners/waitlist", { json: { ...ana, answers: { clients: "1-5" } } });
  await t.drain();
  const [first] = await t.db.select().from(schema.partnerWaitlistEntries);
  await anon("/api/partners/waitlist", {
    json: { ...ana, email: "ana@agencia.com.br", whatsapp: "11 98888-7777", answers: { clients: "6-20" } },
  });
  await t.drain();
  const rows = await t.db.select().from(schema.partnerWaitlistEntries);
  expect(rows.length).toBe(1);
  expect(rows[0]?.whatsapp).toBe("11 98888-7777");
  expect(rows[0]?.answers).toEqual({ clients: "6-20" });
  expect(rows[0]?.createdAt).toEqual(first?.createdAt as Date);
  expect(t.email.contacts.map((c) => [c.properties.partner_clients, c.properties.partner_joined_at])).toEqual([
    ["1-5", first?.createdAt.toISOString()],
    ["6-20", first?.createdAt.toISOString()],
  ]);
});

test("a bad email, name, WhatsApp or answer is refused with a stable code", async () => {
  const anon = browser(t);
  const cases: [Record<string, unknown>, string][] = [
    [{ ...ana, email: "not-an-email" }, "invalid_email"],
    [{ ...ana, name: "  " }, "invalid_name"],
    [{ ...ana, whatsapp: "1234" }, "invalid_whatsapp"],
    [{ ...ana, whatsapp: "call me maybe 11912345678" }, "invalid_whatsapp"],
    [{ ...ana, answers: { "Bad Key": "x" } }, "invalid_request"],
    [{ ...ana, answers: { waitlist: "confirmed" } }, "invalid_request"],
    [{ ...ana, answers: { clients: "x".repeat(501) } }, "invalid_request"],
    [{ ...ana, locale: "xx" }, "invalid_request"],
    [{ email: "a@acme.com" }, "invalid_request"],
  ];
  for (const [json, code] of cases) {
    const res = await anon("/api/partners/waitlist", { json });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe(code);
  }
  expect(await t.db.select().from(schema.partnerWaitlistEntries)).toEqual([]);
});

test("only the landing and our own origin can join, the landing through CORS", async () => {
  const anon = browser(t);
  expect((await anon("/api/partners/waitlist", { json: ana, origin: "https://evil.example" })).status).toBe(403);
  expect((await anon("/api/partners/waitlist", { json: ana, origin: null })).status).toBe(403);
  const preflight = await t.app.request("/api/partners/waitlist", {
    method: "OPTIONS",
    headers: {
      origin: LANDING,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type,x-captcha-response",
    },
  });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("access-control-allow-origin")).toBe(LANDING);
  expect(preflight.headers.get("access-control-allow-credentials")).toBeNull();
  const joined = await anon("/api/partners/waitlist", { json: ana, origin: LANDING });
  expect(joined.status).toBe(202);
  expect(joined.headers.get("access-control-allow-origin")).toBe(LANDING);
});

test("too many attempts from one address are throttled, apart from the product's list", async () => {
  const anon = browser(t);
  const headers = { "x-forwarded-for": "203.0.113.7" };
  for (let i = 0; i < 10; i++) {
    const res = await anon("/api/partners/waitlist", { json: { ...ana, email: `p${i}@acme.com` }, headers });
    expect(res.status).toBe(202);
  }
  const limited = await anon("/api/partners/waitlist", { json: { ...ana, email: "p10@acme.com" }, headers });
  expect(limited.status).toBe(429);
  expect(await errorCode(limited)).toBe("rate_limited");
  expect((await anon("/api/waitlist", { json: { email: "q@acme.com" }, headers })).status).toBe(202);
});
