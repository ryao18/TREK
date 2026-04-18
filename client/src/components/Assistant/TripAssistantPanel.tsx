import React, { useMemo, useState } from 'react'
import { MessageCircle, Minus, Send, Sparkles, X } from 'lucide-react'
import { tripsApi } from '../../api/client'

type AssistantPanelState = 'closed' | 'open' | 'minimized'

interface AssistantMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations?: Array<{ type: string; id?: number | string | null; label: string }>
  warnings?: string[]
  missing_data?: string[]
  followUpPrompts?: string[]
}

interface AssistantAvailabilityState {
  kind: 'not_configured' | 'offline' | 'error'
  title: string
  detail: string
}

interface TripAssistantPanelProps {
  tripId: number | string
  tripTitle: string
  selectedDayId: number | null
  selectedPlaceId: number | null
  selectedAssignmentId: number | null
  activeTab: string
}

const QUICK_PROMPTS = [
  'Summarize this trip',
  'What still needs planning?',
  'Which days are busiest?',
  'Who still needs to pack?',
  'Summarize our reservations',
]

const panelBaseStyle: React.CSSProperties = {
  position: 'absolute',
  top: 10,
  right: 10,
  bottom: 10,
  background: 'var(--sidebar-bg)',
  backdropFilter: 'blur(24px) saturate(180%)',
  WebkitBackdropFilter: 'blur(24px) saturate(180%)',
  boxShadow: 'var(--sidebar-shadow)',
  borderRadius: 18,
  border: '1px solid var(--border-faint)',
  overflow: 'hidden',
  zIndex: 35,
  display: 'flex',
  flexDirection: 'column',
}

