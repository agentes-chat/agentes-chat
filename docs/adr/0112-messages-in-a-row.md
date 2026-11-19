# 0112. Messages in a row: a burst is one request, a message mid-task updates it

- Status: Accepted
- Date: 2026-11-01
- Code: `packages/engine/src/burst.ts` (`waitForBurst`), `executor.ts` (the wait before the first turn, `deliverSteering(beforeStart)`, `widenRequest`), `live-steer.ts` (`renderSteered` `beforeStart`), `context.ts` ("# How to reply"), `steering.ts` (live delivery only for computer brains), `talker.ts` (`talkerPolicy`), `apps/server/src/engine.ts` (`quietMs`)

## Context

People write to agents the way they text: "oi" / "preciso de uma coisa" / "olha o relatório de ontem e me diz se bate com o quadro", seconds apart, or "ah, e inclui a semana passada também" while the agent already works. A beta user reported that agents get lost when that happens.

What already held (ADR 0029): one active run per agent and conversation. A person's message to an agent that is queued or working goes into that run's inbox (`pending_message_ids`, `insertMessageWithRuns`), in a DM, a thread, a channel with the mention, and as a follow-up without @ to the agent still answering that person (the floor). The router waits `ROUTER_QUIET_MS` for the same person's next message and decides once on the run of them. The executor reads the inbox before every model call and before ending (an answer written while someone wrote is posted, then the run goes on), a computer brain mid-turn takes it live (Claude Code at its next tool boundary, Codex's app-server at its next request) and whatever it never confirmed is read with its next turn, and every ending hands unread messages to a run of their own. So no second parallel run and nothing lost.

What went wrong:

1. **A burst was answered piece by piece.** A mention or a DM starts its run at once. The worker picks it up in milliseconds and the first model call reads "oi" alone: the agent answers "Oi! Em que posso ajudar?", then reads the rest and answers again. On a computer brain the first turn ran on "oi" alone too.
2. **The rest of a burst read as news.** What joined the inbox before the first call was rendered "[New message from Ana, while you were working]", for a run that hadn't started working.
3. **Nothing told the agent how to take an update.** It got the line, but no rule saying it changes the task in progress.
4. **The judges held the reply to the first message only.** The follow-through verdict reads the request as the trigger's body, so for a burst that was "oi", and for an update it was the plan before it.
5. **The second message could hang its own send for 3 s.** The send asks the executing instance to deliver live to any running run, and waits up to `LIVE_STEER_WAIT_MS` for an answer. A model-brain run never takes messages live, and while its executor was still starting (exactly when the rest of a burst arrives) nobody answered.
6. **"Anotado, leio assim que terminar este passo."** The conversation layer treated a computer-brain run as busy from its first second, so the second message of a burst could get a "noted" for a request the run was about to read.

## Decision

