# 0006: Desktop storage and distribution

- Status: Accepted
- Date: 2026-10-13

## Context

Copyrade's Electron receiver already stores its revocable device credential in
Electron's per-user `userData` directory and protects it with `safeStorage`.
Image delivery and future file delivery introduce different lifetime and
storage requirements:

- a clipboard image can be received, verified, written to the Windows image
  clipboard, and released without touching disk;
- a clipboard file is a path-backed Windows object, so its bytes must remain on
  disk after Copyrade writes that path to the clipboard;
- account state must survive upgrades, while transient payload data must be
  bounded and removable;
- public builds need predictable installation, update, signing, and uninstall
  behavior.

Treating all of these as one general cache would retain clipboard content
unnecessarily and make ownership and cleanup unclear.

## Decision

### Distribution model

The primary Windows distribution will be an installed, per-user Electron app.
Copyrade will use Electron Forge for packaging because it is the Electron
project's recommended packaging path. The first packaging gate may produce an
unpacked or ZIP test build; the public alpha requires an installer, application
metadata, user-supplied artwork, code signing, and a clean-machine test.

Squirrel.Windows is the leading installer target for the first per-user alpha
because it supports a straightforward user-scoped install and future update
flow. This choice must be validated in the packaging milestone before it is
treated as final. MSI or machine-wide installation is deferred until there is
an enterprise requirement.

A portable build is optional future work. Portable execution must still use
the operating system's per-user application-data directory by default. It must
not place device credentials, transferred payloads, or mutable state beside
the executable.

### Storage classes

Copyrade will keep separate storage classes with explicit owners and
lifetimes:

| Class | Location | Contents | Lifetime |
| --- | --- | --- | --- |
| Persistent state | Electron `userData` | DPAPI-protected device credential and later preferences | Until sign-out, reset, or uninstall cleanup chosen by the user |
| Browser/session data | Electron `sessionData`, separated from durable state when packaging is hardened | Chromium cache and session internals | Browser-managed and safe to clear |
| Logs | Electron logs directory | Bounded diagnostic metadata only | Rotated and removable; never clipboard payloads, credentials, SDP, or ICE candidates |
| Clipboard image working data | Memory only | One bounded PNG or JPEG transfer | Released after native clipboard acknowledgement, cancellation, timeout, or disconnect |
| File-transfer staging | App-specific child of Electron `temp` | Incomplete and clipboard-referenced files | Bounded by age and quota; cleaned on failure and by startup sweep |
| User-saved files | Explicit user destination | Completed original-file transfers | User-owned; Copyrade does not delete them automatically |

The existing root-level `device-credential.enc` remains valid for now. Any
future move into a `state` subdirectory requires a backward-compatible,
crash-safe migration and is not part of image transfer.

### Image clipboard delivery

PNG and JPEG clipboard representations of at most 16 MiB will be assembled and
verified in memory. The desktop will validate the declared type, encoded byte
length, image signature, chunk ordering, and SHA-256 digest before decoding.
It will acknowledge success only after Electron has written the image to the
Windows clipboard. No received image is written to a cache file or retained as
clipboard history.

This preserves the exact encoded representation Copyrade receives for
transport and integrity checks. It does not imply that Safari exposed the
source Photos encoding or that the Windows image clipboard preserves an
original filename or file encoding.

### Original-file delivery

Original files, including future PDF support, are a separate capability. A
file transfer will use a randomized per-transfer staging path under Electron's
temporary directory, a partial-file suffix, strict size and quota limits,
filename/path sanitization, exact byte counts, and SHA-256 verification before
atomic completion.

The first file milestone will prefer an explicit user-selected save location.
If Copyrade later places files on the Windows clipboard, it will use a
`text/uri-list` file representation. Because that clipboard entry references a
path rather than owning the file bytes, Copyrade must retain the staged file
for a documented time-to-live and clean it by age/quota on startup. It must not
auto-open received files.

## Consequences

- Image transfer can proceed before packaging and without building a disk
  cache.
- Packaging becomes a defined lifecycle milestone instead of an incidental
  build-script change.
- True file transfer carries additional storage, cleanup, filename, quota, and
  malware-risk requirements and cannot be presented as a small extension of
  image clipboard support.
- Uninstall and reset UX must eventually distinguish account state, disposable
  cache/session data, and user-owned saved files.
- Clipboard history and server-side payload storage remain out of scope.

## Milestone order

1. Define and test bounded PNG/JPEG transfer framing, integrity, cancellation,
   timeout, and DataChannel backpressure.
2. Add a narrow Electron image-write IPC boundary and acknowledge only after
   the native clipboard accepts the image.
3. Pass real-device image delivery gates and failure cases without disk writes.
4. Add receiver lifecycle and packaging foundations: tray/quit behavior,
   opt-in startup, sleep/wake recovery, product metadata, Forge packaging, and
   clean-machine installation tests.
5. Design and implement a bounded file-staging manager before adding original
   file or PDF delivery.
6. Add signing, release/update policy, uninstall/reset behavior, and public
   alpha documentation.