export default function TripAssistantPanel({
  tripId,
  tripTitle,
  selectedDayId,
  selectedPlaceId,
  selectedAssignmentId,
  activeTab,
}: TripAssistantPanelProps): React.ReactElement {
  const [panelState, setPanelState] = useState<AssistantPanelState>(() => {
    try {
      return (sessionStorage.getItem(`trip-assistant-panel-${tripId}`) as AssistantPanelState) || 'closed'
    } catch {
      return 'closed'
    }
  })
  const [messages, setMessages] = useState<AssistantMessage[]>(() => {
    try {
      const raw = sessionStorage.getItem(`trip-assistant-messages-${tripId}`)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  })
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [availability, setAvailability] = useState<AssistantAvailabilityState | null>(null)
  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 768 : false

  React.useEffect(() => {
    try {
      sessionStorage.setItem(`trip-assistant-panel-${tripId}`, panelState)
    } catch {}
  }, [panelState, tripId])

  React.useEffect(() => {
    try {
      sessionStorage.setItem(`trip-assistant-messages-${tripId}`, JSON.stringify(messages.slice(-20)))
    } catch {}
  }, [messages, tripId])

  const shellStyle = useMemo<React.CSSProperties>(() => {
    if (isMobile) {
      return {
        ...panelBaseStyle,
        position: 'fixed',
        top: 'calc(var(--nav-h) + 44px)',
        right: 0,
        left: 0,
        bottom: 0,
        width: '100%',
        maxWidth: '100%',
        borderRadius: 0,
      }
    }
    return {
      ...panelBaseStyle,
      width: '66vw',
      maxWidth: 'min(860px, calc(100vw - 20px))',
      minWidth: 560,
    }
  }, [isMobile])

  const minimizedPanelStyle = useMemo<React.CSSProperties>(() => {
    if (isMobile) {
      return {
        ...panelBaseStyle,
        right: 12,
        left: 'auto',
        bottom: 12,
        top: 'auto',
        width: 220,
        minWidth: 220,
        maxWidth: 'calc(100vw - 24px)',
        height: 72,
        minHeight: 72,
      }
    }

    return {
      ...panelBaseStyle,
      width: 380,
      minWidth: 380,
      maxWidth: 380,
    }
  }, [isMobile])

  const closedButtonStyle = useMemo<React.CSSProperties>(() => {
    return {
      position: 'absolute',
      right: 12,
      bottom: isMobile ? 12 : 18,
      zIndex: 35,
      borderRadius: 14,
      border: 'none',
      padding: isMobile ? '12px 16px' : '11px 15px',
      background: '#000',
      color: '#fff',
      cursor: 'pointer',
      boxShadow: '0 10px 30px rgba(0,0,0,0.22)',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      fontFamily: 'inherit',
      fontSize: 14,
      fontWeight: 600,
    }
  }, [isMobile])

  async function sendMessage(raw: string) {
    const message = raw.trim()
    if (!message || isLoading) return

    const nextUserMessage: AssistantMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: message,
    }

    const history = messages.map((entry) => ({ role: entry.role, content: entry.content }))
    setMessages((current) => [...current, nextUserMessage])
    setInput('')
    setIsLoading(true)
    setAvailability(null)

    try {
      const response = await tripsApi.assistantQuery(tripId, {
        message,
        history,
        context: {
          selected_day_id: selectedDayId,
          selected_place_id: selectedPlaceId,
          selected_assignment_id: selectedAssignmentId,
          active_tab: activeTab,
        },
      })

      const assistantMessage: AssistantMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: response.message?.content || 'No response received.',
        citations: response.citations || [],
        warnings: response.warnings || [],
        missing_data: response.missing_data || [],
        followUpPrompts: response.follow_up_prompts || [],
      }
      setMessages((current) => [...current, assistantMessage])
    } catch (err: any) {
      const status = err?.response?.status
      const responseError = err?.response?.data?.error
      const messageText = typeof responseError === 'string' ? responseError : (err?.message || 'Assistant request failed.')
      const nextAvailability = getAvailabilityState(status, messageText)
      setAvailability(nextAvailability)
      setMessages((current) => [
        ...current,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: nextAvailability.detail,
          warnings: [nextAvailability.title],
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  if (panelState === 'closed') {
    return (
      <button
        onClick={() => setPanelState('open')}
        title="Open AI assistant"
        style={closedButtonStyle}
      >
        <Sparkles size={16} />
        Assistant
      </button>
    )
  }

  if (panelState === 'minimized') {
  }

  return (
    <div style={panelState === 'minimized' ? minimizedPanelStyle : shellStyle}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-faint)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-primary)', fontSize: 14, fontWeight: 700 }}>
            <Sparkles size={15} />
            AI Assistant
          </div>
          <div style={{ marginTop: 3, color: 'var(--text-muted)', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {tripTitle}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {panelState === 'minimized'
            ? (
              <button onClick={() => setPanelState('open')} title="Expand" style={iconButtonStyle}>
                <Sparkles size={15} />
              </button>
            )
            : (
              <button onClick={() => setPanelState('minimized')} title="Minimize" style={iconButtonStyle}>
                <Minus size={15} />
              </button>
            )}
          <button onClick={() => setPanelState('closed')} title="Close" style={iconButtonStyle}>
            <X size={15} />
          </button>
        </div>
      </div>

      <div style={{ padding: '12px 16px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {messages.length === 0 && QUICK_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            onClick={() => sendMessage(prompt)}
            style={{
              border: '1px solid var(--border-faint)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              borderRadius: 999,
              padding: '8px 12px',
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {prompt}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 && (
          <div style={{ marginTop: 12, padding: 14, borderRadius: 14, background: 'var(--bg-secondary)', color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5 }}>
            Ask about itinerary gaps, busy days, reservations, packing progress, or trip prep.
          </div>
        )}

        {availability && messages.length === 0 && (
          <div style={{ marginTop: 12, padding: 14, borderRadius: 14, background: 'var(--bg-secondary)', border: '1px solid var(--border-faint)' }}>
            <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              {availability.title}
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.5 }}>
              {availability.detail}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} style={{ alignSelf: message.role === 'user' ? 'flex-end' : 'stretch', maxWidth: '100%' }}>
            <div
              style={{
                background: message.role === 'user' ? '#000' : 'var(--bg-secondary)',
                color: message.role === 'user' ? '#fff' : 'var(--text-primary)',
                borderRadius: 16,
                padding: '12px 14px',
                fontSize: 13,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
              }}
            >
              {message.content}
            </div>
            {message.citations && message.citations.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {message.citations.map((citation, index) => (
                  <span key={`${citation.type}-${citation.id}-${index}`} style={pillStyle}>
                    {citation.label}
                  </span>
                ))}
              </div>
            )}
            {message.warnings && message.warnings.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {message.warnings.map((warning, index) => (
                  <div key={index} style={{ color: '#b45309', fontSize: 12, lineHeight: 1.4 }}>
                    {warning}
                  </div>
                ))}
              </div>
            )}
            {message.missing_data && message.missing_data.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {message.missing_data.map((warning, index) => (
                  <div key={index} style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.4 }}>
                    {warning}
                  </div>
                ))}
              </div>
            )}
            {message.followUpPrompts && message.followUpPrompts.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                {message.followUpPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => sendMessage(prompt)}
                    style={{
                      border: '1px solid var(--border-faint)',
                      background: 'transparent',
                      color: 'var(--text-secondary)',
                      borderRadius: 999,
                      padding: '6px 10px',
                      fontSize: 11,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div style={{ alignSelf: 'flex-start', borderRadius: 16, padding: '12px 14px', background: 'var(--bg-secondary)', color: 'var(--text-muted)', fontSize: 13 }}>
            Thinking...
          </div>
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          sendMessage(input)
        }}
        style={{ padding: 16, borderTop: '1px solid var(--border-faint)', display: 'flex', alignItems: 'flex-end', gap: 10 }}
      >
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              sendMessage(input)
            }
          }}
          placeholder="Ask about this trip..."
          rows={2}
          disabled={isLoading}
          style={{
            flex: 1,
            resize: 'none',
            borderRadius: 14,
            border: '1px solid var(--border-faint)',
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            padding: '12px 14px',
            fontFamily: 'inherit',
            fontSize: 13,
            lineHeight: 1.4,
            outline: 'none',
            opacity: isLoading ? 0.7 : 1,
          }}
        />
        <button
          type="submit"
          disabled={!input.trim() || isLoading}
          style={{
            border: 'none',
            width: 42,
            height: 42,
            borderRadius: 14,
            background: !input.trim() || isLoading ? 'var(--bg-hover)' : '#000',
            color: !input.trim() || isLoading ? 'var(--text-muted)' : '#fff',
            cursor: !input.trim() || isLoading ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Send size={15} />
        </button>
      </form>
    </div>
  )
}

const iconButtonStyle: React.CSSProperties = {
  border: '1px solid var(--border-faint)',
  width: 32,
  height: 32,
  borderRadius: 10,
  background: 'transparent',
  color: 'var(--text-secondary)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
}

const pillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '4px 8px',
  borderRadius: 999,
  background: 'var(--bg-tertiary)',
  color: 'var(--text-secondary)',
  fontSize: 11,
  border: '1px solid var(--border-faint)',
}

function getAvailabilityState(status: number | undefined, message: string): AssistantAvailabilityState {
  if (status === 503 || /not configured/i.test(message)) {
    return {
      kind: 'not_configured',
      title: 'Local assistant is not configured',
      detail: 'Set the local assistant model in the server environment, then try again.',
    }
  }

  if (status === 502 || /failed to fetch|network error|request failed|empty response|127\.0\.0\.1:1234|local assistant/i.test(message)) {
    return {
      kind: 'offline',
      title: 'Local model is not reachable',
      detail: 'LM Studio is probably not running, the local server is not enabled, or the base URL/model does not match the current LM Studio session.',
    }
  }

  return {
    kind: 'error',
    title: 'Assistant unavailable',
    detail: 'The assistant could not complete this request. Check the local model connection and try again.',
  }
}
