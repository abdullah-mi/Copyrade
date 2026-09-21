# Copyrade Protocol

This private workspace package defines the versioned application messages that
will cross Copyrade's WebRTC DataChannel.

The initial protocol supports:

- `CLIPBOARD_TRANSFER` with one bounded `text/plain` representation;
- `CLIPBOARD_ACK` after a successful native clipboard write;
- `ERROR` for explicit transfer failures.

Incoming data is validated at runtime because TypeScript types disappear when
the code runs and cannot make network input trustworthy. Validation rejects
unknown fields, unsupported versions, invalid transfer IDs, false byte lengths,
oversized content, and malformed JSON without including clipboard contents in
errors.

Protocol validation does not authenticate a peer. Authentication and device
authorization belong to the future control plane and session setup.
