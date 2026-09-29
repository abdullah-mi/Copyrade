# Compatibility evidence

This file records observed Copyrade behavior without treating planned support as
verified support. Test content must be synthetic, and clipboard contents must
not be copied into this document or logs.

## Verified manually

| Date | Sender | Receiver | Network | Result | Missing details |
| --- | --- | --- | --- | --- | --- |
| 2026-09-21 | iPhone Safari | N/A | HTTPS development tunnel | User-initiated text clipboard read succeeded after Safari's native Paste action. | iPhone model and iOS/Safari version |
| 2026-09-22 | iPhone Safari | Windows Electron development app | Phone at school, PC at home, Tailscale enabled on both | WebRTC DataChannel connected after nullable ICE candidate handling was fixed. | Windows version, Electron version, selected ICE candidate route |
| 2026-09-28 | iPhone Safari | Windows Electron development app | Temporary HTTPS tunnel to the development environment | Wrong-code timeout and recovery, disconnect/reconnect, editable text input, native Windows clipboard write, and matching ACK succeeded. | Device/OS versions, timings, network route |

These results prove one development setup, not general browser or network
compatibility. Tailscale was present during the initial cross-network test, and
the selected ICE route was not recorded, so that test does not prove ordinary
internet traversal without Tailscale.

## Next compatibility checks

- Record the exact iPhone model, iOS/Safari version, and Windows version.
- Test Unicode, emoji, URLs, code, and Windows/Unix line endings.
- Disconnect after sending but before acknowledgement and verify a clear error.
- Test home Wi-Fi, phone hotspot, and a restrictive network without Tailscale.
- Test the Electron receiver while visible, hidden, and eventually tray-resident.
- Record repeatable send-to-native-write acknowledgement timings before making
  any latency claim.
