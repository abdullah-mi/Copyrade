# Compatibility

This page tracks where I have tested Copyrade, what worked, and what still needs
more coverage. Clipboard contents and account credentials are never included in
these notes or application logs.

## Tested at a glance

| Area | Works today | Still to test |
| --- | --- | --- |
| Text delivery | Authenticated iPhone 13 Pro Safari → Windows native clipboard write and matching ACK | Other iPhone models, Android, desktop browsers, and broad Windows versions |
| Accounts/devices | Google/GitHub sign-in, enrollment, discovery, presence, revocation, and restart behavior on staging | Account recovery, password sign-in, and large multi-device deployments |
| Connection lifecycle | Disconnect and explicit reconnect, including recovery after Safari backgrounding | Reliable background operation, sleep/wake behavior, and every network type |
| Image acquisition | Safari PNG and Photos-derived JPEG representations acquired in the web client | Image transfer or Windows image clipboard writing |
| Network traversal | Connections completed in the setups below | Selected ICE route, STUN-only reliability, TURN behavior, and more networks without Tailscale |

The dated test history below has the details behind this summary.

## Verified manually

| Date | Sender | Receiver | Network | Result | Follow-up |
| --- | --- | --- | --- | --- | --- |
| 2026-09-21 | iPhone Safari | N/A | HTTPS development tunnel | User-initiated text clipboard read succeeded after Safari's native Paste action. | iPhone model and iOS/Safari version |
| 2026-09-22 | iPhone Safari | Windows Electron development app | Phone at school, PC at home, Tailscale enabled on both | WebRTC DataChannel connected after nullable ICE candidate handling was fixed. | Windows version, Electron version, selected ICE candidate route |
| 2026-09-28 | iPhone 13 Pro, Safari on iOS 26.4.1 | Windows Electron development app | Temporary HTTPS tunnel to the development environment | Wrong-code timeout and recovery, disconnect/reconnect, editable text input, native Windows clipboard write, and matching ACK succeeded. | Windows version, timings, network route |
| 2026-10-11 | iPhone 13 Pro, Safari on iOS 26.4.1 | Registered Windows Electron staging receiver | Hosted Cloudflare staging control plane; peer route not recorded | Google/GitHub session flow, device discovery, account-scoped signaling, text delivery, native clipboard write, matching ACK, clean disconnect, and web revocation succeeded. | Windows version, timings, selected ICE route; identify the Safari extension associated with normal-tab instability |
| 2026-10-11 | iPhone 13 Pro, Safari on iOS 26.4.1 | Persistent Windows Electron staging receiver | Hosted Cloudflare staging control plane | Live online/offline state, automatic connection request without manual listening, connection, text transfer, disconnect, receiver restart, and single-instance behavior succeeded. Electron logged DNS failures for the Cloudflare STUN hostname and randomized `.local` mDNS candidates, but another ICE path connected successfully. | Record the selected ICE route and repeat on networks without Tailscale before deciding whether this indicates a product defect |
| 2026-10-11 | iPhone 13 Pro, Safari on iOS 26.4.1 | Persistent Windows Electron staging receiver | Safari background/foreground recovery | Backgrounding Safari ended the DataChannel, then an explicit connection request recovered successfully after the stale-socket replacement fix. Clipboard-read auto-send and idle-typed auto-send both updated the Windows clipboard and received acknowledgements. | Retest the final desktop `disconnected` presentation after rebuilding; broader iOS suspension behavior remains a compatibility concern |
| 2026-10-12 | iPhone 13 Pro, Safari on iOS 26.4.1 | Hosted staging web client | Image acquisition | A web image was available as PNG. Photos images copied from PNG, JPEG, and HEIF sources were not exposed through the async Clipboard API, but a paste event exposed each as a decodable JPEG with dimensions and size. | Use the paste-event path for the web prototype; image transfer and Windows clipboard writing remain unimplemented |
| 2026-10-12 | iPhone 13 Pro, Safari on iOS 26.4.1 | Hosted staging web client | Unified Paste control | One Paste action successfully distinguished text, URL, Photos JPEG, and Safari PNG representations. Reported image byte sizes sometimes differed from Photos because Safari received a transcoded clipboard representation rather than the original asset. | Preserve the received JPEG/PNG bytes during the image-transfer milestone; use explicit file import for original-file fidelity |

Copyrade has worked in the setups above. My first cross-network test used
Tailscale, and I did not record the selected ICE route, so I still need to test
more ordinary and restrictive networks before claiming broad reliability.

## Things I still want to test

- Record the exact Windows version.
- Test Unicode, emoji, URLs, code, and Windows/Unix line endings.
- Disconnect after sending but before acknowledgement and verify a clear error.
- Test home Wi-Fi, phone hotspot, and a restrictive network without Tailscale.
- Test the Electron receiver while visible, hidden, and eventually tray-resident.
- Record repeatable send-to-native-write acknowledgement timings before making
  any latency claim.
