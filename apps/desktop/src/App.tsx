import { useState } from 'react'
import './App.css'

type WriteStatus = 'idle' | 'writing' | 'success' | 'error'

function App() {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<WriteStatus>('idle')
  const [statusMessage, setStatusMessage] = useState(
    'Enter synthetic test text, then write it to the Windows clipboard.',
  )

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
          This diagnostic sends text only from this local window to Electron's
          main process. It does not use the network, persist the text, or log its
          contents.
        </p>
      </section>
    </main>
  )
}

export default App
