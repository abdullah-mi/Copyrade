# Copyrade Desktop Diagnostic

This Electron application proves that Copyrade can safely request a text write
from an isolated React renderer and complete it through Electron's main process
on the Windows clipboard.

It also implements the first account-device boundary: the desktop requests a
short-lived registration code, opens the hosted Copyrade app for signed-in
approval, and encrypts the resulting device credential with Electron
`safeStorage`. The credential is never exposed to the React renderer.
The main process validates it at startup and periodically while the application
is open, so account-side revocation clears the local registration state.

## Run locally

```powershell
npm ci
npm run build:shared
npm start --workspace @copyrade/desktop
```

Run these commands from the repository root. The desktop startup script builds
the desktop app, but not its shared dependencies.

Enter synthetic text, select **Write to Windows clipboard**, and paste into
Notepad. The application reports success only after Electron acknowledges the
native clipboard write.

## Security boundary

- Node.js integration is disabled in the React renderer.
- Context isolation and Chromium renderer sandboxing are enabled.
- The preload bridge exposes narrow typed clipboard and device-enrollment
  operations rather than Electron's general IPC APIs.
- The main process verifies the requesting frame and validates the payload type
  and size before performing the privileged operation.
- Clipboard contents are not logged, persisted, or sent over the network.

This is a development capability diagnostic, not a packaged Copyrade release.
Its text-write path was manually verified against the Windows clipboard and
Notepad on September 21, 2026.

By default, enrollment uses the staging control plane. Local Worker testing can
override it before starting Electron:

```powershell
$env:COPYRADE_CONTROL_URL = "http://127.0.0.1:8788"
npm start --workspace @copyrade/desktop
```
