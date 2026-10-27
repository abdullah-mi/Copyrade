# Compatibility

Copyrade is designed to connect a phone browser to a Windows receiver. Support
will expand as the desktop app is packaged and more devices and networks are
tested.

## Expected compatibility

| Area | Expected support |
| --- | --- |
| Text and links | UTF-8 text and URLs up to 1 MiB |
| Phone browsers | Modern secure-context browsers with WebRTC; clipboard and paste behavior depends on the browser and operating system |
| Windows | The Electron receiver running from source on a modern Windows PC |
| Accounts | Google and GitHub accounts that provide a verified email address |
| Networks | Any network that allows the devices to establish a direct WebRTC connection |
| Images | JPEG and PNG clipboard representations can be delivered to the Windows clipboard |

## Confirmed setup

The complete authenticated text flow has been tested with an iPhone 13 Pro
running Safari on iOS 26.4.1 and the Electron receiver on Windows. This includes:

- Google and GitHub sign-in;
- Windows device enrollment, discovery, presence, restart, and revocation;
- automatic connection requests to a selected PC;
- text and URL delivery to the native Windows clipboard;
- delivery acknowledgement, disconnect, and explicit reconnect;
- recovery after returning to Safari from the background;
- acquisition and Windows clipboard delivery of Safari PNG/JPEG images and
  Photos-derived JPEG representations;
- Windows close-to-tray, restore, explicit quit, and second-launch behavior.

Earlier development tests also connected an iPhone and Windows PC across
different networks. Testing is continuing across more browsers, Windows
versions, and network configurations.

## Current limitations

- Safari requires a user action and may show its native **Paste** callout before
  sharing clipboard content with the web app.
- Backgrounding Safari can close the active connection. Copyrade can reconnect
  after the page becomes active again.
- There is no TURN relay yet, so restrictive firewalls or NAT configurations
  may prevent a direct connection.
- Safari may provide a transcoded JPEG when an image is copied from Photos, even
  when the original file was PNG or HEIF.
- Some Safari copy actions expose only text or the image URL rather than image
  bytes. Copyrade transfers the representation Safari provides; **Choose
  image** is the fallback when image bytes are required.
- Original-file transfer, Android coverage, and the packaged Windows
  application are still in development.

## Help and bug reports

If Copyrade does not work in a setup that should be supported, check the
[getting-started guide](getting-started.md) and the
[architecture notes](architecture.md). Please include the phone, browser,
Windows version, and general network type when
[opening an issue](https://github.com/abdullah-mi/Copyrade/issues/new), but do
not include clipboard contents, account credentials, device codes, or tokens.
