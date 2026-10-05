# ADR 0001: Cloudflare control plane

- Status: Accepted
- Date: 2026-09-29

## Decision

Host the mobile web build and API together with Cloudflare Workers Static
Assets. Use D1 for durable account/device records and Durable Objects for
account-scoped presence and WebRTC signaling.

## Rationale

One HTTPS origin simplifies cookies, callbacks, and mobile testing. Durable
Objects fit stateful WebSocket coordination, while D1 supplies relational
storage and migrations. Clipboard payloads remain outside these services on the
WebRTC data plane.

## Consequences

The project depends on Cloudflare runtime APIs and must test migrations and
WebSockets in staging. A separate local Node signaling app remains useful only
as a development spike until the Worker replacement is verified.
