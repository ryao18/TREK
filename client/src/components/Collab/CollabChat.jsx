import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Send, Trash2, Reply, ChevronUp, MessageCircle } from 'lucide-react'
import { collabApi } from '../../api/client'
import { addListener, removeListener } from '../../api/websocket'
import { useTranslation } from '../../i18n'

/* ───────── relative timestamp ───────── */
function formatRelativeTime(isoString, t) {
  const now = Date.now()
  const then = new Date(isoString).getTime()
  const diff = now - then

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours   = Math.floor(minutes / 60)

  if (seconds < 60) return t('collab.chat.justNow')
  if (minutes < 60) return t('collab.chat.minutesAgo', { n: minutes })
  if (hours   < 24) return t('collab.chat.hoursAgo', { n: hours })

  const d = new Date(isoString)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)

  if (
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear()
  ) {
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `yesterday ${hh}:${mm}`
  }

  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${monthNames[d.getMonth()]} ${d.getDate()}`
}

/* ─────────────────────────────────────── */
/*               Component                 */
/* ─────────────────────────────────────── */
export default function CollabChat({ tripId, currentUser }) {
  const { t } = useTranslation()

  const [messages, setMessages]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [hasMore, setHasMore]       = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [text, setText]             = useState('')
  const [replyTo, setReplyTo]       = useState(null)
  const [hoveredId, setHoveredId]   = useState(null)
  const [sending, setSending]       = useState(false)

  const scrollRef   = useRef(null)
  const textareaRef = useRef(null)
  const isAtBottom  = useRef(true)

  /* ── scroll helpers ── */
  const scrollToBottom = useCallback((behavior = 'auto') => {
    const el = scrollRef.current
    if (!el) return
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior })
    })
  }, [])

  const checkAtBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    isAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }, [])

  /* ── load messages ── */
  useEffect(() => {
    let cancelled = false
    setLoading(true)

    collabApi.getMessages(tripId).then(data => {
      if (cancelled) return
      const msgs = Array.isArray(data) ? data : data.messages || []
      setMessages(msgs)
      setHasMore(msgs.length >= 100)
      setLoading(false)
      setTimeout(() => scrollToBottom(), 30)
    }).catch(() => {
      if (!cancelled) setLoading(false)
    })

    return () => { cancelled = true }
  }, [tripId, scrollToBottom])

  /* ── load more (older messages) ── */
  const handleLoadMore = useCallback(async () => {
    if (loadingMore || messages.length === 0) return
    setLoadingMore(true)
    const el = scrollRef.current
    const prevHeight = el ? el.scrollHeight : 0

    try {
      const oldestId = messages[0]?.id
      const data = await collabApi.getMessages(tripId, oldestId)
      const older = Array.isArray(data) ? data : data.messages || []

      if (older.length === 0) {
        setHasMore(false)
      } else {
        setMessages(prev => [...older, ...prev])
        setHasMore(older.length >= 100)
        requestAnimationFrame(() => {
          if (el) el.scrollTop = el.scrollHeight - prevHeight
        })
      }
    } catch {
      // silently ignore
    } finally {
      setLoadingMore(false)
    }
  }, [tripId, loadingMore, messages])

  /* ── websocket ── */
  useEffect(() => {
    const handler = (event) => {
      if (event.type === 'collab:message:created' && String(event.tripId) === String(tripId)) {
        setMessages(prev => {
          if (prev.some(m => m.id === event.message.id)) return prev
          return [...prev, event.message]
        })
        if (isAtBottom.current) {
          setTimeout(() => scrollToBottom('smooth'), 30)
        }
      }
      if (event.type === 'collab:message:deleted' && String(event.tripId) === String(tripId)) {
        setMessages(prev => prev.filter(m => m.id !== event.messageId))
      }
    }

    addListener(handler)
    return () => removeListener(handler)
  }, [tripId, scrollToBottom])

  /* ── auto-resize textarea ── */
  const handleTextChange = useCallback((e) => {
    setText(e.target.value)
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = Math.min(ta.scrollHeight, 3 * 20 + 18) + 'px'
    }
  }, [])

  /* ── send ── */
  const handleSend = useCallback(async () => {
    const body = text.trim()
    if (!body || sending) return

    setSending(true)
    try {
      const payload = { text: body }
      if (replyTo) payload.reply_to = replyTo.id
      const data = await collabApi.sendMessage(tripId, payload)
      if (data?.message) {
        setMessages(prev => {
          if (prev.some(m => m.id === data.message.id)) return prev
          return [...prev, data.message]
        })
      }
      setText('')
      setReplyTo(null)
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
      scrollToBottom('smooth')
    } catch {
      // keep text on failure so user can retry
    } finally {
      setSending(false)
    }
  }, [text, sending, replyTo, tripId, scrollToBottom])

  /* ── keyboard ── */
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  /* ── delete ── */
  const handleDelete = useCallback(async (msgId) => {
    try {
      await collabApi.deleteMessage(tripId, msgId)
    } catch {
      // ignore
    }
  }, [tripId])

  /* ── find a replied-to message ── */
  const findMessage = useCallback((id) => messages.find(m => m.id === id), [messages])

  /* ── helpers ── */
  const isOwn = (msg) => String(msg.user_id) === String(currentUser.id)

  const font = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif"

  /* ───────── render: loading ───────── */
  if (loading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        fontFamily: font,
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          color: 'var(--text-faint)',
          userSelect: 'none',
          padding: 32,
        }}>
          <div style={{
            width: 24,
            height: 24,
            border: '2px solid var(--border-faint)',
            borderTopColor: 'var(--accent)',
            borderRadius: '50%',
            animation: 'spin .7s linear infinite',
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      </div>
    )
  }

  /* ───────── render: main ───────── */
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      fontFamily: font,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* ── messages area ── */}
      {messages.length === 0 ? (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          color: 'var(--text-faint)',
          userSelect: 'none',
          padding: 32,
        }}>
          <MessageCircle size={36} strokeWidth={1.3} style={{ opacity: 0.5 }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-faint)' }}>
            {t('collab.chat.empty')}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-faint)', opacity: 0.7 }}>
            {t('collab.chat.emptyDesc') || ''}
          </span>
        </div>
      ) : (
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '12px 16px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
          onScroll={checkAtBottom}
        >
          {/* load more */}
          {hasMore && (
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              padding: '4px 0 8px',
            }}>
              <button
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-faint)',
                  borderRadius: 99,
                  padding: '5px 14px',
                  cursor: 'pointer',
                  fontFamily: font,
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                }}
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                <ChevronUp size={13} />
                {loadingMore ? '...' : t('collab.chat.loadMore')}
              </button>
            </div>
          )}

          {messages.map((msg, idx) => {
            const own = isOwn(msg)
            const repliedMsg = msg.reply_to_id ? findMessage(msg.reply_to_id) : null
            const prevMsg = messages[idx - 1]
            const isNewGroup = idx === 0 || String(prevMsg?.user_id) !== String(msg.user_id)
            const showHeader = !own && isNewGroup

            return (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: own ? 'flex-end' : 'flex-start',
                  marginTop: isNewGroup ? 12 : 0,
                }}
              >
                {/* username + avatar for others */}
                {showHeader && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginBottom: 4,
                    paddingLeft: 2,
                  }}>
                    {msg.user_avatar ? (
                      <img
                        src={msg.user_avatar}
                        alt=""
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: '50%',
                          objectFit: 'cover',
                          flexShrink: 0,
                        }}
                      />
                    ) : (
                      <span style={{
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 9,
                        fontWeight: 700,
                        color: 'var(--text-primary)',
                        background: 'var(--bg-tertiary)',
                        flexShrink: 0,
                        lineHeight: 1,
                      }}>
                        {(msg.username || '?')[0].toUpperCase()}
                      </span>
                    )}
                    <span style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: 'var(--text-faint)',
                      lineHeight: 1,
                    }}>
                      {msg.username}
                    </span>
                  </div>
                )}

                {/* reply quote */}
                {repliedMsg && (
                  <div style={{
                    padding: '6px 10px',
                    borderLeft: '2px solid var(--accent)',
                    background: 'var(--bg-secondary)',
                    borderRadius: 6,
                    fontSize: 11,
                    lineHeight: 1.35,
                    marginBottom: 4,
                    maxWidth: '75%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: 'var(--text-muted)',
                    alignSelf: own ? 'flex-end' : 'flex-start',
                  }}>
                    <strong style={{ fontWeight: 600 }}>{repliedMsg.username}: </strong>
                    {(repliedMsg.text || '').slice(0, 80)}
                    {(repliedMsg.text || '').length > 80 ? '...' : ''}
                  </div>
                )}

                {/* bubble with hover actions */}
                <div
                  style={{ position: 'relative', maxWidth: '75%' }}
                  onMouseEnter={() => setHoveredId(msg.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <div style={{
                    background: own ? 'var(--accent)' : 'var(--bg-secondary)',
                    color: own ? 'var(--accent-text)' : 'var(--text-primary)',
                    borderRadius: own ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                    padding: '8px 12px',
                    fontSize: 13,
                    lineHeight: 1.45,
                    wordBreak: 'break-word',
                    whiteSpace: 'pre-wrap',
                  }}>
                    {msg.text}
                  </div>

                  {/* action buttons */}
                  <div style={{
                    position: 'absolute',
                    top: -10,
                    display: 'flex',
                    gap: 2,
                    opacity: hoveredId === msg.id ? 1 : 0,
                    pointerEvents: hoveredId === msg.id ? 'auto' : 'none',
                    transition: 'opacity .12s ease',
                    ...(own ? { right: 4 } : { left: 4 }),
                  }}>
                    <button
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        border: '1px solid var(--border-faint)',
                        background: 'var(--bg-card)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        color: 'var(--text-muted)',
                        padding: 0,
                        flexShrink: 0,
                      }}
                      title="Reply"
                      onClick={() => setReplyTo(msg)}
                    >
                      <Reply size={11} />
                    </button>
                    {own && (
                      <button
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: '50%',
                          border: '1px solid var(--border-faint)',
                          background: 'var(--bg-card)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          color: 'var(--text-muted)',
                          padding: 0,
                          flexShrink: 0,
                        }}
                        title="Delete"
                        onClick={() => handleDelete(msg.id)}
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                </div>

                {/* timestamp */}
                <span style={{
                  fontSize: 9,
                  color: 'var(--text-faint)',
                  marginTop: 2,
                  paddingLeft: 2,
                  paddingRight: 2,
                  lineHeight: 1,
                }}>
                  {formatRelativeTime(msg.created_at, t)}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* ── composer ── */}
      <div style={{
        flexShrink: 0,
        padding: 12,
        borderTop: '1px solid var(--border-faint)',
        background: 'var(--bg-card)',
      }}>
        {/* reply preview */}
        {replyTo && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 8,
            padding: '6px 10px',
            borderRadius: 6,
            background: 'var(--bg-secondary)',
            borderLeft: '2px solid var(--accent)',
            fontSize: 12,
            color: 'var(--text-muted)',
            lineHeight: 1.3,
          }}>
            <Reply size={13} style={{ flexShrink: 0, opacity: 0.6 }} />
            <span style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              <strong>{replyTo.username}</strong>: {(replyTo.text || '').slice(0, 60)}
              {(replyTo.text || '').length > 60 ? '...' : ''}
            </span>
            <span
              style={{
                marginLeft: 'auto',
                cursor: 'pointer',
                color: 'var(--text-faint)',
                fontSize: 16,
                fontWeight: 400,
                lineHeight: 1,
                padding: '0 2px',
                flexShrink: 0,
              }}
              onClick={() => setReplyTo(null)}
            >
              &times;
            </span>
          </div>
        )}

        <div style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 8,
        }}>
          <textarea
            ref={textareaRef}
            rows={1}
            style={{
              flex: 1,
              resize: 'none',
              border: '1px solid var(--border-primary)',
              borderRadius: 10,
              padding: '8px 12px',
              fontSize: 13,
              lineHeight: 1.4,
              fontFamily: font,
              background: 'var(--bg-input)',
              color: 'var(--text-primary)',
              outline: 'none',
              maxHeight: 3 * 20 + 18,
              overflow: 'auto',
              transition: 'border-color .15s ease',
            }}
            placeholder={t('collab.chat.placeholder')}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (textareaRef.current) {
                textareaRef.current.style.borderColor = 'var(--accent)'
              }
            }}
            onBlur={() => {
              if (textareaRef.current) {
                textareaRef.current.style.borderColor = 'var(--border-primary)'
              }
            }}
          />
          <button
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: 'none',
              background: 'var(--accent)',
              color: 'var(--accent-text)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: (!text.trim() || sending) ? 'default' : 'pointer',
              flexShrink: 0,
              opacity: (!text.trim() || sending) ? 0.4 : 1,
              transition: 'opacity .15s ease',
            }}
            onClick={handleSend}
            disabled={!text.trim() || sending}
          >
            <Send size={14} style={{ marginLeft: 1 }} />
          </button>
        </div>
      </div>
    </div>
  )
}
