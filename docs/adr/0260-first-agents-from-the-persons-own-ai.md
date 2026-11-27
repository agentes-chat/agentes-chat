# 0260. First agents from the person's own AI: three options, one picked

- Status: Proposed
- Date: 2026-11-26
- Builds on: ADR 0119 (the MCP server; its addendum of 2026-11-26 adds the tool and the hold exemption), ADR 0081 and
  ADR 0137 §10 (proposals a person creates; the right hand's team card), ADR 0155 §6 and ADR 0162 (the onboarding and
  the team templates' one-click team), ADR 0079 (billing holds), ADR 0164 (the new agent's checklist asks for its apps)
- Code: `packages/db/src/schema/first-agents.ts` (`first_agent_proposals`, `first_deliveries`);
  `packages/engine/src/first-agents.ts` (`firstAgentsInput`, `saveFirstAgents`, `latestFirstAgents`, `pickFirstAgent`,
  `startFirstAgent`); `packages/engine/src/first-delivery.ts` (`keepFirstDelivery`, `armFirstDelivery`,
  `fireFirstDeliveries`, `enqueueFirstDeliveryChecks`, `deliverySummary`); `packages/engine/src/team-templates.ts`
  (`createTeamNow`); `packages/engine/src/team-proposals.ts` (`TeamAgent.later`); `packages/engine/src/apps/first-agents-tool.ts`
  (`propose_first_agents`); `packages/engine/src/standing.ts` (`workRefusalBeforePlan`); routes
  `apps/server/src/routes/app/first-agents.ts`; client `packages/client/src/api/*` (`api.firstAgents`,
  `useFirstAgents`, `usePasteFirstAgents`, `usePickFirstAgent`, the user event `first_agents.received`) and
  `packages/client/src/lib/apps.ts` (`aiAppAsk`); the plan-waiting emails `packages/engine/src/email.ts`
  (`sendPlanWaitingEmail`, `PlanWaitingPick`) and `email/words/*.ts` (`planWaiting.picked`)

## Context

The onboarding asked what the business does, who the person is, and then offered six ready-made teams by business type.
The answers were generic: the templates know nothing of this person's week, and a team of three made at once leaves
the person with three agents to understand before any of them did something useful.

The person already has an AI that knows their work: Claude, ChatGPT, Gemini, Cursor, with their past conversations,
their memory and the files and apps they connected. Since ADR 0119 that AI can connect to agentes.chat by MCP. Asked
the right question, it can find the repetitive tasks that take most of the person's time and describe an agent for
each, better than any form we could put in front of them.

Two things stood in the way. A new Cloud workspace is on the `payment` hold until Checkout (ADR 0079), and a hold
refused the app's sign-in, personal tokens and every MCP tool. And the existing ways to make agents either create at
once (`create_agent` under `manage`) or post a card in a conversation for an agent's run (ADR 0081), neither of which
fits "show me three, I pick one, on the onboarding's own page".

## Decision

1. **The person's AI proposes, the person picks.** The onboarding gives a prompt to paste into the person's AI (team
   owner, member and personal variants, and one that asks for JSON when the AI has no connector). It asks for the three
   repetitive tasks that take most of their time, each as an agent described like a job opening: a short name, a role,
   why (from what the AI saw), its responsibilities, the apps it needs, a routine with a day and a time, and what it
   delivers on its first day, ordered by the time each task takes. Nothing is created until the person picks one.

2. **One shape for both ways in.** `firstAgentsInput` (zod) is what the MCP tool and the paste route take: `about` (at
   most 600 characters) and 1 to 3 options, each `name` (1 to 30), optional `handle`, `role` (1 to 40), `why` (1 to 280),
   `tasks` (1 to 4, each up to 120), `apps` (names), an optional `routine` (`title`, `schedule` in words, `prompt`, and
   an optional `cron`), `today` (up to 3) and `instructions` (up to 4,000). The routine's `cron` is optional: words like
   "toda segunda às 8:00" need the workspace's own model to read, which a workspace waiting for its plan doesn't have,
   so the MCP tool asks for the cron of the same schedule too, and so does the request for a pasted answer (its third
   item, and `"cron":"0 8 * * 1"` in its JSON example), in the person's time zone.

