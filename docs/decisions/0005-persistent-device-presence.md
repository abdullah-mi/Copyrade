# ADR 0005: Persistent device presence

- Status: Accepted
- Date: 2026-10-11

## Context

Authenticated signaling originally required the Windows user to select
**Listen for mobile** before the web client connected. The web client also
loaded registered devices only once, so availability and newly enrolled devices
could become stale until a page refresh.

## Decision

An enrolled Electron receiver maintains a separate account-scoped presence
WebSocket. It authenticates the upgrade with a 60-second, single-use ticket
issued from the protected device credential and reconnects with bounded
exponential backoff.

The receiver sends a small heartbeat every ten seconds. Cloudflare handles the
fixed ping/pong pair through its hibernation-compatible auto-response path. An
open web client refreshes its presence view every ten seconds, and the
coordinator stops treating a receiver as online when its heartbeat is more than
25 seconds old. Clipboard content is never part of these messages.

A signed-in browser may open an account observer socket. The observer receives
only online device IDs, then refetches the account-gated device list rather than
trusting presence messages as device metadata. Selecting an online device sends
an authenticated connection request through the account coordinator. Electron
then obtains a new desktop signaling ticket, while the response gives the
browser its corresponding mobile ticket.

Presence, signaling, and clipboard delivery remain separate channels. Presence
never transports SDP, ICE candidates, or clipboard content.

## Consequences

- The receiver can accept connection requests without a manual listening step.
- Online/offline changes and newly online registered devices can update without
  D1 polling or a page reload.
- Electron permits one application instance so duplicate presence sockets do
  not compete for the same registered device.
- Temporary network failures retry from one second up to a 30-second maximum.
- Abrupt network loss may take roughly 25–35 seconds to appear offline, rather
  than waiting for the underlying WebSocket transport timeout.
- Tray behavior, launch-at-login, and behavior during Windows sleep remain
  separate packaging and reliability decisions.