1. **A short quiet window before the first model call.** A run started on a person's message (not background, no turn yet) waits until that person has been quiet in the conversation (same channel, same thread or main timeline) for `quietMs` (`ROUTER_QUIET_MS`, 2.5 s, on a server; off in tests unless set), capped at four windows from the trigger. The wait is measured from the messages' own times, on the database's clock (they are stamped by its `now()`; the app's clock may drift from it), so a run that starts late (the router already waited, a busy worker) waits only what is left, usually nothing, and a lone message waits at most the window. It sits after the context is built and the live-steering listener is up, inside the run's error handling (a failed query on the last try fails the run), and the app already shows the agent thinking. A routed run skips the wait (its trigger is already the last of the burst, so the query could change nothing), and Parar or a shutdown drain ends it at once. Its cost on a mention or DM run is one `SELECT` (the person's latest message time plus the database clock), and one more per window it waits, at most five: a statement on an indexed range per run, against a model call that would otherwise read "oi" alone.
2. **One run reads the whole burst.** The follow-ups join the run's inbox as before; the first loop step reads them, rendered as plain conversation lines ("[Ana]: …") because they came before it started. A computer brain gets them in its first turn's prompt. Receipts are the usual ones (`agent.run.steered` on send, `agent.run.read` when read).
3. **A message mid-task updates the task.** The system prompt says so: messages in a row are one request, answered once; one that comes while the agent works changes course (a correction) or widens it (an addition), and the agent says in a few words that it took it. Delivery is unchanged: the model brain reads it before its next call (or "Parar e mandar" cuts the call), a computer brain live or with its next turn.
4. **The request grows with what the person adds.** Each message the run reads from its inbox (between turns or live) is appended to `transcript.request`, which the follow-through verdict and Continuar read.
5. **Live delivery only for computer brains, answered at once while starting.** The send asks for a live delivery only when the run thinks with a computer brain (`runBrainOf`); a model-brain run reads its inbox at every step anyway. From the moment an instance claims a run until its live-steering listener is up, that instance answers "no turn" at once (`answerNoTurn`), so a send to a computer-brain run that is still starting doesn't wait `LIVE_STEER_WAIT_MS`. Only the owning instance answers, so it never races a live "yes" from another.
6. **The conversation layer leaves a computer brain's first seconds alone.** A computer-brain run that started less than `TALKER_QUIET_MS` ago is `reads_soon`, as a model-brain run with a recent step is.

Autonomy rules are unchanged (ADR 0097): nothing here grants anything, starts work nobody asked for, or keeps a turn going; the window only delays the first call of a run a person started.

## Consequences

- A lone message to an agent starts its first model call up to 2.5 s later than before (less the time to build the context). Bursts get one answer.
- A message that arrives after the window, while the first call is under way, is still read right after it: the first answer is posted and the run goes on with the rest, as before.
- The runner and the brains didn't change: everything happens in the engine before a turn starts. Mid-turn delivery on the runner side (Claude Code's stdin message and its read receipts, Codex's `turn/steer`) is the existing protocol 15 path, covered by the runner tests with the fake CLIs (`apps/server/test/runner/brain.test.ts` "Live steering", `brain-codex-app.test.ts`); the engine side of a mid-turn update (read receipt, widened request) is covered in `packages/engine/test/live-steer.test.ts`.
- A message sent while a computer brain's CLI is still starting (Claude Code before `system/init`, Codex "is starting") no longer waits for the whole CLI turn: when the turn becomes steerable, the listener hands it what waited in the inbox, and while the runner answers `no_turn` it asks again every `LIVE_STEER_RETRY_MS` (1 s, at most 30 times) as long as the same turn is in flight, stopping on delivery, a refusal (`unsupported`), the turn's end or the run's close (`live-steer.ts`). Receipts and the widened request are the usual ones.

## Alternatives considered

- **Joining later messages into a queued run only** (no wait): the worker claims a run in milliseconds, so the burst almost never finds it still queued.
- **Waiting on the person's typing indicator**: precise on the web, but the phone and API clients don't send it, and it would tie the executor to presence. The quiet window works for every client.
- **Holding the first answer when a message arrives during it** (post one combined answer): drops a reply the model already wrote and makes the next one refer to text nobody saw.

## Addendum (2026-11-18): on a computer brain, each answer is its own message, as it comes

What a model brain already did (an answer written while someone wrote is posted, then the run goes on) a computer brain didn't. When Claude Code's turn ended while a message handed to it mid-turn was still queued, the runner kept that answer, waited for the CLI's next turn (the one that reads the message) and joined both answers into one `done`, so the person got two answers glued in one message, and the first one only after the second was written. Codex's app-server did the same with the answer of a turn an urgent message ended. This is the third alternative above, which this ADR rejected, happening on the runner.

Decision:

