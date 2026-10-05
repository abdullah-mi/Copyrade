import { useEffect, useRef, useState } from 'react'
import { DevelopmentConnection, type ConnectionState } from '@copyrade/connection'
import { TextTransferSender, type OutgoingTransferResult } from '@copyrade/transfer'
import { authClient } from './auth-client'
import './App.css'

const connection = new DevelopmentConnection()
const SESSION_CODE_KEY = 'copyrade.developmentSessionCode'

type ClipboardStatus = 'idle' | 'reading' | 'success' | 'error'
type TransferStatus = 'idle' | 'sending' | 'success' | 'error'
type AuthStatus = 'idle' | 'signing-in' | 'signing-out'
type SocialProvider = 'github' | 'google'
type AuthSession = {
  user: {
    email: string
  }
}

function getAuthCallbackMessage(): string {
  const error = new URL(location.href).searchParams.get('error')

  switch (error) {
    case 'account_not_linked':
      return 'That identity is not linked to this Copyrade account. Sign in with the original method, then link it from account settings.'
    case 'email_not_found':
    case 'email_is_missing':
      return 'The provider did not supply an email address. Check its email-sharing permission and try again.'
    case 'email_not_verified':
      return 'Copyrade requires a verified email address from the sign-in provider.'
    case null:
      return ''
    default:
      return 'Sign-in did not complete. Try again.'
  }
}

function getClipboardErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Clipboard access was not allowed. Try again and approve any paste prompt shown by your browser.'
  }

  return 'Copyrade could not read the clipboard. Your browser may not support this feature.'
}

function restoreSessionCode(): string {
  try {
    return sessionStorage.getItem(SESSION_CODE_KEY) ?? ''
  } catch {
    return ''
  }
}