3. **Kept per person, newest first.** `first_agent_proposals` (`org_id`, `user_id`, the connection that sent it or none,
   `source` `mcp` or `paste`, `about`, `options` jsonb, `picked`, `picked_at`, `agent_id`, `created_at`; erased by a
   workspace reset). `saveFirstAgents` normalizes each option: a handle free in the workspace and among the options
   (from the name when missing), each app named by the catalog (`key` is the mark the apps draw: a connector brand or a
   mailbox's provider, else null), the routine's schedule read with the routines' own reader in the person's time zone
   (`cron` and `timezone`, null when neither the cron nor the words read), and a look with a different color for each
   option, one no agent there wears when there is one. It is audited (`first_agents.proposed`, with the source and the
   app), limited to 10 an hour per person and workspace, and the person's apps hear `first_agents.received`: inside the
   workspace, its realtime provider reads the newest proposal again. The onboarding has no socket (it is outside that
   provider), so it also reads the newest proposal every few seconds while it waits. `GET …/first-agents` answers only
   the caller's own newest one.

4. **Picking makes one agent through the team card.** `pickFirstAgent` needs `create_agents` (members have it by
   default; without it, `create_agents_required`). It builds a one-agent team from the option and makes it through
   `createTeamNow`, the same path the templates take (split out of `useTeamTemplate`): the right hand's team card in the
   person's DM with it, created at once, with Undo for a day. So the agent gets what a template's agent gets: its
   channel in a team's workspace (named after its role, `#cobranca`, or its handle; a personal workspace's agent lives
   in its DM), its routine (read again, from the cron first), the AI suggested for the person (an account of theirs,
   else the workspace's model), the plan-waiting emails on a `payment` hold, the team's hello once it can work, and the
   right hand's weekly check when it is a team's first agent. Its instructions are the option's, else its
   responsibilities as a list. The apps the workspace has are given as for any admin's new agent; each catalog app it
   names that isn't connected becomes a row of its checklist (`TeamAgent.later` → `setup.apps`, ADR 0164). A handle
   taken since the proposal gets the next free one.

5. **Once.** The pick holds the row (`picked`, `picked_at`) while it runs, so two clicks make one agent; a failure lets
   it go, and a hold older than two minutes (a process that stopped) may be taken again. Picking again after it is
   made answers with the same agent. The answer is where the onboarding opens it: `{ agentId, handle, channelId }`.

6. **The workspace's context from the AI.** With no context yet, the workspace's becomes the proposal's `about` when the
   person who picks may configure it (in a personal workspace that context is what the person wants help with, ADR 0159).
   A member's proposal speaks of their own work and is never written there: they can't configure the workspace.

7. **Open while the workspace waits for its first plan.** The onboarding runs before Checkout, so the app's sign-in,
   personal tokens, the tool and these routes all work on the `payment` hold (`workRefusalBeforePlan`; ADR 0119
   addendum of 2026-11-26). Every other refusal stands.

8. **The plan-waiting emails speak of the picked agent.** When the workspace's first agent came from a pick, the two
   reminders of ADR 0079 §6 speak of it instead of the counts: its name, role and first day as the option has them,
   and the AI that proposed it when its app has a verified mark (Claude, ChatGPT). An hour after, that it is ready and
   only the hiring is missing; on the third day, its first day's deliveries as a list and that hired today, it starts
   today. Both lead to the billing page ("Hire the team"). The names stay in the body, made inert, and the subjects
   say "your first agent" and how many deliveries wait (ADR 0069 §5). A workspace whose first agent came another way
   keeps the counts.

## Consequences

- The onboarding's team templates and its business and "about you" steps go; the templates' code stays for the right
  hand's chat (ADR 0137 §10) until it is retired on its own.
- The hello in #general (ADR 0162) greets only the templates' agents by handle: a first agent made here says nothing
  there yet, and the right hand says hi alone. Giving it a line of its own is left for later.
- A proposal names apps by what the AI wrote. One the catalog doesn't know keeps its name and no mark, and asks for
  nothing on the checklist.
- Asking an admin when the person can't create agents is left for later; the apps say it needs an admin.
- A new table, generated as a migration with `bun run db:generate first_agent_proposals`.

## Addendum (2026-11-26): a member's own first agent

Someone who joins a workspace met its team in the chat and was asked, by the right hand's greeting, what they look
after. The onboarding now asks the owner's own AI for the first agent; the people who join next get the same, in their
own words, because their AI knows their part of the work and the owner's doesn't.

- **Where.** `/welcome/$orgId` (`MemberOnboardingPage`), a page of its own outside the workspace's shell, on the
  onboarding's frame (ADR 0162). Two steps. First the hello: "Welcome to <org>, <first name>", the team awake on its
  daylight sky (the right hand and the agents, the workspace's computer once it is ready), and a lead that says each
  person brings the agent that solves a problem of theirs, who brought one (the first agent someone else answers for,
  by that person's first name, with its role; left out when there is none) and asks which will be theirs. The two
  answers are the owner's: ask your AI, or start from scratch, which opens the right hand's DM, where its greeting asks
  what they look after and it builds the agent with them. Then asking their AI and picking (`AskYourAi` with the
  `member` request, `personal` in a personal workspace, never naming a workspace called "Personal"; `FirstAgentPick`
  with "Pick your agent", a lead that names the team the agent joins and "It's your first: create others whenever you
  like."). The pick creates the agent as the owner's does (§4 to §6), and the page opens it: its channel in a team's
  workspace, its DM in a personal one. "Not now" opens the workspace. Every way out carries the arrival with the
  welcome wizard alone (ADR 0160): the team's AI is the workspace's, already set up.
- **Who gets there.** Accepting an email invitation, a link request approved and a request approved for an account
  (ADR 0090) open it when the person may create agents there (`makesAgents`) and has no agent of their own yet, in a
  team's or a personal workspace (`joinedLanding`). Anyone else, a failed read, and someone who was already a member
  open the workspace as before. Someone who reaches it without the permission to create agents sees the hello alone,
  with one line saying to ask an admin for it and a button into the workspace.
- **The invitation says so.** A team's invitation email adds that, on arrival, the person creates their own agent with
  their AI. A personal workspace's says only whose space it is.
- **One welcome, not two.** The right hand's greeting of a newcomer (`postWelcome`) asks what they look after to build
  their first agent. Once they picked one on this page (a `first_agent_proposals` row with its agent), the greeting
  is `welcome_member_agent` (hello, the agent is on the team, call me when you need) with no answers to tap, and its
  newcomer block (`newcomerBlock`) is left out of the prompt, so it never proposes their first agent again. The
  greeting is queued when they join, so it usually comes before the pick and keeps its question; its block is gone
  either way once the agent exists.

## Addendum (2026-11-27): the first delivery

The onboarding now starts from an area of work ("Atendimento", "O meu dia", or "Outro", the person's own) and makes
that area's agent at once, so connecting an app on the next step has an agent to give its routine to (ADR 0242). What
the person waits for after Checkout is not the agent but the first thing it delivers: the inbox read, the payments that
failed, the day's plan. That delivery is kept from the moment the agent is made and fires on its own once the agent can
work.

- **The agent from an area.** `POST …/first-agents/start` (`startFirstAgent` in `first-agents.ts`) makes one agent the
  way a picked proposal does (`makeFirstAgent`, which both share: the right hand's team card through `checkTeam` and
  `createTeamNow`, its own channel in a team's workspace, the apps every agent has for an admin's, the AI suggested for
  the person, a checklist row for each catalog app its job needs), as the person (`create_agents`), with no routine:
  the app the person connects brings its routine (ADR 0242), which the onboarding makes without asking for a run. Going
  back and picking another area sends `replace` with the agent made a moment ago: it is archived when it is this
  person's own and its delivery hasn't fired, so two first agents never wait side by side. A pick from the person's own
  AI keeps one too (area `ask`, its first day's first item).
- **Armed when the person leaves the agent's step.** The apps are connected on that step, so the delivery waits for
  them: it is kept disarmed (`armed_at` null) and the step's Continue, the owner's and a member's alike, arms it with
  `PUT …/first-delivery` (`armFirstDelivery`). For the agent of the waiting delivery it keeps its area and task; any
  other agent of the workspace (one brought from another app) takes its place with no area and no task. The agent must
  be in the workspace, not archived, and answer the person. A new agent taking a delivery's place disarms it again.
- **One per person and workspace.** `first_deliveries` (`packages/db/src/schema/first-agents.ts`): the person, the
  agent, the area (null for an imported agent), the task, when it was armed, when it fired and the run it woke, unique
  on the workspace and the person. A new agent takes the place of a delivery that hasn't fired; one that fired stays as
  it is. `GET …/first-delivery` reads it (null once its agent is archived). One that never could fire goes after 30
  days.
- **When it fires.** Once, whichever comes last: the person leaving the agent's step, Checkout returning, the AI
  connecting, or the workspace's computer coming up for a plan's sign-in. `fireFirstDeliveries` (`first-delivery.ts`,
  the job `first_delivery.check`) fires an armed, waiting delivery while the workspace may work (active, no hold, read
  fresh rather than from the 5-second cache), the person is still a member who reaches the agent, the agent is neither
  archived nor held, and its AI reads ready (`agentAiState`, which reads a computer brain ready only once its computer
  is). It is claimed in the same transaction that delivers its notice, so it never fires twice. The check is queued when
  a delivery is armed and when a billing hold lifts (`setBillingHold`, beside the team's hello), and by a sweep in the
  process that sweeps (`enqueueFirstDeliveryChecks`, every 15 seconds): one job per workspace that may work and has one
  armed and waiting, keyed by a window that grows with the wait since it was armed (15 seconds in its first hour, a
  minute in its first day, 10 minutes after), so the AI connecting or the computer coming up needs no hook of its own
  and a workspace that never connects an AI costs a few jobs an hour. A workspace on a hold gets none: lifting it queues
  its own.
- **The notice.** A new kind, `first_delivery`, agent-only (people never see the brief), delivered with `deliverNotice`
  into the person's DM with the agent at hop 0 (`trigger: "dm"`), with `refs.personId` and the routine's id. Its run
  acts for that person: `authority.ts` roots it in `refs.personId`, as it does a `github_event` or a `work_follow_up`.
  Its words are the server's, in English: the person set the agent up a moment ago and waits in this conversation; do
  the work now with its tools: its oldest active routine this person made (its prompt, its name and schedule), else
  the task the onboarding kept, else its role's first piece of work; report it in one message (a short sentence of what
  it found, with numbers when there are any, then what is ready), anything to send or change waiting on the person as
  an approval, never sent by itself; end with when it does it again; never pass. A later turn reads only a line saying
  what that notice was.
- **The reply says so.** Every reply (never a note) of the run that notice woke carries `meta.firstDelivery` with
  `summary`, the one line the onboarding's last screens and the tour show (`deliverySummary`: plain text, the first
  paragraph past an opening greeting of at most four words, its first sentence, cut at a word under 140 characters).
  It is set where every reply of a run is posted (`post` in `executor.ts`), so a computer brain's reply carries it too.
- **Mailboxes on the way in.** Connecting Gmail or Outlook from the onboarding or a member's welcome page sends `back`
  (`onboarding` or `welcome`); the sign-in returns there (`/onboarding?mail=…&account=…`, `/welcome/<orgId>?…`)
  instead of Settings › Connectors. The desktop app's return stays the app's.
- **Already able to work.** Where the plan and an AI are already there (a member joining a paying workspace, a
  self-hosted server with a key), it fires as soon as the person leaves the agent's step, with the apps they connected
  there; an app they didn't connect is one the brief tells the agent to say it couldn't reach.
