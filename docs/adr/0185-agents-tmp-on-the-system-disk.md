# 0185. Each agent's /tmp on the system disk

- Status: Accepted (built: core's runner). The agentes.chat Cloud takes it with a new runner pin
- Date: 2026-11-14
- Amends: ADR 0096 §3 (each agent's /tmp was in its tmpfs, in memory)
- Code: runner `agent-users.ts` (`agentRam`, the `tmpInRam` of `systemLauncher` and `containersCommand`),
  `service.ts` (`AGENT_DISK_TMP_ROOT`, `AGENT_TMP_CLEANUP`), `config.ts` (`agentTmpInRam`), `daemon.ts`
  (`configFromGrant`); tests `agent-users.test.ts`, `system-mode.test.ts`, `isolation.root.test.ts`

## Context

ADR 0096 gave each agent one tmpfs of its own (`/run/agentes-runner-tmp/<uid>`, up to half the RAM) holding its /tmp,
its /dev/shm, its /run/lock and its runtime dir. The kernel can't drop a tmpfs's pages, only swap them out, so what
programs leave in /tmp holds that much RAM until they delete it or the computer restarts: a build tree or a few GiB of
downloads in one agent's /tmp are a few GiB of RAM no other agent or VM can use. /dev/shm is different: it is memory
that processes share (Chrome's renderers among them), which only RAM serves well.

## Decision

1. **/tmp on the system disk.** Each agent's /tmp is `/var/cache/agentes-runner-tmp/<uid>`, root's and 1777 as the
   tmpfs's folder was, under a folder only root can reach (0700), so no other agent gets in by its path. It is on the
   system disk, never under a workspace path (`/home`, `/srv/agentes`, `/var/lib/agentes-runner*`…), which a host may
   keep on a data disk that moves and backups copy. Its /dev/shm, /run/lock and runtime dir stay in its tmpfs.
2. **Chosen once a boot.** The launch's first step, as root on the computer, mounts the agent's tmpfs at its first
   launch after the computer starts, under a lock, and then binds its folder on disk at `<tmpfs>/tmp`, which each
   launch's own mount namespace binds over /tmp as before. A later launch finds the tmpfs and changes nothing, so all of
   an agent's processes see one /tmp until the next boot, whatever the switch says meanwhile. A runner upgraded while
   agents run leaves them in memory until the computer restarts.
3. **Emptied at every boot.** systemd-tmpfiles' boot run empties `/var/cache/agentes-runner-tmp` before any agent
   starts (`D!`: a later `--remove` leaves it), as a tmpfs is empty after a boot; what is 10 days old goes meanwhile, as
   in the agents' other folders. `service install --system` writes the line with the others
   (`/etc/tmpfiles.d/agentes-runner.conf`), and the installer runs that at every upgrade.
4. **A switch, per computer.** `"agentTmpInRam": true` in the runner's `config.json` keeps each agent's /tmp in its
   tmpfs, the launch exactly as before. An agent takes it at its first launch after the next boot. Pairing again keeps
   it, as it keeps the other settings only root writes there. Whatever provisions the computer sets it as root.
5. **The computer's own /tmp** (Debian 13 mounts a tmpfs there, `tmp.mount`) is left as it is: agents never see it,
   and it is the operator's to keep in memory or not (`systemctl mask tmp.mount`, from the next boot).

## Consequences

- An agent's /tmp grows on disk, and the part it uses is page cache, which the kernel takes back when memory is short.
  A program that writes a large file to /tmp writes it to the disk.
- Half the RAM no longer bounds an agent's /tmp: it can fill the system disk, as /var/tmp and the homes can fill
  theirs. ext4 keeps 5% for root by default, so the system's own services still write.
- A boot takes longer by the time it takes to delete what the agents left in /tmp.
- The launch's first step changes, so each agent's containers service starts again once, at the first
  `ensureContainers` after the upgrade (its command's hash changes), and so do its containers. A change of the switch
  does the same, though the agent's /tmp moves only at the next boot.
- No machine protocol change.
