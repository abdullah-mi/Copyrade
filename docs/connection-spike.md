# Development connection and text-transfer slice

> **Experimental and unauthenticated:** This is a local room-code diagnostic,
> not the hosted account/device flow. Use synthetic content only. For the
> recommended staging path, start with [`getting-started.md`](getting-started.md).

This development slice tests whether iPhone Safari can open a WebRTC DataChannel
to the Windows Electron renderer, send bounded text, update the native Windows
clipboard, and receive a matching acknowledgement. It does not authenticate
devices. The signaling server only holds room membership in memory and relays
bounded SDP/ICE messages; it is not a production control plane.

## Run on one Windows computer

From the repository root, after `npm ci`:

1. Start `npm run dev:connection`. This builds the shared packages, then starts
   signaling, Vite, and Electron with labelled output. The processes stop
   together when one exits.
2. In the desktop app, select **Listen for mobile** and copy the 32-character
   session code manually. The code is generated in memory and is not placed in a
   URL, file, or log.
3. For an iPhone, expose `http://127.0.0.1:5173` with a temporary HTTPS tunnel
   and leave it running in a separate terminal:

   ```powershell
   npx wrangler tunnel quick-start http://127.0.0.1:5173
   ```

   Before starting the combined development command, set Vite's additional-host
   environment variable to the generated tunnel hostname only (without
   `https://`):

   ```powershell
   $env:__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS="example.trycloudflare.com"
   npm run dev:connection
   ```

   Run the command from the repository root. The `/signal` WebSocket route is
   proxied through Vite to the localhost-only signaling server.
4. Open the HTTPS Vite address in iPhone Safari, enter the session code, and
   select **Connect**.
5. Confirm that both apps say `DataChannel: connected`. Then disconnect and
   confirm the other side reports a disconnect. Try a wrong code and verify it
   does not show `connected`.
6. Enter synthetic text on the phone, send it, paste into Notepad on Windows,
   and confirm that the phone reports success only after the clipboard write.

The Vite host allowlist must name only the tunnel's exact hostname. Do not set
`allowedHosts: true`. Stop the Vite server, tunnel, signaling server, and desktop
app when finished.

## Boundaries and limitations

- The tunnel URL is public. The room code is a development-only shared secret,
  not account authentication or durable device trust. Use synthetic data only.
- Signaling uses WSS through the HTTPS tunnel for the phone, but the desktop app
  reaches the server over local loopback `ws://127.0.0.1:8787`.
- The signaling process binds to loopback only. It does not persist room state or
  clipboard contents, and it does not log SDP, candidates, or room codes.
- ICE uses STUN only. It may fail on restrictive networks because no TURN relay
  is configured. STUN exposes network metadata to the STUN provider.
- DataChannel opening, not WebSocket joining, is the success criterion.
- Text transfer is limited to one in-flight, `text/plain` payload of at most
  1 MiB. Images, replay handling, and chunking are not implemented.

Useful test reports include the phone, browser, Windows version, general network
type, connection state, and any sanitized error message.

## Verified result

On September 22, 2026, the diagnostic reached `DataChannel: connected` between
iPhone Safari and Windows Electron on separate networks with Tailscale enabled.
The first connection exposed a signaling validation bug involving a nullable ICE
`usernameFragment`. After that validation was fixed, the connection remained
stable.

Later tests confirmed:

- disconnect and reconnect from either device;
- a 15-second timeout for unmatched room codes, followed by recovery with the
  correct code;
- bounded text delivery through the DataChannel and Electron's validated IPC
  boundary;
- a success acknowledgement only after Windows updated its native clipboard;
- restoration of the development room code from per-tab session storage after a
  reload, while requiring a new WebRTC connection.

This verifies the development diagnostic and text-transfer path. It does not
establish reliable traversal across every network because the test used
Tailscale and no TURN relay is configured.
