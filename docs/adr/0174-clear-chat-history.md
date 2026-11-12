# 0174: Hide a conversation's history with /clear

Status: accepted

## Context

After finishing a topic, a person wants a quiet view in the same chat. Deleting messages or resetting the agent's
context would lose information. Earlier messages must remain easy to reach.

## Decision

Web, desktop and phone handle the standalone `/clear` command locally in channels, DMs and threads. It posts no
message. The view hides messages already present, leaving a **Show previous messages** button above the next
messages. That button restores the history and its normal pagination. Explicit message links, search hits and
quotes reveal the history before jumping to the message. Live work and waiting requests remain available.

The boundary is a device preference, scoped to the server, person, workspace and conversation. The web stores it
in localStorage and the phone in its existing SecureStore. It survives reopening the chat and restarting the app,
but does not sync between devices. Clearing device storage forgets it. It contains message ids, never message
bodies. A failed storage write still changes the current view.

Server message ids are ordered UUIDv7s. The boundary uses the last posted id, rather than a displayed timestamp:
an agent reply posted later can be placed earlier in the timeline. Pending sends also keep their client ids in the
boundary so acknowledging one does not make it reappear. Pagination pauses while the history is hidden.

## Consequences

No server API, migration, message deletion, context reset or change to another person's view is needed. The
sidebar, search and other devices keep their existing history. Sending `/clear` with an attachment remains a
normal message with a caption, as with the existing command handling.
