import { useEffect, useState } from 'react'
import { DevelopmentConnection, type ConnectionState } from '@copyrade/connection'
import {
  decodeProtocolMessage,
  encodeProtocolMessage,
  type ClipboardAckMessage,
  type ErrorMessage,
  type ProtocolErrorCode,
  type ProtocolMessage,
} from '@copyrade/protocol'
import './App.css'

const connection = new DevelopmentConnection()
const sessionCode = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
  byte.toString(16).padStart(2, '0'),
).join('')

type WriteStatus = 'idle' | 'writing' | 'success' | 'error'

function App() {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const [connectionError, setConnectionError] = useState('')
  const [text, setText] = useState('')
  const [status, setStatus] = useState<WriteStatus>('idle')
  const [statusMessage, setStatusMessage] = useState(
    'Enter synthetic test text, then write it to the Windows clipboard.',
  )

  useEffect(() => {
    function sendProtocolMessage(message: ProtocolMessage): boolean {
      try {
        connection.sendData(encodeProtocolMessage(message))
        return true
      } catch {
        return false
      }
    }

    const unsubscribeState = connection.subscribe((state) => {
      setConnectionState(state)
      setConnectionError(connection.error ?? '')
    })
    const unsubscribeMessages = connection.subscribeMessages((raw) => {
      void (async () => {
        const decoded = decodeProtocolMessage(raw)
        if (!decoded.ok || decoded.message.kind !== 'CLIPBOARD_TRANSFER') {
          const error: ErrorMessage = {
            protocolVersion: 1,
            kind: 'ERROR',
            code: 'INVALID_MESSAGE',
            message: 'Windows rejected an invalid transfer message.',
          }
          if (!sendProtocolMessage(error)) {
            setStatus('error')
            setStatusMessage('An invalid transfer was received and could not be reported.')
          }
          return
        }

        const transfer = decoded.message
        const representation = transfer.payload.representations[0]
        setStatus('writing')
        setStatusMessage('Writing received text to the Windows clipboard...')

        let result
        try {
          result = await window.copyrade.clipboard.writeText(representation.text)
        } catch {
          const error: ErrorMessage = {
            protocolVersion: 1,
            kind: 'ERROR',
            transferId: transfer.transferId,
            code: 'CLIPBOARD_WRITE_FAILED',
            message: 'Windows could not update its clipboard.',
          }
          sendProtocolMessage(error)
          setStatus('error')
          setStatusMessage('The desktop bridge did not complete the received clipboard write.')
          return
        }

        if (!result.ok) {
          const code: ProtocolErrorCode = result.error.code === 'PAYLOAD_TOO_LARGE'
            ? 'PAYLOAD_TOO_LARGE'
            : 'CLIPBOARD_WRITE_FAILED'
          const error: ErrorMessage = {
            protocolVersion: 1,
            kind: 'ERROR',
            transferId: transfer.transferId,
            code,
            message: 'Windows could not update its clipboard.',
          }
          sendProtocolMessage(error)
          setStatus('error')
          setStatusMessage(result.error.message)
          return
        }

        const acknowledgement: ClipboardAckMessage = {
          protocolVersion: 1,
          kind: 'CLIPBOARD_ACK',
          transferId: transfer.transferId,
          byteLength: result.byteLength,
        }
        if (!sendProtocolMessage(acknowledgement)) {
          setStatus('error')
          setStatusMessage('Windows updated the clipboard, but confirmation could not be sent.')
          return
        }
        setStatus('success')
        setStatusMessage(
          `Received clipboard write acknowledged (${result.byteLength.toLocaleString()} bytes).`,
        )
      })()
    })

    return () => {
      unsubscribeState()
      unsubscribeMessages()
    }
  }, [])

  async function handleConnect() {
    setConnectionError('')
    try {
      await connection.connect('desktop', sessionCode, 'ws://127.0.0.1:8787/signal')
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Connection failed.')
    }
  }

  async function handleWriteClipboard() {
    setStatus('writing')
    setStatusMessage('Writing to the Windows clipboard...')

    try {
      const result = await window.copyrade.clipboard.writeText(text)

      if (!result.ok) {
        setStatus('error')
        setStatusMessage(result.error.message)
        return
      }

      setStatus('success')
      setStatusMessage(
        `Clipboard write acknowledged (${result.byteLength.toLocaleString()} bytes).`,
      )
    } catch {
      setStatus('error')
      setStatusMessage('The desktop bridge did not complete the clipboard write.')
    }
  }

  function handleTextChange(value: string) {
    setText(value)
    setStatus('idle')
    setStatusMessage(
      'Enter synthetic test text, then write it to the Windows clipboard.',
    )
  }

  return (
    <main className="app-shell">
      <section className="diagnostic-card" aria-labelledby="page-title">
        <header>
          <p className="eyebrow">Windows clipboard capability test</p>
          <h1 id="page-title">Copyrade Desktop</h1>
          <p className="tagline">
            Verify the protected Electron-to-Windows clipboard boundary.
          </p>
        </header>

        <label htmlFor="clipboard-text">Synthetic test text</label>
        <textarea
          id="clipboard-text"
          value={text}
          onChange={(event) => handleTextChange(event.target.value)}
          placeholder="For example: Copyrade clipboard test"
          rows={7}
          maxLength={1024 * 1024}
        />

        <button
          type="button"
          onClick={handleWriteClipboard}
          disabled={status === 'writing' || text.length === 0}
        >
          {status === 'writing' ? 'Writing...' : 'Write to Windows clipboard'}
        </button>

        <p className={`status status--${status}`} role="status" aria-live="polite">
          {statusMessage}
        </p>

        <p className="privacy-note">
          Local test text goes directly to Electron's main process. Text received
          from mobile is validated before the same protected clipboard operation.
          Copyrade does not persist or log clipboard contents.
        </p>

        <section aria-label="Development connection">
          <h2>Development connection</h2>
          <p>Unauthenticated test only. Use synthetic data.</p>
          <label htmlFor="session-code">Session code</label>
          <input id="session-code" readOnly value={sessionCode} />
          <p role="status">DataChannel: {connectionState}</p>
          {connectionError && <p role="alert">{connectionError}</p>}
          <button type="button" onClick={() => void handleConnect()}>Listen for mobile</button>
          <button type="button" onClick={() => connection.disconnect()}>Disconnect</button>
        </section>
      </section>
    </main>
  )
}

export default App
