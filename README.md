# Copyrade

**Private, direct clipboard continuity from mobile devices to Windows.**

Copyrade is a mobile-to-Windows clipboard application designed to make moving text and images between personal devices fast and effortless. Copy content on a phone, send it to a registered computer, and paste it immediately in Windows—without using email, messaging apps, or cloud clipboard storage.

> **Status:** Early development. Mobile clipboard reading and secure Windows clipboard writing have been validated independently; connecting them through WebRTC is the next major milestone.

## How it will work

1. Copy text or an image on a mobile device.
2. Open the Copyrade PWA and choose a registered Windows computer.
3. Send the clipboard through a direct WebRTC connection.
4. Paste it immediately in Windows with `Ctrl+V`.

The sender receives confirmation after the Windows application successfully updates the native clipboard.

## Why Copyrade?

Moving small pieces of content between mobile devices and Windows often involves an unnecessary intermediate step: sending a message to yourself, uploading a file, or relying on a cloud clipboard history.

Copyrade is designed around a simpler model:

- **Clipboard-first:** received content is written directly to the Windows clipboard.
- **Peer-to-peer:** clipboard payloads travel between devices through WebRTC whenever a direct connection is available.
- **Private by design:** Copyrade infrastructure coordinates devices without storing clipboard contents.
- **Cross-network:** devices connect through authenticated signaling instead of relying on local-network discovery.
- **Extensible:** the protocol is designed to support multiple clipboard representations, beginning with plain text and PNG images.

## Development status

| Component | Status |
|---|---|
| React + TypeScript mobile interface | In progress |
| Plain-text clipboard capability prototype | Complete |
| Real-device iPhone text clipboard diagnostic | Complete |
| Electron Windows clipboard-write diagnostic | Complete |
| Versioned text transfer protocol | Complete |
| WebRTC text transfer and delivery acknowledgement | Planned |
| Accounts and registered-device discovery | Planned |
| Chunked image transfer | Planned |
| Windows packaging and public alpha | Planned |

The current mobile prototype includes:

- user-initiated clipboard reading;
- secure-context and browser-capability detection;
- loading, success, empty, and error states;
- an in-memory clipboard preview and clear action;
- responsive, keyboard-accessible UI;
- ESLint and TypeScript validation with a reproducible Vite build.

The Windows diagnostic includes:

- an isolated Electron renderer with Node.js integration disabled;
- a narrow preload API for text clipboard writes;
- main-process sender, type, and size validation;
- acknowledgement only after the native clipboard write completes;
- automated validation tests without clipboard-content logging.

Real-device testing confirmed text clipboard access in iPhone Safari. Safari
requires the user to approve its native paste action for clipboard reads, which
is a documented platform limitation of the web client.

The initial text-transfer message contract is documented in
[`docs/protocol.md`](docs/protocol.md).

## Architecture

Copyrade separates device coordination from clipboard delivery. The backend acts as a control plane for accounts, registered devices, presence, and WebRTC signaling. Clipboard payloads use a separate peer-to-peer data plane.

```mermaid
flowchart LR
    Mobile[Mobile PWA<br/>React + TypeScript]
    Control[Control plane<br/>Authentication<br/>Device registry<br/>Presence and signaling]
    Desktop[Windows receiver<br/>Electron + React + TypeScript]

    Mobile <-->|Authenticated HTTPS / WSS| Control
    Desktop <-->|Authenticated HTTPS / WSS| Control
    Mobile <-->|Encrypted WebRTC DataChannel<br/>Clipboard payloads| Desktop
```

### Privacy model

Copyrade is being designed so that its backend handles only the metadata required to authenticate users, discover their devices, report presence, and establish peer connections. Clipboard contents are not intended to be stored, queued, or added to a cloud history.

The Windows application will isolate privileged clipboard access inside Electron's main process and expose only a narrow, validated interface to the renderer. Transfer acknowledgements will represent a successful native clipboard write—not merely receipt of a network message.

## Technology

| Area | Technology |
|---|---|
| Mobile client | React, TypeScript, Vite, PWA |
| Windows client | Electron, React, TypeScript |
| Peer-to-peer transport | WebRTC DataChannel |
| Device coordination | Authenticated WebSocket signaling |
| Shared protocol | Versioned, runtime-validated TypeScript messages |
| Planned hosting | Cloudflare Pages, Workers, Durable Objects, and D1 |
| Distribution | GitHub Releases |

The desktop, signaling, protocol, and hosting choices will be validated through working prototypes before the public alpha.

## Repository structure

```text
copyrade/
|-- apps/
|   |-- desktop/         # Electron clipboard-write diagnostic
|   `-- mobile/          # React clipboard-read diagnostic
|-- packages/
|   `-- protocol/        # Versioned, runtime-validated transfer messages
|-- package-lock.json    # Single reproducible dependency lockfile
|-- package.json         # npm workspace commands
|-- .gitignore
`-- README.md
```

The repository will expand to include the signaling service and
architecture/security documentation as those components are implemented.

## Getting started

### Requirements

- Node.js and npm
- A modern browser with Clipboard API support

The current prototype has been tested with Node.js `24.20.0` and npm `11.19.0`.

Install all workspace dependencies once from the repository root:

```bash
npm ci
```

### Run the mobile client

```bash
npm run dev --workspace @copyrade/mobile
```

Open the local address printed by Vite, copy some text, and select **Read clipboard**.

### Run the desktop diagnostic

```bash
npm start --workspace @copyrade/desktop
```

Enter synthetic text, write it to the Windows clipboard, and paste it into
Notepad to confirm the native operation.

### Validate changes

```bash
npm run check
```

## Roadmap

1. Establish direct WebRTC text transfer with delivery acknowledgements.
2. Add accounts, device registration, presence, and authenticated signaling.
3. Validate image clipboard behavior and add bounded, chunked PNG transfer.
4. Harden reconnection, tray operation, validation, packaging, and compatibility.
5. Publish the first documented Windows alpha.

## Contributing

Copyrade is currently under active foundational development. Bug reports and technical feedback are welcome through GitHub Issues. Contribution guidance will be added once the initial architecture and development workflow have stabilized.

## License

No open-source license has been selected yet.
