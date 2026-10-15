# ADR 0004: Account-scoped authenticated signaling

- Status: Accepted
- Date: 2026-10-11

## Context

The initial signaling spike used a user-entered 32-character room code and an
unauthenticated in-memory server. It proved WebRTC negotiation and text transfer
but could not safely identify an account or registered receiver.

## Decision

The hosted control plane issues HMAC-authenticated signaling tickets that expire
after 60 seconds. A signed-in browser may request a mobile ticket only for an
active device owned by its account. Electron obtains a desktop ticket by
authenticating its protected device credential in the main process.

Tickets are sent as WebSocket subprotocol values, not URL parameters. The
Worker verifies each ticket and routes it to a Durable Object keyed by the
internal account ID. The object records each nonce as consumed, matches opposite
roles for the same device ID, and relays only validated, bounded SDP and ICE
messages. Signaling messages are transient and clipboard payloads remain on the
WebRTC DataChannel.

## Consequences

- Routine connections use the account's registered-device list instead of a
  manually copied room code.
- A captured ticket has a short useful lifetime and cannot be replayed after a
  successful connection.
- Durable Objects provide a single coordinator per account and hibernatable
  WebSockets without placing clipboard payloads in Cloudflare storage.
- The existing local room-code server remains available only as an isolated
  development tool; the hosted replacement has been tested in staging.
- Presence, automatic reconnect, TURN, and background/tray behavior remain
  separate milestones.
