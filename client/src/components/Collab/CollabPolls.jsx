import React, { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, X, Check, BarChart3, Lock, Clock } from 'lucide-react'
import { collabApi } from '../../api/client'
import { addListener, removeListener } from '../../api/websocket'
import { useTranslation } from '../../i18n'

// ── Constants ────────────────────────────────────────────────────────────────

const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif"

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeRemaining(deadline) {
  if (!deadline) return null
  const diff = new Date(deadline).getTime() - Date.now()
  if (diff <= 0) return null
  const mins = Math.floor(diff / 60000)
  const hrs = Math.floor(mins / 60)
  const days = Math.floor(hrs / 24)
  if (days > 0) return `${days}d ${hrs % 24}h`
  if (hrs > 0) return `${hrs}h ${mins % 60}m`
  return `${mins}m`
}

function isExpired(deadline) {
  if (!deadline) return false
  return new Date(deadline).getTime() <= Date.now()
}

function totalVotes(poll) {
  if (!poll.options) return 0
  return poll.options.reduce((s, o) => s + (o.voters?.length || 0), 0)
}

// ── Voter Avatars ────────────────────────────────────────────────────────────

function VoterAvatars({ voters = [] }) {
  const MAX = 4
  const shown = voters.slice(0, MAX)
  const extra = voters.length - MAX

  if (!voters.length) return null

  return (
    <div style={{ display: 'flex', alignItems: 'center', marginTop: 3, minHeight: 14 }}>
      {shown.map((v, i) => (
        <div
          key={v.id || i}
          title={v.username}
          style={{
            width: 14,
            height: 14,
            borderRadius: '50%',
            border: '1.5px solid var(--bg-primary)',
            marginLeft: i === 0 ? 0 : -4,
            overflow: 'hidden',
            background: 'var(--bg-tertiary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 7,
            fontWeight: 700,
            fontFamily: FONT,
            color: 'var(--text-secondary)',
            flexShrink: 0,
            zIndex: MAX - i,
            position: 'relative',
          }}
        >
          {v.avatar ? (
            <img
              src={v.avatar}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            (v.username || '?')[0].toUpperCase()
          )}
        </div>
      ))}
      {extra > 0 && (
        <span
          style={{
            fontSize: 9,
            fontFamily: FONT,
            color: 'var(--text-faint)',
            marginLeft: 3,
            fontWeight: 600,
          }}
        >
          +{extra}
        </span>
      )}
    </div>
  )
}

// ── Option Bar ───────────────────────────────────────────────────────────────

function OptionBar({ option, index, poll, currentUser, onVote, isClosed }) {
  const total = totalVotes(poll)
  const count = option.voters?.length || 0
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  const voted = option.voters?.some((v) => v.id === currentUser.id)
  const canVote = !isClosed && !poll.is_closed

  return (
    <div
      onClick={() => canVote && onVote(poll.id, index)}
      style={{
        position: 'relative',
        width: '100%',
        padding: '8px 12px',
        borderRadius: 8,
        border: voted
          ? '1px solid var(--accent)'
          : '1px solid var(--border-faint)',
        overflow: 'hidden',
        cursor: canVote ? 'pointer' : 'default',
        marginTop: 4,
        boxSizing: 'border-box',
        fontFamily: FONT,
      }}
      onMouseEnter={(e) => {
        if (canVote) e.currentTarget.style.borderColor = 'var(--accent)'
      }}
      onMouseLeave={(e) => {
        if (canVote && !voted)
          e.currentTarget.style.borderColor = 'var(--border-faint)'
      }}
    >
      {/* Vote fill bar */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: `${pct}%`,
          background: 'var(--accent)',
          opacity: voted ? 0.15 : 0.1,
          transition: 'width 0.3s',
          pointerEvents: 'none',
        }}
      />

      {/* Content row */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
          {voted && (
            <Check
              size={12}
              style={{ color: 'var(--accent)', flexShrink: 0 }}
              strokeWidth={2.5}
            />
          )}
          <span
            style={{
              fontSize: 12,
              fontWeight: voted ? 600 : 400,
              color: 'var(--text-primary)',
              fontFamily: FONT,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {option.text}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              fontFamily: FONT,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {count}
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-primary)',
              fontFamily: FONT,
              fontVariantNumeric: 'tabular-nums',
              minWidth: 28,
              textAlign: 'right',
            }}
          >
            {pct}%
          </span>
        </div>
      </div>

      {/* Voter avatars */}
      {option.voters?.length > 0 && (
        <div style={{ position: 'relative', zIndex: 1 }}>
          <VoterAvatars voters={option.voters} />
        </div>
      )}
    </div>
  )
}

