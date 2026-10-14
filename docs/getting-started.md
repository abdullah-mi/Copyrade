# Developer getting started

Copyrade is in early development. The Windows receiver is not packaged, so all
current testing starts from this repository.

## Requirements

- Windows for the Electron receiver;
- Git;
- [Node.js 24 or later](https://nodejs.org/en/download), including npm (the
  repository currently records Node `>=24.0.0`);
- npm 11.19.0, as recorded by the root `packageManager` field;
- an HTTPS origin for Clipboard API testing on a physical iPhone.

Run every command below from the repository root unless stated otherwise.

## Recommended: hosted account flow

This is the closest available path to the intended product experience. It uses
the hosted Cloudflare control plane, Google or GitHub sign-in, an account-bound
device credential, registered-device presence, and authenticated signaling.

```powershell
git clone https://github.com/abdullah-mi/Copyrade.git
Set-Location Copyrade
npm ci
npm run build:shared
npm start --workspace @copyrade/desktop
```

The desktop app defaults to the hosted control plane. To enroll it:

1. In Electron, enter a recognizable device name and start registration.
2. Complete sign-in and approve the matching device/code in the browser window
   Electron opens.
3. Wait for Electron to show that the PC is registered and online.
4. On the phone, open
   [the web app](https://copyrade-staging.abdullahijaz-m.workers.dev), sign
   in to the same Copyrade account, and select the online PC.
5. Connect, paste or type synthetic text, and confirm it can be pasted into a
   Windows application.

Safari requires a user action to read clipboard content and may display its
native **Paste** callout. Backgrounding Safari can close the WebRTC connection;
request a new connection after returning to the page.

The web app is public, but the desktop receiver is not a packaged release.
There is no signed installer, automatic update path, or broad compatibility
guarantee yet.

## Local unauthenticated connection diagnostic

The local diagnostic starts the in-memory signaling server, Vite mobile client,
and Electron together:

```powershell
npm ci
npm run dev:connection
```

This builds all shared workspaces automatically. It uses a manually copied
32-character room code instead of accounts or registered devices. It is for
protocol development only and must use synthetic data.

A physical iPhone needs HTTPS. The tested temporary-tunnel flow is:

1. Start a tunnel to Vite in a separate terminal:

   ```powershell
   npx wrangler tunnel quick-start http://127.0.0.1:5173
   ```

2. Copy only the generated hostname, without `https://`, into the Vite
   allowlist variable and start the development connection from the repository
   root:

   ```powershell
   $env:__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS="example.trycloudflare.com"
   npm run dev:connection
   ```

3. Open the HTTPS tunnel URL on the phone, choose **Listen for mobile** in
   Electron, enter the displayed code on the phone, and connect.

Do not set `server.allowedHosts` to `true`. The tunnel URL is public, ICE uses
STUN without a TURN fallback, and some networks will not establish a connection.
See the full [development connection record](connection-spike.md).

## Local authenticated control plane

Local account testing requires OAuth applications and private development
secrets. Copy the template without committing the result:

```powershell
Copy-Item apps/control/.dev.vars.example apps/control/.dev.vars
npm run db:migrate:local --workspace @copyrade/control
npm run dev:control
```

Replace every placeholder in `.dev.vars` with local-only values and configure
the OAuth callback URLs for the local origin before testing sign-in. The
checked-in Wrangler configuration references staging resources, while commands
without `--remote` use Wrangler's separate local D1 state. See
[`apps/control/README.md`](../apps/control/README.md) for migrations, secrets,
deployment ordering, and callback details.

To point Electron at the local Worker rather than staging:

```powershell
$env:COPYRADE_CONTROL_URL = "http://127.0.0.1:8788"
npm start --workspace @copyrade/desktop
```

## Useful workspace commands

| Task | Command |
| --- | --- |
| Build shared packages | `npm run build:shared` |
| Run mobile Vite client | `npm run dev --workspace @copyrade/mobile` |
| Run Electron receiver | `npm start --workspace @copyrade/desktop` |
| Run local signaling server | `npm run dev --workspace @copyrade/signal` |
| Run local Worker and mobile client | `npm run dev:control` |
| Validate the repository | `npm run check` |

`npm ci` installs dependencies but does not create the shared workspace `dist`
files. Run `npm run build:shared` before starting an individual app after a
fresh checkout; the combined scripts do this where needed.

## Testing boundaries

- The implemented transfer protocol accepts one `text/plain` payload of at
  most 1 MiB. Image acquisition exists in the browser, but image delivery to
  Windows is not implemented.
- Clipboard data is encrypted in transit by WebRTC, but the staging control
  plane still handles account, device, presence, and transient signaling data.
- Initial cross-network evidence includes a test where Tailscale was enabled
  and the selected ICE route was not recorded. Do not infer general traversal
  reliability from that result.
- Record device, OS/browser, network, and observed connection state when adding
  evidence to [`compatibility.md`](compatibility.md). Never record clipboard
  contents, authorization codes, tokens, SDP, or ICE candidates.
