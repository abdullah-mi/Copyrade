import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent as ReactChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { DevelopmentConnection, type ConnectionState } from '@copyrade/connection'
import {
  ImageTransferSender,
  TextTransferSender,
  type OutgoingTransferResult,
} from '@copyrade/transfer'
import type { ImageMimeType } from '@copyrade/protocol'
import { authClient } from './auth-client'
import './App.css'

const connection = new DevelopmentConnection()

type ClipboardStatus = 'idle' | 'reading' | 'success' | 'error'
type TransferStatus = 'idle' | 'sending' | 'success' | 'error'
type AuthStatus = 'idle' | 'signing-in' | 'signing-out'
type SocialProvider = 'github' | 'google'
type TextSource = 'clipboard' | 'manual'

const MANUAL_SEND_DELAY_MS = 1_000
const MAX_DIAGNOSTIC_IMAGE_BYTES = 16 * 1024 * 1024

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

function formatImageSize(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.ceil(bytes / 1_000)} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

function getImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob)
    const image = new Image()

    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Image decoding failed'))
    }
    image.src = objectUrl
  })
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
    'Type text below or paste from the clipboard.',
  )
  const [showImagePicker, setShowImagePicker] = useState(false)
  const [transferStatus, setTransferStatus] = useState<TransferStatus>('idle')
  const [transferMessage, setTransferMessage] = useState(
    'Connect to a Windows device.',
  )
  const transferSender = useRef<TextTransferSender | null>(null)
  const imageTransferSender = useRef<ImageTransferSender | null>(null)
  const textSource = useRef<TextSource>('manual')
  const transferInFlight = useRef(false)
  const activeTransferText = useRef('')
  const queuedTransferText = useRef('')
  const lastSentText = useRef('')
  const clipboardImage = useRef<Blob | null>(null)
  const pendingImage = useRef<Blob | null>(null)
  const pasteRequestTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function clearPasteRequestTimer() {
    if (pasteRequestTimer.current) clearTimeout(pasteRequestTimer.current)
    pasteRequestTimer.current = null
  }

  const refreshDevices = useCallback(async () => {
    const response = await fetch('/api/devices')
    if (!response.ok) throw new Error('Device list failed')
    const body = (await response.json()) as { devices: RegisteredDevice[] }
    setDevices(body.devices)
    setDeviceMessage('')
  }, [])

  const sendText = useCallback((text: string, force = false) => {
    if (text.length === 0 || (!force && text === lastSentText.current)) return false
    if (connection.state !== 'connected') return false
    if (transferInFlight.current) {
      queuedTransferText.current = text
      setTransferMessage('Waiting to send the latest changes...')
      return false
    }
    if (!transferSender.current) return false

    transferInFlight.current = true
    activeTransferText.current = text
    queuedTransferText.current = ''
    setTransferStatus('sending')
    setTransferMessage('Sending...')
    try {
      transferSender.current.sendText(text)
      return true
    } catch (error) {
      transferInFlight.current = false
      activeTransferText.current = ''
      setTransferStatus('error')
      setTransferMessage(error instanceof Error ? error.message : 'The transfer could not be sent.')
      return false
    }
  }, [])

  const sendImage = useCallback(async (blob: Blob) => {
    if (connection.state !== 'connected' || !imageTransferSender.current) {
      setTransferStatus('idle')
      setTransferMessage('Image is ready. Connect to Windows to send it.')
      return false
    }
    if (transferInFlight.current) {
      setTransferStatus('error')
      setTransferMessage('Wait for the current transfer to finish.')
      return false
    }
    if (blob.type !== 'image/png' && blob.type !== 'image/jpeg') {
      setTransferStatus('error')
      setTransferMessage('Copyrade currently supports PNG and JPEG images.')
      return false
    }
    transferInFlight.current = true
    setTransferStatus('sending')
    setTransferMessage('Sending image...')
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer())
      await imageTransferSender.current.sendImage(blob.type as ImageMimeType, bytes)
      return true
    } catch (error) {
      transferInFlight.current = false
      setTransferStatus('error')
      setTransferMessage(error instanceof Error ? error.message : 'The image could not be sent.')
      return false
    }
  }, [])

  useEffect(() => {
    if (connectionState !== 'connected' || !pendingImage.current) return
    const image = pendingImage.current
    pendingImage.current = null
    void sendImage(image).then((started) => {
      if (!started) pendingImage.current = image
    })
  }, [connectionState, sendImage])

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
      const completedText = activeTransferText.current
      activeTransferText.current = ''
      transferInFlight.current = false
      if (result.ok) {
        lastSentText.current = completedText
        setTransferStatus('success')
        setTransferMessage(
          `Sent successfully at ${new Date().toLocaleTimeString()}.`,
        )
      } else {
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

      const queuedText = queuedTransferText.current
      queuedTransferText.current = ''
      if (queuedText && queuedText !== completedText && connection.state === 'connected') {
        queueMicrotask(() => sendText(queuedText))
      } else if (pendingImage.current && connection.state === 'connected') {
        const image = pendingImage.current
        pendingImage.current = null
        queueMicrotask(() => {
          void sendImage(image).then((started) => {
            if (!started) pendingImage.current = image
          })
        })
      }
    }

    const sender = new TextTransferSender(
      (message) => connection.sendData(message),
      handleTransferResult,
    )
    const imageSender = new ImageTransferSender(
      (message) => connection.sendDataWithBackpressure(message),
      (result) => {
        transferInFlight.current = false
        if (result.ok) {
          setTransferStatus('success')
          setTransferMessage(`Sent successfully at ${new Date().toLocaleTimeString()}.`)
        } else {
          setTransferStatus('error')
          setTransferMessage(
            result.remoteMessage ?? (
              result.reason === 'timeout'
                ? 'Windows did not acknowledge the image in time.'
                : 'The image transfer did not complete.'
            ),
          )
        }
      },
    )
    transferSender.current = sender
    imageTransferSender.current = imageSender
    const unsubscribeState = connection.subscribe((state) => {
      setConnectionState(state)
      setConnectionError(connection.error ?? '')
      if (state === 'disconnected' || state === 'failed') setActiveDeviceId(null)
      if (state !== 'connected') {
        sender.connectionClosed()
        imageSender.connectionClosed()
      }
    })
    const unsubscribeMessages = connection.subscribeMessages((raw) => {
      if (!sender.handleMessage(raw)) imageSender.handleMessage(raw)
    })

    return () => {
      unsubscribeState()
      unsubscribeMessages()
      sender.dispose()
      imageSender.dispose()
      if (transferSender.current === sender) transferSender.current = null
      if (imageTransferSender.current === imageSender) imageTransferSender.current = null
    }
  }, [sendImage, sendText])

  useEffect(() => {
    if (
      textSource.current !== 'manual' ||
      connectionState !== 'connected' ||
      transferStatus === 'sending' ||
      clipboardText.length === 0 ||
      clipboardText === lastSentText.current
    ) {
      return
    }
    const timer = setTimeout(() => sendText(clipboardText), MANUAL_SEND_DELAY_MS)
    return () => clearTimeout(timer)
  }, [clipboardText, connectionState, sendText, transferStatus])

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

  async function inspectImage(blob: Blob) {
    if (!blob.type.startsWith('image/') || blob.size === 0) {
      throw new Error('Invalid image data')
    }
    if (blob.size > MAX_DIAGNOSTIC_IMAGE_BYTES) {
      clipboardImage.current = null
      setStatus('error')
      setStatusMessage('The image is larger than 16 MB.')
      return
    }

    const dimensions = await getImageDimensions(blob)
    clipboardImage.current = blob
    pendingImage.current = blob
    textSource.current = 'manual'
    setClipboardText('')
    setShowImagePicker(false)
    setStatus('success')
    setStatusMessage(
      `${blob.type} · ${dimensions.width.toLocaleString()} × ${dimensions.height.toLocaleString()} · ${formatImageSize(blob.size)}`,
    )
    setTransferStatus('idle')
    setTransferMessage(
      connection.state === 'connected'
        ? 'Image is ready to send.'
        : 'Image is ready. Connect to Windows to send it.',
    )
    if (connection.state === 'connected') {
      pendingImage.current = null
      if (!await sendImage(blob)) pendingImage.current = blob
    }
  }

  function acceptPastedText(text: string) {
    clipboardImage.current = null
    pendingImage.current = null
    textSource.current = 'clipboard'
    setClipboardText(text)
    setShowImagePicker(false)
    setStatus('success')
    setStatusMessage('Clipboard text read successfully.')
    if (connection.state === 'connected') {
      sendText(text, true)
    } else {
      setTransferStatus('idle')
      setTransferMessage('Clipboard text is ready. Connect to Windows to send it.')
    }
  }

  async function handlePaste(event: ReactClipboardEvent<HTMLDivElement>) {
    event.preventDefault()
    clearPasteRequestTimer()
    const data = event.clipboardData
    const image = [...data.files].find((candidate) => candidate.type.startsWith('image/'))
      ?? [...data.items]
        .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
        ?.getAsFile()

    if (image) {
      setStatus('reading')
      setStatusMessage('Reading image...')
      try {
        await inspectImage(image)
      } catch {
        clipboardImage.current = null
        setShowImagePicker(true)
        setStatus('error')
        setStatusMessage('Could not read the clipboard image.')
      }
      return
    }

    const text = data.getData('text/plain').trim()
      || data.getData('text/uri-list').trim()
    if (text) {
      acceptPastedText(text)
      return
    }

    const containsFile = [...data.files].length > 0
      || [...data.items].some((item) => item.kind === 'file')
    clipboardImage.current = null
    pendingImage.current = null
    setShowImagePicker(true)
    setStatus('error')
    setStatusMessage(
      containsFile
        ? 'This clipboard file type is not supported.'
        : 'Could not read the clipboard.',
    )
  }

  async function handleImageSelection(event: ReactChangeEvent<HTMLInputElement>) {
    clearPasteRequestTimer()
    const input = event.currentTarget
    const image = input.files?.[0]
    input.value = ''
    if (!image) return

    setStatus('reading')
    setStatusMessage('Reading image...')
    try {
      await inspectImage(image)
    } catch {
      clipboardImage.current = null
      setStatus('error')
      setStatusMessage('Could not read the selected image.')
    }
  }

  function handlePasteRequest() {
    if (!window.isSecureContext) {
      setStatus('error')
      setStatusMessage('Clipboard access requires HTTPS or localhost.')
      return
    }

    clearPasteRequestTimer()
    setStatus('reading')
    setStatusMessage('Choose Paste to read the clipboard.')
    pasteRequestTimer.current = setTimeout(() => {
      pasteRequestTimer.current = null
      setStatus('error')
      setStatusMessage('Paste was cancelled.')
    }, 8_000)
    document.execCommand('paste')
  }

  function handlePasteKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    handlePasteRequest()
  }

  function handleClearPreview() {
    clearPasteRequestTimer()
    clipboardImage.current = null
    pendingImage.current = null
    textSource.current = 'manual'
    setClipboardText('')
    setShowImagePicker(false)
    setStatus('idle')
    setStatusMessage('Type text below or paste from the clipboard.')
    setTransferStatus('idle')
    setTransferMessage('Connect to Windows before sending text.')
  }

  function handleTextChange(value: string) {
    clearPasteRequestTimer()
    clipboardImage.current = null
    pendingImage.current = null
    textSource.current = 'manual'
    setClipboardText(value)
    setShowImagePicker(false)
    setStatus(value.length > 0 ? 'success' : 'idle')
    setStatusMessage(value.length > 0 ? 'Text is ready to send.' : 'Enter or paste text.')
    setTransferStatus('idle')
    setTransferMessage(
      connection.state === 'connected'
        ? 'Waiting for you to finish typing...'
        : 'Connect to Windows before sending.',
    )
  }

  function handleTextBlur() {
    if (textSource.current === 'manual') sendText(clipboardText)
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
          <p role="status">
            Connection: {connectionState === 'connected' ? 'Online' : 'Offline'}
          </p>
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
          <div
            className="paste-target"
            contentEditable
            role="button"
            tabIndex={0}
            inputMode="none"
            aria-label="Paste from the clipboard"
            aria-readonly="true"
            suppressContentEditableWarning
            onBeforeInput={(event) => event.preventDefault()}
            onClick={handlePasteRequest}
            onKeyDown={handlePasteKeyDown}
            onPaste={(event) => void handlePaste(event)}
          >
            Paste
          </div>

          <button
            type="button"
            className="secondary-button"
            onClick={handleClearPreview}
            disabled={
              transferStatus === 'sending' ||
              (clipboardText.length === 0 && status === 'idle')
            }
          >
            Clear
          </button>
        </div>

        <p className={`status status--${status}`} role="status" aria-live="polite">
          {statusMessage}
        </p>

        {showImagePicker && (
          <label className="file-picker secondary-button">
            Choose image
            <input
              type="file"
              accept="image/*"
              onChange={(event) => void handleImageSelection(event)}
            />
          </label>
        )}

        <section className="preview" aria-labelledby="text-to-send-label">
          <label id="text-to-send-label" htmlFor="text-to-send">Text to send</label>
          <textarea
            id="text-to-send"
            value={clipboardText}
            onChange={(event) => handleTextChange(event.target.value)}
            onBlur={handleTextBlur}
            placeholder="Type or paste text here"
            rows={6}
            maxLength={1024 * 1024}
          />
        </section>

        <p
          className={`status status--${transferStatus}`}
          role="status"
          aria-live="polite"
        >
          {transferMessage}
        </p>

      </section>
    </main>
  )
}

export default App
