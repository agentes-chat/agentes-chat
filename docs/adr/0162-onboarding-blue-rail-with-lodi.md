# 0162. Onboarding: the blue rail with Lodi

- Status: Accepted
- Date: 2026-11-08
- Amends: 0137 §6 (the onboarding asked only the workspace's name, then its right hand's DM), 0155 §6 (the right
  hand's card had five rows), 0079 §3 (the billing link's claims) and §7 (where a hold offers the plan), 0071 §3 (when
  our notifications ask opens)
- Code: client `lib/onboarding.ts` (`railSteps`, `railStepAt`, `railState` with its `funnel`, `landingOf`),
  `lib/no-ai.ts` (`teamThinks`), `lib/setup-checklist.ts` (three rows, invitations finish the people row, the plan
  row), `lib/push-offer.ts` (`pushAskAt`), `lib/billing.ts` (`planOfferOf`); engine `team-templates.ts`
  (`sayTeamHello`), `standing.ts` (`TEAM_HELLO_JOB` queued by `setBillingHold`), `billing-link.ts` (`plan`); web
  `pages/OnboardingPage.tsx`, `pages/onboarding/*` (`TeamSource.tsx`: `useTeamSource`, `TeamSource`; `TeamStart.tsx`; `AiStep.tsx`:
  `AiHost`, `AiStep`, `AiStage`; `PeopleStep.tsx`), `components/invite/EmailChips.tsx` (`chipsFrom`),
  `components/Sky.tsx` (`OnboardingProgress`, `TeamAsleepSky`), `lib/plan-offer.ts`,
  `lib/arrival.ts` (`ARRIVAL_BETA_ONLY`), `components/arrival/Arrival.tsx`, `components/FirstRun.tsx`,
  `components/Standing.tsx` (`HoldBanner`), `components/WebPush.tsx` (`PushAskInline`), `routes/onboarding.tsx`; phone
  `features/onboarding/OnboardingFlow.tsx`, `features/onboarding/steps.tsx`, `features/right-hand/FirstRun.tsx`

## Context

The onboarding asked one question, the workspace's name, and opened its right hand's DM, whose card held the rest:
what the workspace does, the team, an AI, apps, people, with the plan offered from three places at once. People met the
notifications dialog over that card on arrival, the plan's price was nowhere, and paying landed back at the bottom of a
DM with Lodi alone saying thanks.

## Decision

### 1. Four steps on the rail, before the workspace opens

The rail of the older onboarding comes back with Lodi on its horizon, one line per step, and the progress strip with its
walking pixel agent: the workspace's name (which creates it), what it does (the business types and one optional
sentence, saved together as its context, "Loja online · Vendemos cerâmica", so any later visit reads both back), its
team (a template made in one click, no model call), and, only on a workspace that waits for its first plan, the plan.
On wide screens the workspace's sidebar fills in beside the question. The step is read from the workspace's data (it
exists, has a context, has a team, waits for a plan), asked again whenever the tab or the app comes back, so a workspace
left at any step, or answered in another tab or on the phone, resumes there and is never finished behind the person's
back.

### 2. The plan step

