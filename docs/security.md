# Security and privacy boundaries

Copyrade handles clipboard content and account credentials. Its security model
therefore separates the Cloudflare control plane, the WebRTC payload path, and
the privileged Windows clipboard boundary. This document identifies what is
implemented, what is planned, and what remains outside the current guarantees.

## Current data boundary

The staging control plane stores the data required to operate accounts and
registered devices:

- internal user IDs, profile fields, verified email addresses, and provider IDs;
- protected OAuth credentials and server-side browser sessions;
- registered-device names, public IDs, timestamps, and revocation state;
- keyed hashes of device credentials and short-lived authorization codes;
- minimal rate-limit and operational metadata.

Clipboard text and images are not stored in D1 or added to a cloud history.
Transient SDP and ICE messages pass through an account-scoped Durable Object to
establish WebRTC, but are not persisted by the application. The codebase does
not implement clipboard-content analytics or logging.

## Implemented controls

### Identity and sessions

- Google and GitHub identities converge automatically only when both providers
  return the exact same verified email address.
- Missing, private, or unverified provider email does not trigger automatic
  linking. Usernames and guessed email aliases are not identity evidence.
- OAuth access, refresh, and ID tokens are encrypted before D1 storage and are
  not exposed to the browser after server exchange.
- Browser sessions use secure, HTTP-only cookies backed by D1 session records.
  The current configuration uses a seven-day rolling lifetime and refreshes an
  active session after one day. Sign-out revokes the server-side session.
- Authentication and enrollment endpoints use D1-backed rate limits rather
  than process-local counters.

### Device enrollment and revocation

- Enrollment expires after ten minutes and requires an authenticated,
  same-origin browser approval.
- The short visible code and high-entropy desktop exchange code are different
  secrets. The exchange is single-use.
- D1 stores keyed hashes of enrollment codes and device tokens, using a secret
  separate from the account-session secret.
- Electron keeps the device token in its main process and encrypts it on disk
  with `safeStorage` (Windows DPAPI). The renderer receives device metadata and
  short-lived tickets, not the credential.
- Removing a device marks it revoked. The coordinator closes matching sockets,
  while Electron's periodic credential check provides a fallback and removes
  the local encrypted credential after a `401` response.

### Signaling and presence

- The browser may request a signaling ticket only for an active device owned by
  its signed-in account. Electron authenticates with its protected credential.
- Signaling and presence tickets expire after 60 seconds, are HMAC-authenticated
  with a dedicated secret, and are passed as WebSocket subprotocol values
  instead of URL parameters.
- Each signaling nonce is consumed once. The account-scoped coordinator pairs
  only opposite roles naming the same registered device.
- The coordinator accepts bounded signaling messages and relays only validated
  SDP and ICE data. Application code does not write these values to D1 or logs.
- Presence is a separate channel. Browser observers receive online device IDs
  and must use the account-gated API to obtain device metadata.

### Clipboard and Electron boundary

- Version 1 accepts one non-empty `text/plain` representation of at most 1 MiB,
  with strict protocol version, message kind, byte-length, and field validation.
- The Electron renderer has Node.js integration disabled, context isolation
  enabled, and Chromium sandboxing enabled.
- The preload bridge exposes narrow clipboard and device operations rather than
  general Electron IPC. The main process checks the sending frame and validates
  text type and size before calling the native clipboard API.
- The sender receives a success ACK only after the native Windows clipboard
  write completes with the expected byte length. Failures do not echo content.
- Browser-acquired image representations are currently held in memory for local
  type, size, and dimension inspection. They are not transmitted, previewed,
  persisted, or logged.

Focused tests cover protocol validation, transfer/ACK ordering, enrollment,
ticket validation, account coordination, and key API boundaries. Manual device
and network checks are tracked in [`compatibility.md`](compatibility.md).

## Planned controls

These safeguards describe future features and must not be presented as shipped.

### Image delivery

- Accept only bounded JPEG and PNG representations.
- Validate declared type, encoded signature, exact byte length, chunk order,
  and SHA-256 before decoding or writing to the Windows clipboard.
- Keep one transfer in memory and release it on ACK, failure, cancellation,
  timeout, or disconnect. Do not create an image cache or clipboard history.

### Original-file and PDF delivery

- Treat original files as a separate capability from image clipboard data.
- Use randomized application-owned temporary paths, partial-file suffixes,
  exact size/hash validation, per-file and total quotas, atomic completion,
  expiry, and startup cleanup.
- Treat filenames as untrusted display metadata, require an explicit destination
  or documented clipboard-file lifetime, and never auto-open received files.

### Distribution and operations

- Sign public Windows builds and verify installer, update, reset, and uninstall
  behavior on a clean machine.
- Define bounded metadata-only diagnostic logs before adding persistent logging.
- Evaluate TURN privacy/cost, direct-only behavior, and application-layer device
  keys before making stronger claims about a malicious control plane.

## Known limitations and trust boundaries

- The staging service learns account, device, presence, IP/network, and
  signaling metadata needed to operate the connection. WebRTC encryption does
  not hide the fact that communication occurred.
- WebRTC DataChannel content is encrypted in transit, but the current design
  trusts the authenticated clients and control plane during signaling. It does
  not yet add separately verified application-layer device keys.
- No TURN relay is configured. Direct ICE connectivity may fail on restrictive
  networks. Some early testing used Tailscale, and the selected route was not
  recorded.
- Windows DPAPI helps isolate the device credential from other OS users; it does
  not guarantee protection from malicious software running as the same user.
- Safari requires user interaction for clipboard reads, can transcode Photos
  assets, and may suspend or close the WebRTC connection in the background.
- The local room-code connection is unauthenticated. Its public HTTPS tunnel and
  shared code are development tools, not durable device authorization.
- There is no signed installer or production release. Running from source
  inherits the security of the local Node/npm environment and installed
  dependencies.
- Revoking a device stops future authorized connections; it cannot erase
  content already written to that device's operating-system clipboard.

Security-sensitive bugs should not include tokens, account identifiers,
clipboard contents, authorization codes, SDP, or ICE candidates in public issue
reports. A private vulnerability-reporting channel has not yet been published.
