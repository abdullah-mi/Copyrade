# Copyrade Windows receiver

This Electron/React app registers a Windows PC to a Copyrade account, maintains
receiver presence, accepts authenticated WebRTC connection requests, validates
text transfers, writes them to the native Windows clipboard, and returns a
matching acknowledgement.

Copyrade is not yet available as a downloadable Windows app. For now, this
source-run receiver provides the complete authenticated text-transfer path.

## Run from source

From the repository root:

```powershell
npm ci
npm run build:shared
npm start --workspace @copyrade/desktop
```

The app uses the hosted Copyrade service by default. Registration opens a
browser approval flow; the issued device credential is encrypted with Electron
`safeStorage` and remains in the main process.

For a local Worker override:

```powershell
$env:COPYRADE_CONTROL_URL = "http://127.0.0.1:8788"
npm start --workspace @copyrade/desktop
```

## Privileged boundary

- Node.js integration is disabled; context isolation and renderer sandboxing
  are enabled.
- The preload bridge exposes narrow typed operations, not general Electron IPC.
- The main process checks the requesting frame and validates text type and size
  before writing to the clipboard.
- The receiver acknowledges a transfer only after the native write completes.
- Clipboard content is not logged or persisted by Copyrade.

Image clipboard writes, tray/startup behavior, and Windows packaging remain
planned. See the [developer guide](../../docs/getting-started.md) and
[security boundaries](../../docs/security.md).
