# Development connection spike

This spike tests whether iPhone Safari can open a WebRTC DataChannel to the
Windows Electron renderer. It does not transfer clipboard content or authenticate
devices. The signaling server only holds room membership in memory and relays
bounded SDP/ICE messages; it is not a production control plane.

## Run on one Windows computer

From the repository root, after `npm ci` and
`npm run build --workspace @copyrade/connection`:

1. Start `npm run dev --workspace @copyrade/signal` in a terminal.
2. Start `npm run dev --workspace @copyrade/mobile` in another terminal.
3. Start `npm start --workspace @copyrade/desktop` in a third terminal.
4. In the desktop app, select **Listen for mobile** and copy the 32-character
   session code manually. The code is generated in memory and is not placed in a
   URL, file, or log.
5. For an iPhone, expose Vite's port `5173` with a temporary HTTPS tunnel, as
   described in the mobile diagnostic workflow. The `/signal` WebSocket route
   is proxied through Vite to the localhost-only signaling server.
6. Open the HTTPS Vite address in iPhone Safari, enter the session code, and
   select **Connect**.
7. Confirm that both apps say `DataChannel: connected`. Then disconnect and
   confirm the other side reports a disconnect. Try a wrong code and verify it
   does not show `connected`.

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
- This spike does not yet send text or generate a clipboard-write ACK.

Record the iPhone model, iOS/Safari version, Windows version, network topology,
whether both channel indicators reached `connected`, and any connection errors
before treating the platform spike as proven.

## Test result: 2026-09-22

The user observed `DataChannel: connected` on both iPhone Safari and Windows
Electron. The PC was at home and the phone was at school; Tailscale was enabled
on both. The first attempt briefly connected then failed because the signaling
validator rejected a nullable ICE `usernameFragment`. After the validation fix
and signaling-server restart, both sides remained connected. This establishes
one working cross-network connection, not which ICE candidate pair was selected.
It does not verify clipboard transfer, acknowledgement, disconnect behavior,
or reliability across other networks. Device and OS versions were not recorded.
