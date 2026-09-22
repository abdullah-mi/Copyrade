import { useEffect, useState } from 'react'
import { DevelopmentConnection, type ConnectionState } from '@copyrade/connection'
import './App.css'

const connection = new DevelopmentConnection()

type ClipboardStatus = 'idle' | 'reading' | 'success' | 'error'

function getClipboardErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Clipboard access was not allowed. Try again and approve any paste prompt shown by your browser.'
  }

  return 'Copyrade could not read the clipboard. Your browser may not support this feature.'
}

function App() {
  const [sessionCode, setSessionCode] = useState('')
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const [connectionError, setConnectionError] = useState('')
  const [clipboardText, setClipboardText] = useState('')
  const [status, setStatus] = useState<ClipboardStatus>('idle')
  const [statusMessage, setStatusMessage] = useState(
    'Copy some text, then use the button below.',
  )

  useEffect(() => connection.subscribe(setConnectionState), [])

  async function handleConnect() {
    setConnectionError('')
    try {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      await connection.connect('mobile', sessionCode.trim().toLowerCase(), `${protocol}//${location.host}/signal`)
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Connection failed.')
    }
  }

  async function handleReadClipboard() {
    if (!window.isSecureContext) {
      setStatus('error')
      setStatusMessage('Clipboard access requires HTTPS or localhost.')
      return
    }

    if (!navigator.clipboard?.readText) {
      setStatus('error')
      setStatusMessage('This browser does not support reading clipboard text.')
      return
    }

    setStatus('reading')
    setStatusMessage('Waiting for clipboard access...')

    try {
      const text = await navigator.clipboard.readText()

      setClipboardText(text)
      setStatus('success')
      setStatusMessage(
        text.length > 0
          ? 'Clipboard text read successfully.'
          : 'The clipboard did not contain any text.',
      )
    } catch (error: unknown) {
      setStatus('error')
      setStatusMessage(getClipboardErrorMessage(error))
    }
  }

  function handleClearPreview() {
    setClipboardText('')
    setStatus('idle')
    setStatusMessage('Copy some text, then use the button below.')
  }

  return (
    <main className="app-shell">
      <section className="clipboard-card" aria-labelledby="page-title">
        <header>
          <p className="eyebrow">Clipboard capability test</p>
          <h1 id="page-title">Copyrade</h1>
          <p className="tagline">Your clipboard comrade.</p>
        </header>

        <div className="actions">
          <button
            type="button"
            className="primary-button"
            onClick={handleReadClipboard}
            disabled={status === 'reading'}
          >
            {status === 'reading' ? 'Reading…' : 'Read clipboard'}
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={handleClearPreview}
            disabled={clipboardText.length === 0 && status === 'idle'}
          >
            Clear preview
          </button>
        </div>

        <p className={`status status--${status}`} role="status" aria-live="polite">
          {statusMessage}
        </p>

        <section className="preview" aria-labelledby="preview-title">
          <h2 id="preview-title">Clipboard preview</h2>
          {clipboardText.length > 0 ? (
            <pre>{clipboardText}</pre>
          ) : (
            <p className="empty-preview">No clipboard text has been read.</p>
          )}
        </section>

        <p className="privacy-note">
          This test keeps the preview in this page's memory. It does not send or
          store the clipboard contents.
        </p>

        <section aria-label="Development connection" className="preview">
          <h2>Development connection</h2>
          <p>Unauthenticated test only. Use synthetic data.</p>
          <label htmlFor="session-code">Session code from Windows</label>
          <input
            id="session-code"
            value={sessionCode}
            onChange={(event) => setSessionCode(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            maxLength={32}
          />
          <p role="status">DataChannel: {connectionState}</p>
          {connectionError && <p role="alert">{connectionError}</p>}
          <button type="button" onClick={() => void handleConnect()}>Connect</button>
          <button type="button" onClick={() => connection.disconnect()}>Disconnect</button>
        </section>
      </section>
    </main>
  )
}

export default App
