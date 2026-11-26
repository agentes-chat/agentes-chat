# 0237. Agents use a person's internet: a computer lends its connection to the workspace's computer

- Status: Accepted (phase 1: the switch, the relay on both computers and the server; the workspace computer's
  routing is the Cloud's, later)
- Date: 2026-11-24
- Extends: ADR 0025 (connected computers), ADR 0058 §11 (data sockets), ADR 0101 (observed egress)
- Code: protocol `packages/adapters/src/machine-protocol.ts` (`EGRESS_SHARE_PROTOCOL`, `EGRESS_SHARE`,
  `egress.dial`, `StreamHello.egress`, `welcome.egressRelay`); db `machines.egress_share`, `egress_share_at`,
  `egress_via` (migration 0350), the notice to computers paired before (migration 0351); engine `packages/engine/src/egress-share.ts` (`lendingComputers`,
  `createEgressRelay`), `devices.ts` (`shareInternet`), `machines.ts` (`egressVia`, `egressViaNow`), `streams.ts`
  (`ClaimedStream.readyLater`), `notifications.ts` (`device.internet_shared`); runner
  `apps/server/runner/egress-share.ts` (the lending side),
  `egress-relay.ts` (the workspace computer's SOCKS5 socket); web `DevicePage.tsx`, `computer/Egress.tsx`,
  `devices/dialogs.tsx`, `pages/ConnectPage.tsx`; phone `ComputerSection.tsx`, `MachineScreen.tsx`; desktop
  `windows/InternetRow.tsx` (after pairing, and in Preferences › This Mac).

## Context

Some sites answer only visitors from their own country, or treat a datacenter address as a robot. An agent that works
for a person on the workspace's own computer then can't do what the person could do from home. The person's own
computers are already connected (ADR 0025) and hold a socket to the server.

## Decision

1. **The switch.** A person's own computer (`connected`) in a workspace that has its own computer shows "Agents use
   this computer's internet". It is on for every computer. Where a person pairs one (Let it join, the code page, the
   desktop app after pairing) they see that line with its switch, before or as it joins. Computers paired before this
   existed are on too, and their owners hear it once in the inbox (`device.internet_shared`, migration 0351, web and
   phone): "Agents now open websites through the internet of <computer>", what it keeps out (only this workspace's
   agents, only websites, 5 GB a day, never its own network; offline, the usual way), and one **Turn off** that sets
   the switch off; turning it off anywhere marks the notice done. A computer marked the workspace's, or whose owner
   left, tells who configures the workspace instead. Only the person who connected it turns it on
   (`device.share_owner_only`); an admin may turn it off. Turning it on again picks it first.
2. **Which computer.** The workspace's computer goes out through one computer at a time: among the lending computers
   online with an app that speaks `EGRESS_SHARE_PROTOCOL`, the newest pick (turned on last, else paired last). None
   online: its usual way out. A computer that says it carries enough now is passed over for a minute.
3. **The wire.** The workspace's computer offers its network guard a SOCKS5 socket (`<runner home>/egress-relay.sock`,
   mode 600, CONNECT only, no authentication: root alone reaches it), only when the server says so in `welcome`. Each
   connection there dials a data socket whose `stream.hello` names the destination (`egress`). The server checks it is
   the workspace's own computer, picks the lending computer, and asks it `egress.dial` with a fresh stream id; that
   computer reaches the site, dials its own data socket, and the server joins the two, bytes passed as they come
   (16 MiB queued toward a side at most), and only then answers `stream.ready` to the first. Every hop is a socket that
   already exists, so a computer behind any router lends without opening a port.
4. **What it carries.** Only TCP to ports 80 and 443 (`EGRESS_SHARE.ports`); SSH and the rest keep their usual way.
   The lending computer resolves a name itself (so the site's own location answers; a guard that passes the address its
   agent already resolved gets that address) and refuses a name or address that is not public, or that is on one of
   its own interfaces' subnets (a home's global IPv6 prefix, its router, this computer), wholly; at most 256 connections at once and
   5 GB a day both ways (UTC, kept in `<runner home>/egress-share.json` across restarts), past which an open one ends
   and new ones are refused until the next day. It is new work: a paused computer, or a workspace or agent on hold,
   lends nothing. Never another workspace's: the server pairs only a workspace's computer with that workspace's
   computers.
5. **Falling back.** Nothing lent now, a lending computer offline or asleep, or a refusal, closes the first data socket
   at once with a code the SOCKS socket turns into a reply: `unreachable` → "network unreachable" (go out your usual
   way), `refused` → "not allowed", `notFound` → "host unreachable". Connections already open end with their computer.
6. **Whose, shown.** The server writes, at most once a minute, which computer carried the workspace's computer's last
   connection (`machines.egress_via`). For five minutes after, the computer's page says "Agents use the internet of
   Ana's laptop (Ana)" on the web and the phone, and that computer's page says "In use now"; the observed exit address
   (ADR 0101) then measures through it too, since its probe goes the agents' way.
7. **Both sockets on one server process.** The two data sockets are joined in memory; a lending computer whose socket
   is on another replica isn't reached this way, and the first socket falls back.

## The Cloud's part (not in core)

The workspace computer's guard decides what goes to the socket: for agents' TCP to ports 80 and 443, the socket first;
on "network unreachable", its usual proxy, remembering that for a while so a workspace with no lending computer pays
nothing; UDP to port 443 dropped while a computer lends, so browsers fall back to TCP through it rather than QUIC
through the proxy. Its abuse rules stay in front of the socket, as they are in front of the proxy. That is the Cloud
repository's ADR and change.

## Consequences

- The server carries the bytes of lent connections. The daily cap bounds it per computer.
- A person sees which of their computers lends, and the workspace sees whose internet it uses; both turn it off in one
  switch.
- Nothing changes for a self-hosted server: it has no workspace computer, so nothing shows and nothing is asked.