The team asleep on the agents' sky, what each one does (its first routine), the plan the billing service recommends
with its price, "Ligar o time", "Ver todos os planos" and "Entrar no workspace sem ligar". The browser reads the plan
from the billing service's public list (`GET {billingUrl}/plans.json?locale=`): this server still names no plan or
price. A personal workspace is offered the list's plan for one person (`recommendedAlone`), the recommended one where
the list names none. Without that list the step names no plan and its button opens the billing page. The billing link may carry the
plan picked (`plan`, the billing service's own key), which this server passes on unread. Self-hosted servers have no
plan step. The phone app shows the team asleep and where to turn it on, with no price and no link.

### 3. Where it opens

Paid: #general (`?paid`), where the hold banner says the payment is being confirmed. Done with no plan to wait for:
#general. The plan left for later: the right hand's DM, where the hold's banner is the one way to the plan.

### 4. The team says hi

When the first plan starts (the `payment` hold lifts), or when a template team is made where no plan is waited for, the
team says hi in #general, one line each 1.1 s apart, the right hand first: no model call, no run, no notification,
`meta.greeting`. Template agents join #general answering only when called. The right hand's line names its computer
only while the workspace's computer is on its way.

### 5. The right hand's card keeps what the onboarding didn't do

An AI (for the whole team), apps, people. An invitation waiting for its answer finishes the people row, which invites one
address in place. On a hold every row waits for the plan with no button of its own. "Agora não" says nothing.

### 6. Our notifications ask waits

Never on arrival and never a dialog: a card under the first answer from an agent the person wrote to, and once more
under the first request waiting on them. Never on a billing hold.

### 7. The phone

The same steps from the same data (`railState`), on the screen the sign-in already uses: the right hand stands on the
sky and says its line for each step under the question, the template's team joins it there on step 3 and sleeps there
on step 4. Step 2 is the business list and the sentence, step 3 the template's team with its picker, step 4 what each
agent does first and, in words only, where the plan is chosen ("Entrar no workspace" opens the right hand's DM). The
way out of the account stays one quiet "Sair".

## Consequences

- The rail CSS stays shared with Criar agente (`layout.css`); its answers wrap instead of ending in an ellipsis.
- The held template example, the card's about and team rows and the notifications dialog are gone, with their words in
  every language.
- The billing service publishes `plans.json` and reads the link's `plan`: a change of its own, after this one.

## Amended 2026-11-09: what the first end-to-end take showed

- **The plan brings no AI, and the words say so.** Step 4 reads "Com o plano e uma IA, ele começa hoje", Lodi says
  that after the plan an AI is left, and while nothing in the workspace thinks his hello asks for one
  (`teamTemplates.hello.lodiNoAi`, `orgHasAi`) right above the bar that connects it, instead of starting the work.
- **One team order everywhere, the template's.** Agents made in one transaction keep the order they were made in
  (`createdAt` is the insert's `clock_timestamp()`), the agents' list follows it (by name only where older teams share a
  time), and the onboarding, the rail, the preview, step 4 and the sidebar's day-one pins (`dayOnePins`) list it as
  given. The members column keeps its own alphabetical order, as for people.
- **The preview** names the workspace "Seu workspace" until one is typed, and counts every agent it lists, the right
  hand included, as the workspace's sidebar now does (`orgOverview`).
- **The right hand's card:** an invitation only sent says "Convite enviado." with no burst (`firstRunBeats`); someone
  joining gets the welcome. The first task is offered once, on the team card ("Primeira tarefa"), never again among the
  card's asks. "Como prefere que eu fale com você?" waits until a team agent worked once (`teamAnswered`), so it never
  stands beside the first task.
- **A new agent's greeting** asks for help only when something is left as its checklist first loads.
- **The floating date** never floats over the conversation's start (the greeting and its cards): above the first day it
  shows nothing (`dayAtTop`, the phone's `dayInView`).
- **The computer notice** says no line under its title before the provisioner names a step (`setupNoticeStatusKey`).

## Amended 2026-11-10: the whole path before the workspace opens

The rail now ends where the team can think, instead of leaving an AI and, for a team from another app, the import to
the workspace. Amends §1 (the steps), §2 (the plan step's words), §3 (where it opens) and §5 (the card on a hold).

- **The steps.** A team's: its name, what it does, its team, the plan, connect an AI. A personal workspace's (ADR
  0159): what it is for, its agents, the plan, connect an AI; it has no business step, and its name ("Pessoal") is never
  asked. The plan is listed while the workspace waits for its first plan, and stays listed once paid (it reads
  "Ligado"): showing a held plan step saves the onboarding's step as `computer`, so the rail lists the plan when the
  workspace waits for one or that step was passed. A server that never held the workspace has no plan step. `railState`
  takes a `funnel` (`thinks`, `passed`); the phone passes `null` and keeps the steps of §1 and §7.
- **The team step asks first** whether the person already has agents in another app: the import page's cards, then
  "Ainda não uso nenhum". An app that answers a request is asked from the step (copy the request, paste its answer,
  "Ler a resposta"); a file or a folder goes through the import's picker. What was found shows before anything is made,
  and "Trazer o time" applies it (ADR 0055). Imported agents arrive with no model of their own, so they take the new
  agent's default and think with the AI connected next. A step with something skipped or failed, or with the agents'
  files still copying, stays on its report until Continue; an import that brought no agent goes on as "none" would.
  The import's views load only once the step is reached, so the first screen after sign-up stays light.
- **"Ainda não uso nenhum"** opens a team's templates as before, and a personal workspace's next step ("Seguir sem
  agentes"). Both save the onboarding's step as `agents` (no new column), so a resume opens on the templates. In a
  team's workspace the marker only picks that view: the step is answered by its agents. In a personal workspace,
  which may have none, it answers the step.
- **The plan step** says what comes after it beside its button ("Em seguida: conectar a sua IA.") and its way out reads
  "Ligar depois e só conhecer o workspace". Paying no longer finishes the onboarding: back from the billing page
  (`?paid`) the step says the payment was received and asks again every 5 s until the hold lifts, then the AI step
  follows.
- **The AI step** is Connect an AI (ADR 0160 §3) on the onboarding page: the same choices as cards, with the team asleep
  on the stage beside them. Every card, the API key's included, opens Connect for the whole team (ADR 0160, "For
  the whole team") directly on that choice's steps (`start`); with the right hand alone, its own Connect. The step
  is answered from data: every agent of the team has an AI, ready or waiting for its computer (`teamThinks`). A status
  that doesn't list every agent answers nothing until it is read again, which happens whenever the team changes. While
  the step is up it reads the status every 10 s and the plans' state every 5 s, since the onboarding has no socket, so
  an AI connected in another tab, on the phone, or right after paying moves it on. Once it thinks, the step says so
  with the team awake and "Entrar no workspace". "Conectar depois" finishes the onboarding the same way, and a failure
  says so. A skipped plan never reaches this step.
- **Nothing opens under the person.** While they are on a step they chose (one picked on the rail, an import's report,
  the AI's done screen), the page doesn't open the workspace by itself.
- **Where it opens.** As in §3, with the arrival's notice alone (`?arrival=beta`, ADR 0160) after the AI step or a
  skipped plan; a team that already thinks when its team is made still opens with `?arrival=1`.
- **The card on a hold** (amends §5): a first row, "Ligue o time." ("Ligue os seus agentes." in a personal workspace),
  whose "Ver planos" opens the billing page, for an owner who may pay while the workspace waits for its first plan. The
  AI row says "É o passo seguinte ao plano."; the others still open with the plan. In the right hand's DM the hold's
  banner steps aside while the card shows that row (after its "payment received" line, which still shows); everywhere
  else, and for anyone the card doesn't show the row to, it stays (amends §3, where the banner was the one way to the
  plan).
- **The phone** (§7) keeps its steps (`funnel: null`): no AI step, and a workspace left at the web's AI step opens
  there. Its card on a hold shows the plan row in words only, saying the plan is chosen on the web.

## Amended 2026-11-11: a team may leave its team step with no agents, and invites its people last

People who would rather build their agents by hand were made to go through an import or a template: the owner, trying
the rail live, wants them to go on without one. A team's workspace is also for the people who work there, and nothing
on the rail brought them in. Amends the 2026-11-10 bullets on the steps, on "Ainda não uso nenhum", on the AI step and
on where it opens.

- **Two ways out.** A team's question has "Pular esta etapa" under its button, with "Você cria os agentes depois, um
  por um." beside it, as the AI step's "Conectar depois"; after its "Ainda não uso nenhum", how the team starts offers
  "Começar do zero" (below). Both leave the step with the right hand alone and go on to the plan where the workspace
  waits for one, else to Connect an AI. A personal workspace's question gets no link: its "Ainda não uso nenhum"
  already is that.
- **How a team starts** (the owner's pick among three drafts, the same day). A team's "Ainda não uso nenhum" no longer
  drops the person on a template with a small link out: it asks first, "Como você quer começar o time?", with two of
  the question's own radio cards, one under the other, each with who comes in it (faces, then names): "Começar com um
  time pronto" (the template for the workspace's business, named, "3 agentes do modelo Loja online, cada um no seu
  canal, com as rotinas prontas.") and "Começar do zero" ("Só o Lodi, o seu braço direito. Você cria cada agente
  depois, do seu jeito.", with an empty place beside Lodi's face), picked when the view opens. The button says where
  the answer leads: "Ver o time pronto" opens the templates, whose "Criar os agentes depois, por conta própria" is gone
  (their Back returns here, the answer kept; Back here returns to the question); "Seguir só com o Lodi" is the way out
  above. The picked card's agents are awake and hop one after another as it is picked, the other's doze; the preview
  beside the step shows the template's agents and channels while the ready-made team is picked, Lodi alone otherwise.
  Arrows move between the cards and Enter on one presses the button. Lodi says "Tenho um time pronto para o que vocês
  fazem. Ou a gente começa só nós dois." A personal workspace and the phone have no such view.
- **What is stored.** Leaving the step saves the onboarding's step as `agents`, which now answers the team step in a
  team's workspace too (`railState`), so a reload resumes after it. A team's "Ainda não uso nenhum" (and "Prefiro
  montar um time novo", or an import whose agents all stayed behind) saves `import` instead: past the question, how
  the team starts next, the step still waiting for a team. Looking at the templates stores nothing, so a reload there
  or on how to start opens on how to start again, "Começar do zero" picked. No new column or step. A team workspace left on its templates before this change resumes after the team step,
  its question there to go back to.
- **Afterwards.** The rail's team row reads "Depois" (a personal workspace's too). Back on the step, the question shows
  again, never an empty team, so a team can still be brought or built; a template made there keeps the step on screen
  until Continuar. The plan step lists the right hand alone and says "Com o plano e uma IA, o seu braço direito começa
  hoje. Os outros agentes você cria depois."; on the AI step, Lodi's line, the stage beside it and the done heading
  speak of the right hand by name, as for a personal workspace with no agents. The workspace opens as any team's:
  #general, or the right hand's DM when the plan was left for later. The phone (`funnel: null`) is unchanged.
- **Inviting people, a team's last step.** A team's rail on the web ends on "Convidar pessoas", after the AI step, so
  reaching a connected AI takes no more steps than before: "Quem trabalha com você?", the addresses as chips with each
  one's role, and the workspace's link a click away, with the invite dialog's own pieces (ADR 0090: `EmailChips`,
  `ChipRole`, `InviteLinkPanel`, the batch invite) on the step rather than a form of its own. Its button sends the
  invitations and finishes the onboarding; "Convidar depois" under it finishes it with none. A server that sends no
  email shows the link alone, with "Entrar no workspace". A personal workspace and the phone (`funnel: null`) have no
  such step.
- **What answers it.** The AI step is answered by every agent thinking, or, on a team's rail, by "Conectar depois",
  which now goes on to the people step and saves the onboarding's step as `ai`. The invitations sent save `team` before
  the onboarding finishes, so a finish that fails resumes past the step. Both are the server's steps already (no new
  step or column). A stored step past the plan's (`ai`, `team`) lists the plan step only on a server with billing,
  where the workspace waited for it: a self-hosted rail never gets one.
- **The AI step on a team's rail.** Its words no longer say it is the last step, and an AI connected on it keeps the
  connected screen (and the Connect dialog over it) until "Continuar", which goes on to the people; going back from the
  people shows it again. The workspace opens in #general, on the arrival's beta notice alone whenever the AI step was
  shown, in this visit or left for later in an earlier one.
- **Later the same day, after the owner's review of the polish round.** The first question's two cards stack, each
  wide: the drawing on its horizon on the left, the words on the right from the top, both as tall as each other, the
  screen within a 720px window. The preview beside the steps loses its caption ("O seu workspace, enquanto você
  responde" stays its accessible name). And the person's own area is asked once per account, about them and never
  the workspace, on a screen of its own right before the team step (a team's after "O que vocês fazem", still that
  step on the rail; a personal workspace's after "Para mim"): "E você, cuida de quê?", the business step's chips one at
  a time, Continuar once one is picked, "Pular esta etapa" under it. It is stored per account in `users.work_area`
  (an id of `WORK_AREAS`, `@agenteschat/client/lib/work-area`, or `skipped`; migration 0250) through
  `PUT /me/work-area`, never waited for, and the operator API's account reads it (which kinds of people stay).

## Amended 2026-11-12: the person's own step, "Sobre você"

The rail asked about the workspace and its team, never about the person setting it up: their name stayed as typed at
sign-up (often in lower case), with no photo, and their own area was a loose screen with no step on the rail. Amends
the 2026-11-11 bullet on the person's own area.

- **A step of its own.** On the web, "Sobre você" sits between "O que vocês fazem" and "Seu time" (a personal
  workspace's right after "Para que vai usar"): "Agora, sobre você", their face large with "Criar um avatar" (the app's
  avatar builder, ADR 0166) and "Enviar uma foto" (the profile photo's crop) beside it, "Seu nome" filled with the
  account's, and "Você cuida de quê?", the area's chips, optional, one at a time, pressed again for none. The photo is
  saved by its own dialog, as in Settings; Continuar saves the name (`updateName`, the account's in every workspace)
  when it changed, a name refused staying on the step under its field, and the area, an area left unpicked as
  `skipped`. The loose area screen and its "Pular esta etapa" are gone.
- **What answers it.** The step is answered once per account by `users.work_area` (an area, or `skipped`), as the
  question was: `railState`'s funnel reads it as `about`, and `railStepAt` asks it right after what the workspace does,
  before its team, so a workspace left at any later step asks it first once. A person who answered it before finds it
  answered on a new workspace's rail, with their name under it, and may go back to it. An area whose save fails never
  holds the onboarding: it is asked again on another visit. No new column, route or stored step.
- **Where it shows.** The rail and its preview read the person from `/me`: a photo or avatar saved on the step shows in
  the rail's corner and the preview's account row at once, and the name once saved. The step needs the workspace's
  context for its dialogs (`StepHost`).
- **The phone** (`funnel: null`) has no such step and keeps its rail.

## Amended 2026-11-21: the first question as two rows, a note that it can change, and a way out at every step

People found the first question busy, missed that the choice can change, and those who already had a workspace and
started another found no way back after its first step. Amends the 2026-11-11 cards with their cluster of pills
and the wide window's stage.

- **No sky at the window's foot.** On a wide window the stage has no horizon of its own behind the rail and the
  question; Lodi's horizon on the rail and the progress strip stay.
- **Two rows, no cards.** "What will you use agentes.chat for?" lists its two answers as rows with no card around them,
  a hairline between them and the kit's radio drawn at each row's end (the row itself is the radio). The drawing stays
  on the left, without its horizon. The cluster of pills is gone: the agents say what they do in a small bubble over
  their face (under it on the drawing's bottom row), the one at work every 2.5 seconds once the answer is chosen, or the
  one pointed at. Each answer's line says what the view is: "A simpler view, with every feature." and "The full view,
  with channels and people."
- **It can change.** The lead is "Choose how you want to see agentes.chat."; a note under the answers, before
  Continue, says "Switch anytime." and that the workspace mode changes in Settings with nothing lost. The phone, which
  has no such note, keeps the longer lead that says the same.
- **A way out at every step.** Someone who has another workspace set up has a back arrow left of the rail's logo on
  every step ("Back to {name}, finish later"), not only on the first: it goes back to the page they were on in that
  workspace (`returnPlace`), and the workspace being made stays as it is, resumed on the next visit. On a phone the logo
  shows its mark alone then, so every step fits the bar.
- **The phone's step bar keeps its height.** Its row is `max-content`: an `auto` row let a tall step squeeze the bar,
  whose overflow is hidden, under its own items.


## Amended 2026-11-26: one box on the sky, and the first agent asked of the person's own AI

People reached a workspace with a team they had not chosen (a template) or with none, and the rail asked about the
business and the person before anything useful happened. The web onboarding now asks the person's own AI for a first
agent (ADR 0253), shows that agent's first week, and hires it with the plan. Amends §1 to §3 and the amendments of
2026-11-10 to 2026-11-21 on the rail, the team step, the person's own step, the plan step and the AI step.

- **The frame.** The blue rail, its progress strip and the preview are gone from the web onboarding. One box stands in
  the middle of the page's own sky (`World`, `Box`): the logo and the way back to another workspace at the top left,
  the account's menu at the top right, the step's agents standing on the box's top edge with the right hand's line in a
  bubble, or a header of the box's own (the apps' wall, the team's sky at night or in daylight, its photo). "Step N of
  M" sits over the title up to the plan, never after it. On a phone the same box fills the width, 16px from the edges.
  `StepRail`, `OnboardingProgress` and `OnboardingHorizon` stay for New agent.
- **The steps.** A team's: what it is for, its name (1), how to start (2), the first agent's week (3), the plan (4),
  then connecting the AI and inviting people, past the count. Started from scratch there is no week: name, start, plan
  (3). "What you do" and "About you" are gone; the workspace's context comes from what the AI said when an agent is
  picked (ADR 0253). `RailStep` is `name | start | week | plan | ai | people`. No new stored step: `agents` answers both
  the start left with no agent and the week seen, so the week is on the rail unless the start was left with none.
- **How to start.** The box's header is a wall of the catalog's own app marks with a few agents among them, its lead the
  catalog's count in tens ("more than 70"). Two rows: ask your AI (Claude, ChatGPT, Gemini or another finds the tasks
  that take most of the person's time and proposes an agent for each) or start from scratch (the right hand, the agents'
  HR, builds each agent with the person later). The ready-made team templates are gone from the onboarding.
- **Asking the AI and picking** (ADR 0253). The assistants in a row, most used first, then "Another agent app", which
  opens the import (ADR 0055). Connecting agentes.chat by MCP and the request to paste, numbered; the proposal is read
  every 4 s while the step is open; with no connector, the same request asking for a JSON answer and a field to paste
  it. The options stand as stacked job descriptions (rank, name and role, responsibilities, the apps they need) with the
  AI's reason under them; "Create <name>" makes that one agent with its routine and its place, nothing before.
- **The week.** A planner page for the picked agent: the next seven days from today in a plain strip, in the routine's
  zone (today in a dark circle, the agent's days in its color), today with what it delivers at "Now", and the routine's
  next day at its time with how it repeats (from the cron the server read in the person's zone, else the AI's own
  words), then what the AI said about the workspace. An agent brought from another app shows its own first scheduled
  routine. Its Continue saves `agents`.
- **The plan, "Hire the team".** The team asleep at night beside its computer on the box's header; who is hired (the
  first agent with its role and first task, the right hand as the agents' HR; the right hand alone from scratch); the
  recommended plan in two lines, its name and price with "See all plans", then what it includes. The people a plan
  includes are said only when the billing service's `plans.json` gives them (an optional `people` per plan, read by
  `planOfferOf`); this server still names no plan or price. A personal workspace is offered the list's plan for one
  person (`recommendedAlone`, see above). "Not now" leaves the plan for
  later as before (the workspace opens in the right hand's DM); the button opens the plan's Checkout. The hint on why
  the Cloud is paid stays beside the plan's name.
- **Back from Checkout, the team's photo.** In the plan step's place, once per payment (ADR 0079's moment): the team
  in daylight with the person among them and a few pixels of confetti, the right hand saying hello, "<org>'s team ·
  since <date>", who is in it, and what is left (the plan checked, the AI, the people, then the first agent's
  deliveries). Its one button connects the AI, or goes on when the team already thinks. It replaces the paid scene in
  the onboarding; the arrival's paid dialog elsewhere in the app is unchanged.
- **The AI step.** "Now, the AI you already pay for": the team awake on a daylight header (no computer drawn there: its
  state is not this step's to say), the plan bought in this tab over the title, Connect an AI's choices as before, and
  the ways out in the footer: "Without an AI, agents don't answer." with "Connect later", then Continue (a team's) or
  "Go to the workspace" once connected.
- **The people step.** After a plan, "Meanwhile, invite the people you work with": it takes a few minutes, and each
  person invited creates, on joining, the agent for their own work. With no plan, the same lead under the old title.
- **Where it opens.** As before: #general, or the right hand's DM for a personal workspace or a plan left for later, on
  the arrival, which is now the welcome wizard (ADR 0160): `?arrival=beta` once the AI was offered, else `?arrival=1`.
- **A personal workspace** (ADR 0159): what it is for, then how to start (1), asking its AI and the pick (2), the week
  (3) and the plan (4); from scratch, how to start and the plan. No name and no people step, and its own words: the
  tasks "at work or outside it", "Hire <name>", "Welcome to your team".
- **The phone** keeps its own steps (`phoneRail`: the name, what the workspace does, a template team and the plan in
  words) until it takes the web's.
- **Code.** Client `lib/onboarding.ts` (`railSteps`, `railStepAt`, `railState`, `stepCount`, `phoneRail`),
  `lib/billing.ts` (`planOfferOf`'s `people`); web `pages/OnboardingPage.tsx`, `pages/onboarding/Shell.tsx` (`World`,
  `Box`, `PickRows`, `Pass`, `Photo`, `AppWall`), `AskStep.tsx` (`AskYourAi`), `PickStep.tsx` (`FirstAgentPick`),
  `WeekStep.tsx` (`FirstWeek`), `HireStep.tsx` (`HireTeam`), `CelebrateStep.tsx` (`TeamWelcome`), `AiStep.tsx`,
  `PeopleStep.tsx`.
