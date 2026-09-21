# Copyrade Data Protocol

Status: development protocol for the text-transfer proof  
Current version: `1`

Copyrade uses these messages for clipboard payload delivery over a WebRTC
DataChannel. Signaling messages are a separate control-plane concern and are not
defined here.

The runtime implementation and validation tests live in
`packages/protocol`. This document records the intended semantics.

## Common rules

- Every message includes `protocolVersion: 1` and a discriminating `kind`.
- Transfer IDs contain 16 to 128 URL-safe letters, numbers, underscores, or
  hyphens. UUIDs satisfy this format.
- Version 1 accepts exactly one `text/plain` representation.
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

Images, multiple representations, chunk metadata, cancellation, backpressure,
and replay handling are intentionally outside this text-only protocol slice.
They will require a protocol version or explicitly compatible message extension
after their limits and failure behavior are tested.
