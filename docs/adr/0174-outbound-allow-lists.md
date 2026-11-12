# 0174. Private networks a self-hosted server may reach: the private switch everywhere, and allow-lists

- Status: Accepted
- Date: 2026-11-12
- Extends: ADR 0019 (`outboundFetch` and the private switch), ADR 0144 (`publicHttpsFetch`), ADR 0146
  (`MODEL_ENDPOINTS_PRIVATE`, `allowsPrivateEndpoints`)
- Code: `packages/engine/src/net-guard.ts` (`allowOutbound`, `refusedAddress`, `alwaysBlocked`,
  `internalNameRefused`; `assertPublicHttpsUrl`, `publicHostAddress`, `publicHttpsFetch`), `packages/engine/src/mail/
  accounts.ts` (custom mail hosts through `publicHostAddress`), `packages/config/src/schema.ts`
  (`OUTBOUND_ALLOW_HOSTS`, `OUTBOUND_ALLOW_CIDRS`), `apps/server/src/start.ts` (set at boot, cleared at shutdown),
  `apps/server/src/app.ts` (a refusal logged), `packages/client/src/lib/errors.ts` (`url.internal` →
  `errors.said.privateNetwork`)

## Context

Addresses a workspace types (a custom MCP server and its sign-in, its own bucket, a database, a mail server, a
password manager) are guarded against SSRF: private, loopback, link-local, metadata, CGNAT and reserved addresses
are refused. A self-hosted server lets workspaces reach its own network with the private switch
(`allowsPrivateEndpoints`: self-hosted and closed to sign-up, or `MODEL_ENDPOINTS_PRIVATE=true`). Its documentation
said it covered custom MCP servers, but only the fetch followed it (`outboundFetch` is the plain `fetch` then): the
check made when the address is typed (`assertPublicHttpsUrl`) still refused every private address, so a server on a
Tailscale tailnet (`100.64.0.0/10`, `fd7a:115c:a1e0::/48`) or a LAN couldn't be added, with no setting to allow
it. A server open to sign-up had no way to allow one network without opening all of them. The apps said only
"Check the address", and the server logged nothing.

## Decision

1. **The check follows the private switch.** With it on, `assertPublicHttpsUrl` lets private addresses and names
   under `.local` and `.internal` through. It is the check for every address the switch covers, so what the
   documentation promised now holds. `publicHttpsFetch` and `publicHostAddress` (a password manager, a database, a
   mail server) don't follow the switch: it never covered them.
2. **Allow-lists for what the switch doesn't cover.** `OUTBOUND_ALLOW_HOSTS` (names, or `*.` and a suffix of two
   labels or more) and `OUTBOUND_ALLOW_CIDRS` (ranges or addresses), set by the operator, let a private address
   through every typed-address guard: `assertPublicHttpsUrl`, `publicHttpsFetch` (checked and pinned at every
   connection as before) and `publicHostAddress` (also the mail server's check at every IMAP connection, in
   `start.ts`). A host on the list may resolve to any private address; a range lets
   its addresses through whatever the name. Unset, nothing changes.
3. **Some addresses never pass.** Loopback and unspecified addresses, link-local ones (the cloud metadata address
   `169.254.169.254` among them), AWS's `fd00:ec2::254` and Alibaba's `100.100.100.200` (inside Tailscale's
   range), multicast and reserved addresses, and the names `localhost`
   and `*.localhost` stay refused even inside an allowed range or behind an allowed name, also with the switch on.
   An IPv4 address carried in IPv6 is judged as the IPv4 address.
4. **Addresses named by someone outside stay public.** An OAuth client's metadata document (`fetchPublicDocument`),
   named by whoever registers a client, follows neither the switch nor the lists.
5. **The refusal says why.** `url.internal` carries the host. The server logs it as a warning with the route and the
   two settings, and the apps say the address is on a private network that the server's operator can allow.

## Consequences

- A self-hosted server closed to sign-up connects an MCP server on its tailnet with no setting. A server open to
  sign-up allows one tailnet with `OUTBOUND_ALLOW_HOSTS=*.<tailnet>.ts.net` or its ranges.
- A host suffix trusts DNS for every name under it: anyone who can make a name there can point it at the server's
  network. The setting's description says to name a narrow suffix. agentes.chat Cloud sets neither list.
- With the switch on, `assertPublicHttpsUrl` refuses loopback while the plain `fetch` after it would not: the typed
  address is what is checked, and a connector to the server's own loopback has no use.
- `assertPublicHttpsUrl` also guards the pages agents read and the skills they fetch, so what the switch or the
  lists allow, an agent may open too, on an address a model chose. That was already the switch's documented reach
  (its `fetch` was plain), and the lists are the operator's to keep narrow. A server closed to sign-up has the
  switch on unless `MODEL_ENDPOINTS_PRIVATE=false`.
- Nothing refuses the lists on agentes.chat Cloud: they are the operator's setting, like the switch.
