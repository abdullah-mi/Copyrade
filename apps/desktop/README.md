# Copyrade Desktop Diagnostic

This Electron application proves that Copyrade can safely request a text write
from an isolated React renderer and complete it through Electron's main process
on the Windows clipboard.

## Run locally

```powershell
npm ci
npm run build --workspace @copyrade/connection
npm start --workspace @copyrade/desktop
```

Run these commands from the repository root. The desktop startup script builds
the desktop app, but not its shared connection dependency.

Enter synthetic text, select **Write to Windows clipboard**, and paste into
Notepad. The application reports success only after Electron acknowledges the
native clipboard write.

## Security boundary

- Node.js integration is disabled in the React renderer.
- Context isolation and Chromium renderer sandboxing are enabled.
- The preload bridge exposes one typed clipboard operation rather than Electron's
  general IPC APIs.
- The main process verifies the requesting frame and validates the payload type
  and size before performing the privileged operation.
- Clipboard contents are not logged, persisted, or sent over the network.

This is a development capability diagnostic, not a packaged Copyrade release.
Its text-write path was manually verified against the Windows clipboard and
Notepad on September 21, 2026.
