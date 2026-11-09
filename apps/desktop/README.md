# Copyrade Windows receiver

This Electron/React app registers a Windows PC to a Copyrade account, maintains
receiver presence, accepts authenticated WebRTC connection requests, validates
text and image transfers, writes them to the native Windows clipboard, and
returns a matching acknowledgement.

Copyrade is not yet available as a downloadable Windows app. For now, this
source-run receiver provides the authenticated clipboard-transfer path.

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
- Closing the window keeps the receiver online in the Windows notification
  area. Click the tray icon to restore it or use **Quit Copyrade** to stop it.

The optional **Start Copyrade when I sign in to Windows** setting launches the
receiver directly into the notification area. In a source build, the Windows
startup entry points to the current checkout and Electron executable. Disable
the setting before moving or deleting the checkout. Packaged builds will
register the installed Copyrade executable instead.

Automatic recovery after Windows power or network transitions is working.
Launch-at-login registration and removal have been validated from the source
build, including a hidden start after Windows sign-in and single-instance
behavior. See
the [developer guide](../../docs/getting-started.md) and [security
boundaries](../../docs/security.md).

## Build an internal Windows installer

From the repository root on Windows, with Node.js 24 or newer:

```powershell
npm ci
npm run make:windows
```

The Squirrel installer is written to `out/make/squirrel.windows/x64/`. This is
an unsigned internal test build, not a public release. Forge packages a staged
copy containing the compiled receiver, renderer, and selected icons; source,
private notes, and development credentials are not included.

Before installing it, turn off **Start Copyrade when I sign in to Windows** in
the source-run receiver and quit that receiver from the tray. Install the new
build and open Copyrade from the Start menu. The installed app uses a different
Windows app-data directory from the source-run receiver, so approve the PC in
the browser once for this internal build. Then test online presence, text and
image transfers, close-to-tray behavior, and the installed startup toggle.
Finally, uninstall it from Windows Settings and check that the source checkout
still runs. This test has not yet been completed on a clean Windows account.
