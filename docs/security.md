# Security and privacy boundaries

Copyrade moves clipboard content, so authentication alone is not enough. The
system must authenticate both the person and the receiving device, minimize
metadata, and keep clipboard payloads out of cloud storage and application logs.

## Data handled by the control plane

The production control plane may store:

- an internal user ID and profile fields required for sign-in;
- normalized provider identifiers and verified email addresses;
- hashed password credentials if direct email/password login is added;
- hashed or otherwise protected session and device tokens;
- registered device names, public identifiers, timestamps, and revocation state;
- minimal abuse-prevention and operational metadata.

It must not store clipboard text, images, clipboard history, device codes,
session secrets, SDP, ICE candidates, or OAuth credentials in logs. Transient
signaling messages may pass through a Durable Object only to establish WebRTC
and must not be persisted.

## Account linking rules

- Google and GitHub accounts may automatically converge only on the exact same
  provider-verified email address.
- An absent, private, or unverified provider email requires the user to sign in
  to an existing account and explicitly link the provider.
- Email aliases are not guessed. Copyrade does not strip `+tags`, remove dots,
  or merge accounts by username.
- A future password may be attached only through verified-email enrollment or
  while already authenticated to the account.
- Provider tokens receive the narrowest useful scope and are never exposed to
  the browser after server exchange.
- OAuth access, refresh, and ID tokens are encrypted before D1 storage.

These rules prevent an attacker from claiming an unverified matching email and
taking over an existing account.

## Device and session controls

- Device authorization codes are short-lived, one-time, rate-limited, and
  approved from an authenticated browser session.
- Long-lived desktop credentials are revocable and stored using Electron
  `safeStorage`; plaintext tokens do not belong in configuration files.
- The user can inspect and revoke registered devices and active sessions.
- Browser sessions persist in secure, HTTP-only cookies with a seven-day rolling
  lifetime; sign-out revokes the corresponding server-side session.
- WebSocket connections authenticate the account and device before joining an
  account-scoped coordinator.
- The Electron main process continues to validate message type and size before
  writing to the native clipboard.

## Operational defaults

- Secrets are configured through Wrangler secrets or local ignored `.dev.vars`,
  never committed.
- Development uses synthetic clipboard content until device authentication is
  complete.
- Production errors and metrics are metadata-only. Content telemetry is off by
  design.
- Authentication rate limits use D1-backed state rather than per-isolate memory.
- Database migrations are committed and applied first to staging.
- Dependency audits, type checks, tests, and builds run before deployment.

This document describes intended guarantees. Features that are not implemented
must remain labelled as planned in public documentation and UI.
