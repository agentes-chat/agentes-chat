# 0262. Proxies for agents: the workspace's, a computer's, or saved from the chat

- Status: Accepted
- Date: 2026-11-27
- Extends: ADR 0237 (agents use a person's internet), ADR 0007 (secrets sealed per org)
- Code: db `agent_proxies` (migration 0369); adapters `proxy-dial.ts` (`parseProxyUrl`, `dialViaProxy`,
  `proxyExit`), protocol `CUSTOM_PROXY_PROTOCOL` (`welcome.proxy`, `proxy.set`); engine `agent-proxies.ts`
  (`setAgentProxy`, `removeAgentProxy`, `listAgentProxies`, `proxyForMachine`, `testAgentProxy`), `proxy-card.ts`
  (`offer_proxy`, `saveProxyFromCard`), `machine-hub.ts` (the welcome); server `routes/app/agent-proxies.ts`; runner
  `egress-relay.ts` (`upstream` on the guard's socket and the loopback proxy), `daemon.ts` (`chooseProxy`); web
  `computer/AgentProxy.tsx` (Settings › Computers and each computer's page), `ActionCard.tsx` (`ProxyCardView`); phone
  `devices/ProxySection.tsx`, `ai/OfferCard.tsx`.

## Context

People asked to send their agents' web traffic through a proxy of their own (a country, a residential address, a
company's egress), as they can lend their own computer's internet (ADR 0237).

## Decision

1. **Where.** One proxy for the whole workspace (Settings › Computers, who configures it) and one per computer (its
   page: whoever connected it, or an admin). A computer's own wins there. HTTP, HTTPS (TLS to the proxy) or SOCKS5,
   with an optional user and password; the host must be public (the same check as an MCP server's address).
2. **Order, shown.** A computer's proxy, else the workspace's; then a person's lent internet; then the usual way. With
   a proxy set its agents' web connections go through it alone: a proxy that fails fails the connection, never another
   way out (one chosen for its address must not leak the computer's own).
3. **Secret.** The whole address is sealed like a connection's secret (envelope encryption, `agent-proxy|org|id`);
   only scheme, host, port and whether it has a sign-in come back to the apps. The runner gets the address in
   `welcome.proxy` and `proxy.set` and keeps it in memory; agents' processes are told only the loopback proxy's address.
4. **The wire.** On the workspace's managed computer, the guard's SOCKS socket (ADR 0237 §3) dials the proxy instead of
   asking for a lent connection, and answers SOCKS reply 5 when it fails (the Cloud's guard then closes the flow
   instead of going its usual way). Elsewhere the borrowing computer's loopback proxy (ADR 0237 amendment §4) runs on
   any computer with a proxy set, and dials it before anything else. What the loopback proxy keeps direct
   (`NO_PROXY`: the AI CLIs' model and sign-in services, this server) stays direct. Self-hosted servers need nothing
   more.
5. **Test.** "Test" asks this server to make one request through the proxy to Cloudflare's trace and shows the address
   and country agents come out at (30 tests an hour per person). The proxy is tested from the server, not from the
   computer.
6. **From the chat.** "Use the proxy socks5://user:pass@host:1080 for the browser" makes the agent call `offer_proxy`
   with the host only; the card carries the address without its password and points to the person's message. Saving
   reads it from that message again, then hides the password there (`user:•••@`) and in the transcripts of the
   conversation's runs since an hour before it, tests it, and tells the agent where agents come out.

## Consequences

- A proxy that is down stops its agents' websites until it is back or removed: the page says so.
- On the Cloud, the guard sends only ports 80 and 443 to the socket, so those go through the proxy; the rest keep
  their way. A proxy set while the guard is skipping the socket (a minute after "nothing lent") starts at its next ask.
- The model provider read the person's message before it was hidden; only stored copies are cleaned.
