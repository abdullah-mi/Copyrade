# ADR 0003: Browser-approved desktop enrollment

- Status: Accepted
- Date: 2026-10-11

## Decision

Register a Windows receiver with an OAuth-style device flow. Electron requests a
short-lived enrollment grant and opens the Copyrade web app. A signed-in user
must confirm that the displayed code and device name match before the desktop
can exchange its separate, high-entropy secret for a device credential.

Store only keyed hashes of enrollment secrets and device tokens in D1. Store the
issued token only in Electron's main process, encrypted on disk with
`safeStorage`. The renderer receives status and device metadata, never the token.

## Rationale

Electron should not collect account passwords or OAuth cookies. A short visible
code is suitable for human confirmation but too weak to become a persistent
credential. Keeping a separate random device code prevents someone who sees the
confirmation code from completing the exchange on another machine.

## Consequences

Enrollment requires a browser and expires after ten minutes. Starts are limited
per source address, approval requires an authenticated same-origin request, and
the exchange is single use. Electron periodically validates the saved credential
and removes it after server revocation. The next milestone must also enforce the
device token at the signaling boundary.