1. **The server asks for each answer** (`BrainTurnRequest.answers: "each"`, no protocol step: a runner that doesn't read it joins as before). The runner then sends the answer of a CLI turn the request goes on from (a message still queued, work moved to the background, a background task's notice; for Codex, a turn an urgent message ended) as an `answer` event as soon as the CLI ends it, redacted like `done`, and `done` holds only what came after it (nothing when no next turn came).
2. **The engine posts it at once** (`answerNow` in `executor.ts`), before reading anything the brain says after it, where the run answers, as its own message, and records it in the run's conversation before the message read next. What streamed before it is no longer the turn's text (`answered`), so a stop, a pause or the restart sweep never posts it again.
3. **Held back where the turn's end would hold it back.** Only a conversation's run posts early (a routine speaks through its hand-off, long work's report goes home, a mission's and an agents' DM's answers are read whole). The silence word alone or the last message word for word is nothing to post; words the silence word closes, our tools named to a person, or a follow-through verdict of `secret`, `unbacked` or `untried` keep the answer for the turn's end, where it leads the final answer, joined as before, and the usual rules apply to the whole.

Consequences: the person reads the first answer while the agent works on the next; the second answer comes in a message of its own. One follow-through judgment more per early answer, only when a message arrives mid-answer. Covered by the runner tests with the fake CLI (`apps/server/test/runner/brain.test.ts`, "the server takes each answer as it comes…") and `packages/engine/test/live-steer.test.ts` (two messages in order, the secret held back).

## Addendum (2026-11-18, 2): the triage of a message sent mid-task

Until now every message a person sent an agent at work went the same way: into the task, read at its next pause, answered with the task's end. The exceptions were the person's own: "Parar e mandar" to cut the step, and a plain "stop", which a separate Noul judged. That judgment missed the plainest stop of all: with the engine's own state, Jev put "para" at 0.05 and "para!" at 0.59 against a 0.6 bar, so typing "para" never stopped the agent.

Decision:

1. **One judgment says how the agent takes the message** (`steerHandling` in `judge.ts`, kind `steer_triage`): a Choice among `stop` (drop the task), `interrupt` (a correction that makes going on a waste, an urgent problem: read it now), `add` (a detail for the same task: the next pause, as before), `answer` (a greeting, a question about the work: a short reply now, the work goes on) and `queue` (a separate request: after the task, in a run of its own). Its state is the agent's name, what it works on (its request, grown with what the person added, else its trigger) and the message. A way less likely than `STEER_SURE` (0.6) is `add`, so a judge that isn't sure, fails or is off changes nothing. It runs after the send, never in its way, and never for a run of a confidential thread (the judge refuses, ADR 0190).
2. **What each way does** (`steering.ts`): `stop` cancels as before. `interrupt` cuts a model brain's call (`interruptRun`, as "Parar e mandar"); a computer brain mid-turn now gets the message only once the triage said how, a moment after the send: urgent for a correction, and a turn that can't take it now is stopped and started again from it. `queue` takes the message out of what the task's steps read into `agent_runs.after_message_ids` (migration 0306, `queueAfterRun`); every ending hands it on with the unread messages (`takeToHandOn`), the sweeper too, and a run that pauses on what a message can't move hands it on at once. `answer` and `queue` get the fast reply at once (`talkerPolicy` no longer waits for a quiet run), which for a separate request says it's noted and comes after the task (`snapshot.afterTask`). Without a judge everything is as before.

Measured before shipping on 52 messages written for it (synthetic, no conversation of anyone's): 49 right (94%), every stop, correction and addition right; the three misses were follow-ups on the same file taken as additions and an off-topic quick question taken for after the task, all under 0.45 confidence. About 300 ms and 740 input tokens a message.

Consequences: a message sent mid-task costs one Jev call, as the stop check did (that one asked only for short messages). A separate request is answered in its own message after the task instead of inside its final answer. A misjudged `interrupt` costs a cut step, or on a computer whose turn can't take messages a restart from the message, the same as the person pressing "Parar e mandar".
