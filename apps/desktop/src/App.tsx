import { useCallback, useEffect, useRef, useState } from 'react'
import { DevelopmentConnection, type ConnectionState } from '@copyrade/connection'
import { handleIncomingTextTransfer } from '@copyrade/transfer'
import './App.css'

const connection = new DevelopmentConnection()

type WriteStatus = 'idle' | 'writing' | 'success' | 'error'
type EnrollmentState = 'loading' | 'unenrolled' | 'waiting' | 'enrolled' | 'error'
type PresenceState = 'offline' | 'connecting' | 'online'

function App() {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const [connectionError, setConnectionError] = useState('')
  const [text, setText] = useState('')
  const [status, setStatus] = useState<WriteStatus>('idle')
  const [statusMessage, setStatusMessage] = useState(
    'Enter synthetic test text, then write it to the Windows clipboard.',
  )
  const [deviceName, setDeviceName] = useState('Windows PC')
  const [enrollmentState, setEnrollmentState] = useState<EnrollmentState>('loading')
  const [enrollmentMessage, setEnrollmentMessage] = useState('Checking device registration...')
  const [presenceState, setPresenceState] = useState<PresenceState>('offline')
  const enrollmentTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refreshDeviceStatus = useCallback(async () => {
    try {
      const result = await window.copyrade.device.getStatus()
      setDeviceName(result.suggestedName)
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
    const unsubscribeState = connection.subscribe((state) => {
      setConnectionState(state)
      setConnectionError(connection.error ?? '')
    })
    const unsubscribeMessages = connection.subscribeMessages((raw) => {
      void (async () => {
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
    }
  }, [])

  const handleConnect = useCallback(async () => {
    setConnectionError('')
    try {
      const authorization = await window.copyrade.device.getSignalingTicket()
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
      socket.onclose = () => {
        if (disposed) return
        socket = null
        setPresenceState('offline')
        reconnectTimer = setTimeout(() => void connectPresence(), retryDelay)
        retryDelay = Math.min(retryDelay * 2, 30_000)
      }
      socket.onerror = () => socket?.close()
    }

    void connectPresence()
    return () => {
      disposed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      socket?.close(1000, 'Presence stopped')
    }
  }, [enrollmentState, handleConnect])

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

  function scheduleEnrollmentPoll(intervalSeconds: number) {
    if (enrollmentTimer.current) clearTimeout(enrollmentTimer.current)
    enrollmentTimer.current = setTimeout(() => {
      void pollEnrollment()
    }, intervalSeconds * 1000)
  }

  async function pollEnrollment() {
    const result = await window.copyrade.device.pollEnrollment()
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

    setEnrollmentMessage(
      `Approve code ${result.userCode} in the browser. This request expires at ${new Date(result.expiresAt).toLocaleTimeString()}.`,
    )
    scheduleEnrollmentPoll(result.intervalSeconds)
  }

  async function handleStartEnrollment() {
    setEnrollmentState('waiting')
    setEnrollmentMessage('Opening the Copyrade web app for approval...')
    const result = await window.copyrade.device.startEnrollment(deviceName)
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

    setEnrollmentMessage(
      `Approve code ${result.userCode} in the browser. This request expires at ${new Date(result.expiresAt).toLocaleTimeString()}.`,
    )
    scheduleEnrollmentPoll(result.intervalSeconds)
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
              <label htmlFor="device-name">Device name</label>
              <input
                id="device-name"
                value={deviceName}
                onChange={(event) => setDeviceName(event.target.value)}
                maxLength={64}
                disabled={enrollmentState === 'waiting'}
              />
              <button
                type="button"
                onClick={() => void handleStartEnrollment()}
                disabled={enrollmentState === 'loading' || enrollmentState === 'waiting'}
              >
                {enrollmentState === 'waiting' ? 'Waiting for approval...' : 'Register this PC'}
              </button>
            </>
          )}
          <p role={enrollmentState === 'error' ? 'alert' : 'status'}>
            {enrollmentMessage}
          </p>
        </section>

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