function App() {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [isSessionPending, setIsSessionPending] = useState(true)
  const [authStatus, setAuthStatus] = useState<AuthStatus>('idle')
  const [authMessage, setAuthMessage] = useState(getAuthCallbackMessage)
  const [sessionCode, setSessionCode] = useState(restoreSessionCode)
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const [connectionError, setConnectionError] = useState('')
  const [clipboardText, setClipboardText] = useState('')
  const [status, setStatus] = useState<ClipboardStatus>('idle')
  const [statusMessage, setStatusMessage] = useState(
    'Type text below or read it from the clipboard.',
  )
  const [transferStatus, setTransferStatus] = useState<TransferStatus>('idle')
  const [transferMessage, setTransferMessage] = useState(
    'Connect to Windows and read clipboard text before sending.',
  )
  const transferSender = useRef<TextTransferSender | null>(null)

  useEffect(() => {
    let disposed = false

    void authClient
      .getSession()
      .then((result) => {
        if (disposed) return
        if (result.error) {
          setAuthMessage((message) =>
            message || 'Copyrade could not check the current session.',
          )
          return
        }

        setSession(result.data)
      })
      .catch(() => {
        if (!disposed) {
          setAuthMessage((message) =>
            message || 'Copyrade could not check the current session.',
          )
        }
      })
      .finally(() => {
        if (!disposed) setIsSessionPending(false)
      })

    return () => {
      disposed = true
    }
  }, [])

  useEffect(() => {
    const url = new URL(location.href)
    if (!url.searchParams.has('error')) return

    url.searchParams.delete('error')
    url.searchParams.delete('error_description')
    history.replaceState(history.state, '', url)
  }, [])

  useEffect(() => {
    if (isSessionPending) return

    const destination = session ? '/app' : '/login'
    if (location.pathname !== destination) {
      history.replaceState(history.state, '', destination)
    }
  }, [isSessionPending, session])

  useEffect(() => {
    function handleTransferResult(result: OutgoingTransferResult) {
      if (result.ok) {
        setTransferStatus('success')
        setTransferMessage(
          `Windows clipboard updated (${result.byteLength.toLocaleString()} bytes).`,
        )
        return
      }

      setTransferStatus('error')
      switch (result.reason) {
        case 'acknowledgement_size_mismatch':
          setTransferMessage('Windows returned an acknowledgement with the wrong size.')
          break
        case 'connection_closed':
          setTransferMessage('The connection closed before Windows acknowledged the transfer.')
          break
        case 'invalid_response':
          setTransferMessage('Windows returned an invalid response.')
          break
        case 'remote_error':
          setTransferMessage(result.remoteMessage ?? 'Windows rejected the transfer.')
          break
        case 'timeout':
          setTransferMessage('Windows did not acknowledge the clipboard write in time.')
          break
      }
    }

    const sender = new TextTransferSender(
      (message) => connection.sendData(message),
      handleTransferResult,
    )
    transferSender.current = sender
    const unsubscribeState = connection.subscribe((state) => {
      setConnectionState(state)
      setConnectionError(connection.error ?? '')
      if (state !== 'connected') sender.connectionClosed()
    })
    const unsubscribeMessages = connection.subscribeMessages((raw) => sender.handleMessage(raw))

    return () => {
      unsubscribeState()
      unsubscribeMessages()
      sender.dispose()
      if (transferSender.current === sender) transferSender.current = null
    }
  }, [])

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
      setTransferStatus('idle')
      setTransferMessage('Clipboard text is ready to send after connecting to Windows.')
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
    setStatusMessage('Type text below or read it from the clipboard.')
    setTransferStatus('idle')
    setTransferMessage('Connect to Windows and read clipboard text before sending.')
  }

  function handleTextChange(value: string) {
    setClipboardText(value)
    setStatus(value.length > 0 ? 'success' : 'idle')
    setStatusMessage(value.length > 0 ? 'Text is ready to send.' : 'Enter text or read the clipboard.')
    setTransferStatus('idle')
    setTransferMessage('Connect to Windows before sending.')
  }

  function handleSessionCodeChange(value: string) {
    setSessionCode(value)
    try {
      if (value.length > 0) sessionStorage.setItem(SESSION_CODE_KEY, value)
      else sessionStorage.removeItem(SESSION_CODE_KEY)
    } catch {
      setConnectionError('Safari could not retain the session code for this tab.')
    }
  }

  function handleSendClipboard() {
    try {
      setTransferStatus('sending')
      setTransferMessage('Waiting for Windows to update its clipboard...')
      if (!transferSender.current) throw new Error('The transfer service is not ready.')
      transferSender.current.sendText(clipboardText)
    } catch (error) {
      setTransferStatus('error')
      setTransferMessage(error instanceof Error ? error.message : 'The transfer could not be sent.')
    }
  }

  async function handleSignIn(provider: SocialProvider) {
    setAuthStatus('signing-in')
    setAuthMessage('')

    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: '/app',
      })

      if (result.error) {
        setAuthStatus('idle')
        setAuthMessage('Sign-in could not be started. Try again.')
      }
    } catch {
      setAuthStatus('idle')
      setAuthMessage('Sign-in could not be started. Try again.')
    }
  }

  async function handleSignOut() {
    setAuthStatus('signing-out')
    setAuthMessage('')

    try {
      const result = await authClient.signOut()
      if (result.error) {
        setAuthStatus('idle')
        setAuthMessage('Sign-out did not complete. Try again.')
        return
      }

      location.assign('/login')
    } catch {
      setAuthStatus('idle')
      setAuthMessage('Sign-out did not complete. Try again.')
    }
  }

  if (isSessionPending) {
    return (
      <main className="app-shell">
        <section className="clipboard-card" aria-labelledby="page-title">
          <header>
            <h1 id="page-title">Copyrade</h1>
          </header>
          <p role="status">Checking sign-in status...</p>
        </section>
      </main>
    )
  }

  if (!session) {
    return (
      <main className="app-shell">
        <section className="clipboard-card" aria-labelledby="page-title">
          <header>
            <h1 id="page-title">Copyrade</h1>
          </header>
          <section className="account" aria-labelledby="account-title">
            <h2 id="account-title">Sign in</h2>
            <p>Sign in to access and register your devices.</p>
            <div className="account-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => void handleSignIn('google')}
                disabled={authStatus !== 'idle'}
              >
                Continue with Google
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void handleSignIn('github')}
                disabled={authStatus !== 'idle'}
              >
                Continue with GitHub
              </button>
            </div>
            {authStatus === 'signing-in' && (
              <p role="status">Opening the sign-in provider...</p>
            )}
            {authMessage && <p role="alert">{authMessage}</p>}
          </section>
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <section className="clipboard-card" aria-labelledby="page-title">
        <header>
          <p className="eyebrow">Clipboard capability test</p>
          <h1 id="page-title">Copyrade</h1>
          <p className="tagline">Your clipboard comrade.</p>
        </header>

        <section className="account" aria-labelledby="account-title">
          <h2 id="account-title">Account</h2>
          <p>
            Signed in as <strong>{session.user.email}</strong>
          </p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void handleSignOut()}
            disabled={authStatus !== 'idle'}
          >
            {authStatus === 'signing-out' ? 'Signing out...' : 'Sign out'}
          </button>
          {authMessage && <p role="alert">{authMessage}</p>}
          <p className="account-note">
            Account sign-in is active. Device authorization is the next
            milestone; the development connection below is still unauthenticated.
          </p>
        </section>

        <div className="actions">
          <button
            type="button"
            className="primary-button"
            onClick={handleReadClipboard}
            disabled={status === 'reading' || transferStatus === 'sending'}
          >
            {status === 'reading' ? 'Reading…' : 'Read clipboard'}
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={handleClearPreview}
            disabled={
              transferStatus === 'sending' ||
              (clipboardText.length === 0 && status === 'idle')
            }
          >
            Clear text
          </button>
        </div>

        <p className={`status status--${status}`} role="status" aria-live="polite">
          {statusMessage}
        </p>

        <section className="preview" aria-labelledby="text-to-send-label">
          <label id="text-to-send-label" htmlFor="text-to-send">Text to send</label>
          <textarea
            id="text-to-send"
            value={clipboardText}
            onChange={(event) => handleTextChange(event.target.value)}
            placeholder="Type text here or use Read clipboard"
            rows={6}
            maxLength={1024 * 1024}
            disabled={transferStatus === 'sending'}
          />
        </section>

        <button
          type="button"
          className="primary-button"
          onClick={handleSendClipboard}
          disabled={
            connectionState !== 'connected' ||
            clipboardText.length === 0 ||
            transferStatus === 'sending'
          }
        >
          {transferStatus === 'sending' ? 'Sending...' : 'Send to Windows'}
        </button>
        <p
          className={`status status--${transferStatus}`}
          role="status"
          aria-live="polite"
        >
          {transferMessage}
        </p>

        <p className="privacy-note">
          The text remains in this page's memory. When you choose to send it,
          the text travels over the connected WebRTC DataChannel and is not sent
          through the signaling server or stored by Copyrade.
        </p>

        <section aria-label="Development connection" className="preview">
          <h2>Development connection</h2>
          <p>Unauthenticated test only. Use synthetic data.</p>
          <label htmlFor="session-code">Session code from Windows</label>
          <input
            id="session-code"
            value={sessionCode}
            onChange={(event) => handleSessionCodeChange(event.target.value)}
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
