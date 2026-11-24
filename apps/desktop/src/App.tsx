import { useCallback, useEffect, useRef, useState } from 'react'
import { DevelopmentConnection, type ConnectionState } from '@copyrade/connection'
import { ImageTransferReceiver, handleIncomingTextTransfer } from '@copyrade/transfer'
import './App.css'

const connection = new DevelopmentConnection()
const DEVICE_REVOKED_CLOSE_CODE = 4003

type WriteStatus = 'idle' | 'writing' | 'success' | 'error'
type EnrollmentState = 'loading' | 'unenrolled' | 'starting' | 'waiting' | 'cancelling' | 'enrolled' | 'error'
type PresenceState = 'offline' | 'connecting' | 'online'

function App() {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const [connectionError, setConnectionError] = useState('')
  const [text, setText] = useState('')
  const [status, setStatus] = useState<WriteStatus>('idle')
  const [statusMessage, setStatusMessage] = useState(
    'Enter text to test the Windows clipboard.',
  )
  const [enrollmentState, setEnrollmentState] = useState<EnrollmentState>('loading')
  const [enrollmentMessage, setEnrollmentMessage] = useState('Checking device registration...')
  const [presenceState, setPresenceState] = useState<PresenceState>('offline')
  const [recoveryGeneration, setRecoveryGeneration] = useState(0)
  const [launchAtLogin, setLaunchAtLogin] = useState<boolean | null>(null)
  const [startupMessage, setStartupMessage] = useState('')
  const recoveryGenerationRef = useRef(0)
  const deviceStatusRequest = useRef(0)
  const enrollmentTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const enrollmentAttempt = useRef(0)

  const resetReceiverConnections = useCallback(() => {
    recoveryGenerationRef.current += 1
    connection.disconnect()
    setPresenceState('offline')
    setRecoveryGeneration(recoveryGenerationRef.current)
  }, [])

  const refreshDeviceStatus = useCallback(async () => {
    const request = ++deviceStatusRequest.current
    try {
      const result = await window.copyrade.device.getStatus()
      if (request !== deviceStatusRequest.current) return
      if (result.enrolled) {
        setEnrollmentState('enrolled')
        setEnrollmentMessage(
          result.warning ?? `${result.device.name} is registered to your account.`,
        )
      } else if (result.error) {
        setEnrollmentState('error')
        setEnrollmentMessage(result.error)
      } else {
        setEnrollmentState('unenrolled')
        setEnrollmentMessage(
          result.message ?? 'Register this PC before using authenticated connections.',
        )
      }
    } catch {
      if (request !== deviceStatusRequest.current) return
      setEnrollmentState('error')
      setEnrollmentMessage('The protected desktop bridge did not respond.')
    }
  }, [])

  useEffect(() => {
    const initialStatusTimer = setTimeout(() => {
      void refreshDeviceStatus()
    }, 0)

    return () => {
      clearTimeout(initialStatusTimer)
      if (enrollmentTimer.current) clearTimeout(enrollmentTimer.current)
    }
  }, [refreshDeviceStatus])

  useEffect(() => {
    void window.copyrade.system.getLoginItemStatus().then((result) => {
      setLaunchAtLogin(result.supported ? result.enabled : null)
      if (result.error) setStartupMessage(result.error)
    }).catch(() => {
      setStartupMessage('The Windows startup setting could not be read.')
    })
  }, [])

  useEffect(() => {
    if (enrollmentState !== 'enrolled') return
    const interval = setInterval(() => {
      void refreshDeviceStatus()
    }, 15_000)
    return () => clearInterval(interval)
  }, [enrollmentState, refreshDeviceStatus])

  useEffect(() => {
    if (enrollmentState !== 'enrolled' && connection.state !== 'disconnected') {
      connection.disconnect()
    }
  }, [enrollmentState])

  useEffect(() => {
    const removePowerListener = window.copyrade.system.onPowerEvent(() => {
      resetReceiverConnections()
    })
    const handleOffline = () => resetReceiverConnections()
    const handleOnline = () => resetReceiverConnections()
    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)

    return () => {
      removePowerListener()
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [resetReceiverConnections])

  useEffect(() => {
    const imageReceiver = new ImageTransferReceiver({
      writeImage: (mimeType, bytes) => window.copyrade.clipboard.writeImage(mimeType, bytes),
      send: (message) => connection.sendData(message),
      onWriteStart: () => {
        setStatus('writing')
        setStatusMessage('Writing received image to the Windows clipboard...')
      },
      onWriteComplete: () => {
        setStatus('success')
        setStatusMessage('The received image is ready to paste.')
      },
    })
    const unsubscribeState = connection.subscribe((state) => {
      setConnectionState(state)
      setConnectionError(connection.error ?? '')
      if (state !== 'connected') imageReceiver.connectionClosed()
    })
    const unsubscribeMessages = connection.subscribeMessages((raw) => {
      void (async () => {
        if (await imageReceiver.handleMessage(raw)) {
          return
        }
        const result = await handleIncomingTextTransfer(raw, {
          writeText: (text) => window.copyrade.clipboard.writeText(text),
          send: (message) => connection.sendData(message),
          onWriteStart: () => {
            setStatus('writing')
            setStatusMessage('Writing received text to the Windows clipboard...')
          },
        })

        if (result.ok) {
          setStatus('success')
          setStatusMessage(
            `Received clipboard write acknowledged (${result.byteLength.toLocaleString()} bytes).`,
          )
        } else {
          setStatus('error')
          setStatusMessage(result.message)
        }
      })()
    })

    return () => {
      unsubscribeState()
      unsubscribeMessages()
      imageReceiver.dispose()
    }
  }, [])

  const handleConnect = useCallback(async () => {
    const generation = recoveryGenerationRef.current
    setConnectionError('')
    try {
      const authorization = await window.copyrade.device.getSignalingTicket()
      if (generation !== recoveryGenerationRef.current) return
      if (!authorization.ok) throw new Error(authorization.error)
      await connection.connectAuthenticated(
        'desktop',
        authorization.ticket,
        authorization.signalingUrl,
      )
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Connection failed.')
    }
  }, [])

  useEffect(() => {
    if (enrollmentState !== 'enrolled') return

    let disposed = false
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null
    let retryDelay = 1_000

    const connectPresence = async () => {
      setPresenceState('connecting')
      const authorization = await window.copyrade.device.getPresenceTicket()
      if (disposed) return
      if (!authorization.ok) {
        setPresenceState('offline')
        reconnectTimer = setTimeout(() => void connectPresence(), retryDelay)
        retryDelay = Math.min(retryDelay * 2, 30_000)
        return
      }

      socket = new WebSocket(authorization.presenceUrl, [
        'copyrade-presence-v1',
        authorization.ticket,
      ])
      socket.onopen = () => {
        socket?.send('ping')
        heartbeatTimer = setInterval(() => socket?.send('ping'), 10_000)
      }
      socket.onmessage = (event) => {
        if (typeof event.data !== 'string' || event.data.length > 1024) return
        try {
          const message: unknown = JSON.parse(event.data)
          if (!message || typeof message !== 'object' || !('type' in message)) return
          if (message.type === 'ready') {
            retryDelay = 1_000
            setPresenceState('online')
          } else if (message.type === 'connect') {
            void handleConnect()
          }
        } catch {
          socket?.close(1008, 'Invalid presence message')
        }
      }
      socket.onclose = (event) => {
        if (disposed) return
        if (heartbeatTimer) clearInterval(heartbeatTimer)
        heartbeatTimer = null
        socket = null
        setPresenceState('offline')
        if (event.code === DEVICE_REVOKED_CLOSE_CODE) {
          recoveryGenerationRef.current += 1
          connection.disconnect()
          void refreshDeviceStatus()
          return
        }
        reconnectTimer = setTimeout(() => void connectPresence(), retryDelay)
        retryDelay = Math.min(retryDelay * 2, 30_000)
      }
      socket.onerror = () => socket?.close()
    }

    void connectPresence()
    return () => {
      disposed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      socket?.close(1000, 'Presence stopped')
    }
  }, [enrollmentState, handleConnect, recoveryGeneration, refreshDeviceStatus])

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

  async function handleLaunchAtLogin(enabled: boolean) {
    setStartupMessage('Saving startup setting...')
    try {
      const result = await window.copyrade.system.setLoginItem(enabled)
      if (result.error) {
        setStartupMessage(result.error)
        return
      }
      setLaunchAtLogin(result.enabled)
      setStartupMessage(result.enabled
        ? 'Copyrade will start in the notification area when you sign in.'
        : 'Copyrade will not start automatically.')
    } catch {
      setStartupMessage('The Windows startup setting could not be changed.')
    }
  }

  function handleTextChange(value: string) {
    setText(value)
    setStatus('idle')
    setStatusMessage('Enter text to test the Windows clipboard.')
  }

  function scheduleEnrollmentPoll(intervalSeconds: number, attempt: number) {
    if (enrollmentTimer.current) clearTimeout(enrollmentTimer.current)
    enrollmentTimer.current = setTimeout(() => {
      void pollEnrollment(attempt)
    }, intervalSeconds * 1000)
  }

  async function pollEnrollment(attempt: number) {
    const result = await window.copyrade.device.pollEnrollment().catch(() => null)
    if (attempt !== enrollmentAttempt.current) return
    if (!result) {
      setEnrollmentState('error')
      setEnrollmentMessage('Could not check registration. Try again.')
      return
    }
    if (!result.ok) {
      setEnrollmentState('error')
      setEnrollmentMessage(result.error)
      return
    }
    if (result.state === 'enrolled') {
      setEnrollmentState('enrolled')
      setEnrollmentMessage(`${result.device.name} is registered to your account.`)
      return
    }

    scheduleEnrollmentPoll(result.intervalSeconds, attempt)
  }

  async function handleStartEnrollment() {
    const attempt = ++enrollmentAttempt.current
    setEnrollmentState('starting')
    setEnrollmentMessage('Opening the Copyrade web app for approval...')
    const result = await window.copyrade.device.startEnrollment().catch(() => null)
    if (attempt !== enrollmentAttempt.current) return
    if (!result) {
      setEnrollmentState('error')
      setEnrollmentMessage('Could not start registration. Try again.')
      return
    }
    if (!result.ok) {
      setEnrollmentState('error')
      setEnrollmentMessage(result.error)
      return
    }
    if (result.state === 'enrolled') {
      setEnrollmentState('enrolled')
      setEnrollmentMessage(`${result.device.name} is registered to your account.`)
      return
    }

    setEnrollmentState('waiting')
    setEnrollmentMessage('Approve this PC in your browser.')
    scheduleEnrollmentPoll(result.intervalSeconds, attempt)
  }

  async function handleCancelEnrollment() {
    ++enrollmentAttempt.current
    if (enrollmentTimer.current) clearTimeout(enrollmentTimer.current)
    setEnrollmentState('cancelling')
    setEnrollmentMessage('Cancelling registration...')
    try {
      const result = await window.copyrade.device.cancelEnrollment()
      if (result.state === 'enrolled') {
        setEnrollmentState('enrolled')
        setEnrollmentMessage(`${result.device.name} is registered to your account.`)
      } else {
        setEnrollmentState('unenrolled')
        setEnrollmentMessage('Registration cancelled. You can start again.')
      }
    } catch {
      setEnrollmentState('error')
      setEnrollmentMessage('Could not cancel registration. Try again.')
    }
  }

  return (
    <main className="app-shell">
      <section className="diagnostic-card" aria-labelledby="page-title">
        <header>
          <h1 id="page-title">Copyrade Desktop</h1>
        </header>

        <section aria-labelledby="device-enrollment-title">
          <h2 id="device-enrollment-title">This Windows device</h2>
          {enrollmentState !== 'enrolled' && (
            <>
              <button
                type="button"
                onClick={() => void handleStartEnrollment()}
                disabled={enrollmentState === 'loading' || enrollmentState === 'starting' || enrollmentState === 'waiting' || enrollmentState === 'cancelling'}
              >
                {enrollmentState === 'starting' ? 'Opening browser...' : enrollmentState === 'waiting' ? 'Waiting for approval...' : 'Register this PC'}
              </button>
              {(enrollmentState === 'waiting' || enrollmentState === 'cancelling') && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void handleCancelEnrollment()}
                  disabled={enrollmentState === 'cancelling'}
                >
                  Cancel registration
                </button>
              )}
            </>
          )}
          <p role={enrollmentState === 'error' ? 'alert' : 'status'}>
            {enrollmentMessage}
          </p>
        </section>

        <section aria-labelledby="startup-title">
          <h2 id="startup-title">Startup</h2>
          <label className="startup-setting">
            <input
              type="checkbox"
              checked={launchAtLogin ?? false}
              disabled={launchAtLogin === null}
              onChange={(event) => void handleLaunchAtLogin(event.target.checked)}
            />
            <span>Start Copyrade when I sign in to Windows</span>
          </label>
          {startupMessage && <p role="status">{startupMessage}</p>}
        </section>

        <label htmlFor="clipboard-text">Clipboard test</label>
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

        <section aria-label="Account connection">
          <h2>Mobile connection</h2>
          <p role="status">
            Receiver: {enrollmentState === 'enrolled' ? presenceState : 'offline'}
          </p>
          <p role="status">
            Mobile: {connectionState === 'connected' ? 'online' : 'offline'}
          </p>
          {connectionError && <p role="alert">{connectionError}</p>}
          <button
            type="button"
            onClick={() => connection.disconnect()}
            disabled={connectionState === 'disconnected'}
          >
            Disconnect
          </button>
        </section>
      </section>
    </main>
  )
}

export default App
