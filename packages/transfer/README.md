# Copyrade Transfer Coordination

This private workspace package coordinates Copyrade's text transfer protocol
without depending on React, Electron, or a browser UI.

It owns sender-side transfer IDs, one-at-a-time delivery, acknowledgement
matching, timeouts, and disconnect failures. On the receiver side it validates
incoming protocol data, calls a supplied clipboard adapter, and emits an
acknowledgement only after that adapter reports a successful write.

The package never logs or persists clipboard content. Its automated tests use
synthetic text and cover acknowledgement ordering, mismatched responses,
write failures, timeouts, and disconnects.
