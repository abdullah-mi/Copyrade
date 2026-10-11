import { useCallback, useEffect, useRef, useState } from 'react'
import { DevelopmentConnection, type ConnectionState } from '@copyrade/connection'
import { TextTransferSender, type OutgoingTransferResult } from '@copyrade/transfer'
import { authClient } from './auth-client'
import './App.css'

const connection = new DevelopmentConnection()

type ClipboardStatus = 'idle' | 'reading' | 'success' | 'error'
type TransferStatus = 'idle' | 'sending' | 'success' | 'error'
type AuthStatus = 'idle' | 'signing-in' | 'signing-out'
type SocialProvider = 'github' | 'google'

const AUTHORIZATION_HOSTS: Record<SocialProvider, string> = {
  github: 'github.com',
  google: 'accounts.google.com',
}

type AuthSession = {
  user: {
    email: string
  }
}
type RegisteredDevice = {
  id: string
  name: string
  platform: 'windows'
  createdAt: number
  lastSeenAt: number | null
  online: boolean
}
type EnrollmentReview = {
  userCode: string
  deviceName: string
  platform: 'windows'
  expiresAt: number
  approved: boolean
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

function App() {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [isSessionPending, setIsSessionPending] = useState(true)
  const [authStatus, setAuthStatus] = useState<AuthStatus>('idle')
  const [authMessage, setAuthMessage] = useState(getAuthCallbackMessage)
  const [devices, setDevices] = useState<RegisteredDevice[]>([])
  const [deviceMessage, setDeviceMessage] = useState('')
  const [enrollmentReview, setEnrollmentReview] = useState<EnrollmentReview | null>(null)
  const [enrollmentMessage, setEnrollmentMessage] = useState('')
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null)
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

  const refreshDevices = useCallback(async () => {
    const response = await fetch('/api/devices')
    if (!response.ok) throw new Error('Device list failed')
    const body = (await response.json()) as { devices: RegisteredDevice[] }
    setDevices(body.devices)
    setDeviceMessage('')
  }, [])

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
      const url = new URL(location.href)
      url.pathname = destination
      history.replaceState(history.state, '', url)
    }
  }, [isSessionPending, session])

  useEffect(() => {
    if (!session) return
    let disposed = false

    const initialDeviceRefresh = setTimeout(() => {
      void refreshDevices().catch(() => {
        if (!disposed) setDeviceMessage('Registered devices could not be loaded.')
      })
    }, 0)

    const enrollmentCode = new URL(location.href).searchParams.get('enroll')
    if (enrollmentCode) {
      void fetch(`/api/device-enrollments?code=${encodeURIComponent(enrollmentCode)}`)
        .then(async (response) => {
          if (!response.ok) throw new Error('Enrollment lookup failed')
          const body = (await response.json()) as { enrollment: EnrollmentReview }
          if (!disposed) setEnrollmentReview(body.enrollment)
        })
        .catch(() => {
          if (!disposed) {
            setEnrollmentMessage('This device enrollment code is invalid or expired.')
          }
        })
    }

    return () => {
      disposed = true
      clearTimeout(initialDeviceRefresh)
    }
  }, [session, refreshDevices])

  useEffect(() => {
    if (!session) return
    let disposed = false
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let retryDelay = 1_000

    const connectPresence = async () => {
      try {
        const response = await fetch('/api/presence-ticket', { method: 'POST' })
        const authorization = (await response.json()) as { ticket?: string }
        if (!response.ok || !authorization.ticket) throw new Error('Presence unavailable')
        if (disposed) return
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
        socket = new WebSocket(`${protocol}//${location.host}/api/presence`, [
          'copyrade-presence-v1',
          authorization.ticket,
        ])
        socket.onmessage = (event) => {
          if (typeof event.data !== 'string' || event.data.length > 4096) return
          try {
            const message: unknown = JSON.parse(event.data)
            if (
              message &&
              typeof message === 'object' &&
              'type' in message &&
              message.type === 'presence'
            ) {
              retryDelay = 1_000
              void refreshDevices()
            }
          } catch {
            socket?.close(1008, 'Invalid presence message')
          }
        }
        socket.onclose = () => {
          if (disposed) return
          socket = null
          reconnectTimer = setTimeout(() => void connectPresence(), retryDelay)
          retryDelay = Math.min(retryDelay * 2, 30_000)
        }
        socket.onerror = () => socket?.close()
      } catch {
        if (disposed) return
        reconnectTimer = setTimeout(() => void connectPresence(), retryDelay)
        retryDelay = Math.min(retryDelay * 2, 30_000)
      }
    }

    void connectPresence()
    return () => {
      disposed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      socket?.close(1000, 'Presence stopped')
    }
  }, [session, refreshDevices])

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
      if (state === 'disconnected' || state === 'failed') setActiveDeviceId(null)
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

  async function handleConnect(deviceId: string) {
    setConnectionError('')
    setActiveDeviceId(deviceId)
    try {
      const ticketResponse = await fetch('/api/connection-requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      })
      const authorization = (await ticketResponse.json()) as {
        ticket?: string
        error?: string
      }
      if (!ticketResponse.ok || !authorization.ticket) {
        throw new Error(
          authorization.error === 'DEVICE_NOT_FOUND'
            ? 'That Windows device is no longer registered.'
            : authorization.error === 'DEVICE_OFFLINE'
              ? 'That Windows device is offline.'
            : 'Signaling authorization could not be created.',
        )
      }
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      await connection.connectAuthenticated(
        'mobile',
        authorization.ticket,
        `${protocol}//${location.host}/api/signal`,
      )
    } catch (error) {
      setActiveDeviceId(null)
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
      const enrollmentCode = new URL(location.href).searchParams.get('enroll')
      const callbackURL = enrollmentCode
        ? `/app?enroll=${encodeURIComponent(enrollmentCode)}`
        : '/app'
      const result = await authClient.signIn.social({
        provider,
        callbackURL,
        disableRedirect: true,
      })

      if (result.error) {
        setAuthStatus('idle')
        setAuthMessage('Sign-in could not be started. Try again.')
        return
      }

      const authorizationUrl = result.data?.url
      if (!authorizationUrl) throw new Error('Missing authorization URL')
      const destination = new URL(authorizationUrl)
      if (
        destination.protocol !== 'https:' ||
        destination.hostname !== AUTHORIZATION_HOSTS[provider]
      ) {
        throw new Error('Unexpected authorization URL')
      }
      location.assign(destination.href)
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

  async function handleApproveEnrollment() {
    if (!enrollmentReview) return
    setEnrollmentMessage('Approving this device...')
    try {
      const response = await fetch('/api/device-enrollments/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userCode: enrollmentReview.userCode }),
      })
      if (!response.ok) throw new Error('Approval failed')
      setEnrollmentReview({ ...enrollmentReview, approved: true })
      setEnrollmentMessage(
        `${enrollmentReview.deviceName} is approved. Return to the Windows app to finish.`,
      )
      const url = new URL(location.href)
      url.searchParams.delete('enroll')
      history.replaceState(history.state, '', url)
    } catch {
      setEnrollmentMessage('This device could not be approved. The code may have expired.')
    }
  }

  async function handleRevokeDevice(deviceId: string) {
    setDeviceMessage('Removing device...')
    try {
      const response = await fetch(`/api/devices/${encodeURIComponent(deviceId)}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error('Revocation failed')
      if (activeDeviceId === deviceId) {
        connection.disconnect()
        setActiveDeviceId(null)
      }
      setDevices((current) => current.filter((device) => device.id !== deviceId))
      setDeviceMessage('Device removed.')
    } catch {
      setDeviceMessage('The device could not be removed.')
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
          <h1 id="page-title">Copyrade</h1>
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
            Account sign-in and registered-device authorization are active.
          </p>
        </section>

        {enrollmentReview && (
          <section className="account" aria-labelledby="enrollment-title">
            <h2 id="enrollment-title">Register Windows device</h2>
            <p>
              Register <strong>{enrollmentReview.deviceName}</strong> to your
              Copyrade account? Confirm that code{' '}
              <strong>{enrollmentReview.userCode}</strong> matches the Windows app.
            </p>
            <button
              type="button"
              className="primary-button"
              onClick={() => void handleApproveEnrollment()}
              disabled={enrollmentReview.approved}
            >
              {enrollmentReview.approved ? 'Device approved' : 'Approve device'}
            </button>
          </section>
        )}
        {enrollmentMessage && <p role="status">{enrollmentMessage}</p>}

        <section className="account" aria-labelledby="devices-title">
          <h2 id="devices-title">Registered devices</h2>
          {devices.length === 0 ? (
            <p>No Windows devices are registered.</p>
          ) : (
            <ul className="device-list">
              {devices.map((device) => (
                <li key={device.id}>
                  <span>
                    {device.name} — {device.online ? 'Online' : 'Offline'}
                  </span>
                  <div className="device-actions">
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => void handleConnect(device.id)}
                      disabled={
                        !device.online ||
                        connectionState === 'signaling' ||
                        connectionState === 'connecting' ||
                        connectionState === 'connected'
                      }
                    >
                      {activeDeviceId === device.id && connectionState === 'connected'
                        ? 'Connected'
                        : activeDeviceId === device.id &&
                            (connectionState === 'signaling' || connectionState === 'connecting')
                          ? 'Connecting...'
                          : 'Connect'}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void handleRevokeDevice(device.id)}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {deviceMessage && <p role="status">{deviceMessage}</p>}
          <p role="status">DataChannel: {connectionState}</p>
          {connectionError && <p role="alert">{connectionError}</p>}
          {connectionState !== 'disconnected' && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                connection.disconnect()
                setActiveDeviceId(null)
              }}
            >
              Disconnect
            </button>
          )}
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

      </section>
    </main>
  )
}

export default App