// ── Create Poll Form ─────────────────────────────────────────────────────────

function CreatePollForm({ onSubmit, onCancel, t }) {
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [multipleChoice, setMultipleChoice] = useState(false)
  const [deadline, setDeadline] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const canSubmit =
    question.trim().length > 0 &&
    options.filter((o) => o.trim()).length >= 2 &&
    !submitting

  const addOption = () => setOptions((prev) => [...prev, ''])

  const removeOption = (i) => {
    if (options.length <= 2) return
    setOptions((prev) => prev.filter((_, idx) => idx !== i))
  }

  const updateOption = (i, val) =>
    setOptions((prev) => prev.map((o, idx) => (idx === i ? val : o)))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await onSubmit({
        question: question.trim(),
        options: options.filter((o) => o.trim()).map((o) => o.trim()),
        multiple_choice: multipleChoice,
        deadline: deadline || undefined,
      })
      setQuestion('')
      setOptions(['', ''])
      setMultipleChoice(false)
      setDeadline('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        background: 'var(--bg-secondary)',
        borderRadius: 10,
        padding: 12,
        marginBottom: 8,
        fontFamily: FONT,
      }}
    >
      {/* Question */}
      <input
        type="text"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder={t('collab.polls.question')}
        style={{
          width: '100%',
          border: '1px solid var(--border-primary)',
          borderRadius: 10,
          padding: '8px 12px',
          fontSize: 13,
          background: 'var(--bg-input)',
          color: 'var(--text-primary)',
          fontFamily: 'inherit',
          outline: 'none',
          boxSizing: 'border-box',
        }}
        onFocus={(e) => (e.target.style.borderColor = 'var(--accent)')}
        onBlur={(e) => (e.target.style.borderColor = 'var(--border-primary)')}
        autoFocus
      />

      {/* Options */}
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {options.map((opt, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="text"
              value={opt}
              onChange={(e) => updateOption(i, e.target.value)}
              placeholder={`${t('collab.polls.addOption').replace('+', '').trim()} ${i + 1}`}
              style={{
                flex: 1,
                border: '1px solid var(--border-primary)',
                borderRadius: 10,
                padding: '8px 12px',
                fontSize: 13,
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontFamily: 'inherit',
                outline: 'none',
                boxSizing: 'border-box',
              }}
              onFocus={(e) => (e.target.style.borderColor = 'var(--accent)')}
              onBlur={(e) => (e.target.style.borderColor = 'var(--border-primary)')}
            />
            {options.length > 2 && (
              <button
                type="button"
                onClick={() => removeOption(i)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 4,
                  color: 'var(--text-faint)',
                  display: 'flex',
                  alignItems: 'center',
                  fontFamily: FONT,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--danger, #ef4444)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-faint)')}
              >
                <X size={13} />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* + Add option link */}
      <div
        onClick={addOption}
        style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          cursor: 'pointer',
          fontFamily: FONT,
          padding: '6px 0 2px',
          display: 'flex',
          alignItems: 'center',
          gap: 3,
        }}
      >
        <Plus size={11} />
        {t('collab.polls.addOption')}
      </div>

      {/* Settings row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          marginTop: 10,
          flexWrap: 'wrap',
        }}
      >
        {/* Multiple choice toggle */}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            userSelect: 'none',
            fontFamily: FONT,
          }}
        >
          <div
            onClick={() => setMultipleChoice(!multipleChoice)}
            style={{
              width: 14,
              height: 14,
              borderRadius: 4,
              border: multipleChoice
                ? '1px solid var(--accent)'
                : '1px solid var(--border-primary)',
              background: multipleChoice ? 'var(--accent)' : 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            {multipleChoice && <Check size={9} style={{ color: '#fff' }} strokeWidth={3} />}
          </div>
          {t('collab.polls.multipleChoice')}
        </label>

        {/* Deadline */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Clock size={12} style={{ color: 'var(--text-faint)' }} />
          <input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            style={{
              border: '1px solid var(--border-primary)',
              borderRadius: 10,
              padding: '8px 12px',
              fontSize: 13,
              background: 'var(--bg-input)',
              color: 'var(--text-primary)',
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />
        </div>
      </div>

      {/* Actions */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 8,
          marginTop: 12,
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          style={{
            background: 'none',
            border: '1px solid var(--border-primary)',
            borderRadius: 99,
            padding: '5px 14px',
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontFamily: FONT,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-tertiary)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
        >
          {t('common.cancel', 'Cancel')}
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            background: canSubmit ? 'var(--accent)' : 'var(--bg-tertiary)',
            border: 'none',
            borderRadius: 99,
            padding: '5px 14px',
            fontSize: 12,
            fontWeight: 600,
            color: canSubmit ? '#fff' : 'var(--text-faint)',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            fontFamily: FONT,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
          onMouseEnter={(e) => {
            if (canSubmit) e.currentTarget.style.opacity = '0.85'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '1'
          }}
        >
          <BarChart3 size={12} />
          {t('collab.polls.create')}
        </button>
      </div>
    </form>
  )
}

// ── Poll Card ────────────────────────────────────────────────────────────────

function PollCard({ poll, currentUser, onVote, onClose, onDelete, t }) {
  const isCreator = poll.created_by?.id === currentUser.id
  const isClosed = poll.is_closed || isExpired(poll.deadline)
  const remaining = timeRemaining(poll.deadline)
  const total = totalVotes(poll)

  return (
    <div
      style={{
        borderRadius: 10,
        border: '1px solid var(--border-faint)',
        padding: 12,
        background: 'var(--bg-card)',
        opacity: isClosed ? 0.6 : 1,
        fontFamily: FONT,
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Question */}
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-primary)',
              fontFamily: FONT,
              lineHeight: 1.35,
              wordBreak: 'break-word',
              margin: 0,
            }}
          >
            {poll.question}
          </div>

          {/* Meta line */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 3,
              flexWrap: 'wrap',
            }}
          >
            {/* by username */}
            <span
              style={{
                fontSize: 10,
                color: 'var(--text-faint)',
                fontFamily: FONT,
              }}
            >
              by {poll.created_by?.username || '?'}
            </span>

            {/* Vote count */}
            <span
              style={{
                fontSize: 10,
                color: 'var(--text-faint)',
                fontFamily: FONT,
                display: 'flex',
                alignItems: 'center',
                gap: 3,
              }}
            >
              <BarChart3 size={9} />
              {total} {t('collab.polls.votes')}
            </span>

            {/* Multiple choice badge */}
            {poll.multiple_choice && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  color: 'var(--accent)',
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: 'var(--bg-tertiary)',
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                  fontFamily: FONT,
                }}
              >
                {t('collab.polls.multipleChoice')}
              </span>
            )}

            {/* Closed badge */}
            {isClosed && (
              <span
                style={{
                  fontSize: 9,
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-faint)',
                  fontWeight: 600,
                  fontFamily: FONT,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                }}
              >
                <Lock size={8} />
                {t('collab.polls.closed')}
              </span>
            )}

            {/* Deadline countdown */}
            {!isClosed && remaining && (
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--text-faint)',
                  fontFamily: FONT,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                }}
              >
                <Clock size={9} />
                {remaining}
              </span>
            )}
          </div>
        </div>

        {/* Creator actions: close / delete */}
        {isCreator && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            {!isClosed && (
              <button
                onClick={() => onClose(poll.id)}
                title={t('collab.polls.close')}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 4,
                  color: 'var(--text-faint)',
                  fontSize: 10,
                  fontFamily: FONT,
                  display: 'flex',
                  alignItems: 'center',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-faint)')}
              >
                <Lock size={12} />
              </button>
            )}
            <button
              onClick={() => onDelete(poll.id)}
              title={t('common.delete', 'Delete')}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 4,
                color: 'var(--text-faint)',
                fontSize: 10,
                fontFamily: FONT,
                display: 'flex',
                alignItems: 'center',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--danger, #ef4444)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-faint)')}
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>

      {/* Options */}
      <div>
        {poll.options?.map((opt, i) => (
          <OptionBar
            key={i}
            option={opt}
            index={i}
            poll={poll}
            currentUser={currentUser}
            onVote={onVote}
            isClosed={isClosed}
          />
        ))}
      </div>
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────

