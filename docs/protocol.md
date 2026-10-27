# Copyrade Data Protocol

- Status: implemented protocol for text and bounded image transfer
- Current version: `1`

Copyrade uses these messages for clipboard payload delivery over a WebRTC
DataChannel. Signaling messages are a separate control-plane concern and are not
defined here.

Version 1 is used by both the local diagnostic and authenticated hosted path.
It supports inline text plus chunked JPEG and PNG image representations. It
does not support original files or multiple simultaneous representations.

The runtime implementation and validation tests live in
`packages/protocol`. This document records the intended semantics.

## Common rules

- Every message includes `protocolVersion: 1` and a discriminating `kind`.
- Transfer IDs contain 16 to 128 URL-safe letters, numbers, underscores, or
  hyphens. UUIDs satisfy this format.
- Text uses one `text/plain` representation. Images use `image/jpeg` or
  `image/png` framing.
- Text is limited to 1 MiB measured as UTF-8 bytes, not JavaScript characters.
- Serialized messages are limited to the payload maximum plus 4 KiB of framing.
- Unknown fields, unknown message kinds, unsupported versions, and false byte
  lengths are rejected.
- Validation errors never echo clipboard content.
- Protocol validation does not authenticate a peer. Authentication and device
  authorization must happen before the data channel is trusted.

## `CLIPBOARD_TRANSFER`

The sender requests that the receiver write a text representation to its native
clipboard.

```json
{
  "protocolVersion": 1,
  "kind": "CLIPBOARD_TRANSFER",
  "transferId": "123e4567-e89b-12d3-a456-426614174000",
  "payload": {
    "representations": [
      {
        "mimeType": "text/plain",
        "byteLength": 22,
        "text": "Synthetic test content"
      }
    ]
  }
}
```

The receiver must validate the complete message before passing its text across
the Electron IPC boundary.

## Image transfer

Images are limited to 16 MiB and split into ordered 48 KiB chunks. The sender
first sends `IMAGE_TRANSFER_START` with the MIME type, exact byte length, chunk
count, and lowercase SHA-256 digest. It then sends each base64-encoded
`IMAGE_TRANSFER_CHUNK` in order followed by `IMAGE_TRANSFER_END`.

The receiver keeps one image in memory, rejects missing, reordered, malformed,
or oversized chunks, and verifies the final byte length and SHA-256 digest
before crossing the Electron IPC boundary. DataChannel buffered-amount
backpressure prevents the sender from queuing the complete image at once.

## `CLIPBOARD_ACK`

The receiver sends an acknowledgement only after the Electron main process has
successfully completed the native clipboard write.

```json
{
  "protocolVersion": 1,
  "kind": "CLIPBOARD_ACK",
  "transferId": "123e4567-e89b-12d3-a456-426614174000",
  "byteLength": 22
}
```

Receiving a DataChannel message is not enough to generate an ACK. The transfer
ID and byte length allow the sender to match the acknowledgement to its pending
operation.

## `ERROR`

The receiver may report an explicit failure without returning clipboard data.

```json
{
  "protocolVersion": 1,
  "kind": "ERROR",
  "transferId": "123e4567-e89b-12d3-a456-426614174000",
  "code": "CLIPBOARD_WRITE_FAILED",
  "message": "The receiver could not update the Windows clipboard."
}
```

Version 1 defines these error codes:

- `INVALID_MESSAGE`
- `PAYLOAD_TOO_LARGE`
- `CLIPBOARD_WRITE_FAILED`
- `TRANSFER_FAILED`

An error may omit `transferId` when a failure cannot be associated with a valid
transfer.

## Deferred extensions

Original files, multiple representations, explicit cancellation messages, and
replay handling remain deferred. Disconnects and timeouts clear the current
in-memory image transfer.