function CollabPolls({ tripId, currentUser }) {
  const { t } = useTranslation()
  const [polls, setPolls] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  // ── Load polls ──
  const loadPolls = useCallback(async () => {
    try {
      const data = await collabApi.getPolls(tripId)
      setPolls(Array.isArray(data) ? data : data.polls || [])
    } catch (err) {
      console.error('Failed to load polls:', err)
    } finally {
      setLoading(false)
    }
  }, [tripId])

  useEffect(() => {
    loadPolls()
  }, [loadPolls])

  // ── WebSocket ──
  useEffect(() => {
    const handler = (msg) => {
      if (!msg || !msg.type) return

      if (msg.type === 'collab:poll:created' && msg.poll) {
        setPolls((prev) => {
          if (prev.some((p) => p.id === msg.poll.id)) return prev
          return [msg.poll, ...prev]
        })
      }

      if (msg.type === 'collab:poll:voted' && msg.poll) {
        setPolls((prev) =>
          prev.map((p) => (p.id === msg.poll.id ? msg.poll : p))
        )
      }

      if (msg.type === 'collab:poll:closed' && msg.poll) {
        setPolls((prev) =>
          prev.map((p) => (p.id === msg.poll.id ? { ...p, ...msg.poll, is_closed: true } : p))
        )
      }

      if (msg.type === 'collab:poll:deleted') {
        const deletedId = msg.pollId || msg.poll?.id || msg.id
        if (deletedId) {
          setPolls((prev) => prev.filter((p) => p.id !== deletedId))
        }
      }
    }

    addListener(handler)
    return () => removeListener(handler)
  }, [])

  // ── Actions ──
  const handleCreate = useCallback(
    async (data) => {
      const result = await collabApi.createPoll(tripId, data)
      const created = result.poll || result
      setPolls((prev) => {
        if (prev.some((p) => p.id === created.id)) return prev
        return [created, ...prev]
      })
      setShowForm(false)
    },
    [tripId]
  )

  const handleVote = useCallback(
    async (pollId, optionIndex) => {
      try {
        const result = await collabApi.votePoll(tripId, pollId, optionIndex)
        const updated = result.poll || result
        setPolls((prev) =>
          prev.map((p) => (p.id === updated.id ? updated : p))
        )
      } catch (err) {
        console.error('Vote failed:', err)
      }
    },
    [tripId]
  )

  const handleClose = useCallback(
    async (pollId) => {
      try {
        await collabApi.closePoll(tripId, pollId)
        setPolls((prev) =>
          prev.map((p) => (p.id === pollId ? { ...p, is_closed: true } : p))
        )
      } catch (err) {
        console.error('Close poll failed:', err)
      }
    },
    [tripId]
  )

  const handleDelete = useCallback(
    async (pollId) => {
      try {
        await collabApi.deletePoll(tripId, pollId)
        setPolls((prev) => prev.filter((p) => p.id !== pollId))
      } catch (err) {
        console.error('Delete poll failed:', err)
      }
    },
    [tripId]
  )

  // ── Separate active / closed ──
  const activePolls = polls.filter(
    (p) => !p.is_closed && !isExpired(p.deadline)
  )
  const closedPolls = polls.filter(
    (p) => p.is_closed || isExpired(p.deadline)
  )

  // ── Deadline countdown ticker ──
  const [, setTick] = useState(0)
  useEffect(() => {
    const hasDeadlines = polls.some((p) => p.deadline && !p.is_closed)
    if (!hasDeadlines) return
    const iv = setInterval(() => setTick((t) => t + 1), 30000)
    return () => clearInterval(iv)
  }, [polls])

  // ── Render ──
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: FONT,
      }}
    >
      {/* Header — fixed */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-faint)',
          flexShrink: 0,
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 700,
            color: 'var(--text-primary)',
            fontFamily: FONT,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <BarChart3 size={14} style={{ color: 'var(--accent)' }} />
          {t('collab.polls.title')}
        </h3>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            style={{
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 99,
              padding: '4px 12px',
              fontSize: 11,
              fontWeight: 600,
              color: '#fff',
              cursor: 'pointer',
              fontFamily: FONT,
              display: 'flex',
              alignItems: 'center',
              gap: 3,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
          >
            <Plus size={11} />
            {t('collab.polls.new')}
          </button>
        )}
      </div>

      {/* Content — scrollable */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 12,
        }}
      >
        {/* Create form */}
        {showForm && (
          <CreatePollForm
            onSubmit={handleCreate}
            onCancel={() => setShowForm(false)}
            t={t}
          />
        )}

        {/* Loading */}
        {loading && (
          <div
            style={{
              textAlign: 'center',
              padding: '32px 0',
              color: 'var(--text-faint)',
              fontSize: 12,
              fontFamily: FONT,
            }}
          >
            ...
          </div>
        )}

        {/* Empty state */}
        {!loading && polls.length === 0 && !showForm && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '40px 16px',
              textAlign: 'center',
            }}
          >
            <BarChart3
              size={36}
              style={{
                color: 'var(--text-faint)',
                marginBottom: 10,
              }}
            />
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--text-primary)',
                fontFamily: FONT,
                marginBottom: 4,
              }}
            >
              {t('collab.polls.empty')}
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-faint)',
                fontFamily: FONT,
              }}
            >
              {t('collab.polls.emptyDesc', 'Create a poll to get started')}
            </div>
          </div>
        )}

        {/* Active polls */}
        {!loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activePolls.map((poll) => (
              <PollCard
                key={poll.id}
                poll={poll}
                currentUser={currentUser}
                onVote={handleVote}
                onClose={handleClose}
                onDelete={handleDelete}
                t={t}
              />
            ))}
          </div>
        )}

        {/* Closed polls divider + section */}
        {!loading && closedPolls.length > 0 && (
          <>
            {activePolls.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  margin: '12px 0 8px',
                }}
              >
                <div
                  style={{
                    flex: 1,
                    height: 1,
                    background: 'var(--border-faint)',
                  }}
                />
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    color: 'var(--text-faint)',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    fontFamily: FONT,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Lock size={9} />
                  {t('collab.polls.closed')}
                </span>
                <div
                  style={{
                    flex: 1,
                    height: 1,
                    background: 'var(--border-faint)',
                  }}
                />
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {closedPolls.map((poll) => (
                <PollCard
                  key={poll.id}
                  poll={poll}
                  currentUser={currentUser}
                  onVote={handleVote}
                  onClose={handleClose}
                  onDelete={handleDelete}
                  t={t}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default CollabPolls
