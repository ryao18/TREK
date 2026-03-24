import React, { useState, useEffect, useCallback } from 'react'
import ReactDOM from 'react-dom'
import { Plus, Trash2, Pin, PinOff, Pencil, X, Check } from 'lucide-react'
import { collabApi } from '../../api/client'
import { addListener, removeListener } from '../../api/websocket'
import { useTranslation } from '../../i18n'

const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif"

const NOTE_COLORS = [
  { value: '#6366f1', label: 'Indigo' },
  { value: '#ef4444', label: 'Red' },
  { value: '#f59e0b', label: 'Amber' },
  { value: '#10b981', label: 'Emerald' },
  { value: '#3b82f6', label: 'Blue' },
  { value: '#8b5cf6', label: 'Violet' },
]

const formatTimestamp = (ts) => {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now - d
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHrs = Math.floor(diffMins / 60)
  if (diffHrs < 24) return `${diffHrs}h ago`
  const diffDays = Math.floor(diffHrs / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ── Avatar ──────────────────────────────────────────────────────────────────
function UserAvatar({ user, size = 14 }) {
  if (!user) return null
  if (user.avatar) {
    return (
      <img
        src={user.avatar}
        alt={user.username}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          flexShrink: 0,
          background: 'var(--bg-tertiary)',
        }}
      />
    )
  }
  const initials = (user.username || '?').slice(0, 1)
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: '50%',
      background: 'var(--bg-tertiary)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: size * 0.45,
      fontWeight: 600,
      color: 'var(--text-faint)',
      flexShrink: 0,
      textTransform: 'uppercase',
      fontFamily: FONT,
    }}>
      {initials}
    </div>
  )
}

// ── New Note Modal (portal to body) ─────────────────────────────────────────
function NewNoteModal({ onClose, onSubmit, existingCategories, t }) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [category, setCategory] = useState('')
  const [customCategory, setCustomCategory] = useState('')
  const [color, setColor] = useState(NOTE_COLORS[0].value)
  const [submitting, setSubmitting] = useState(false)

  const isCustom = category === '__custom__'
  const finalCategory = isCustom ? customCategory.trim() : category

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!title.trim()) return
    setSubmitting(true)
    try {
      await onSubmit({
        title: title.trim(),
        content: content.trim(),
        category: finalCategory || null,
        color,
      })
      onClose()
    } catch {
      // error handled upstream
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit = title.trim() && !submitting

  return ReactDOM.createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--overlay-bg, rgba(0,0,0,0.35))',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: 16,
        fontFamily: FONT,
      }}
      onClick={onClose}
    >
      <form
        style={{
          background: 'var(--bg-card)',
          borderRadius: 16,
          width: '100%',
          maxWidth: 400,
          maxHeight: '90vh',
          overflow: 'auto',
          border: '1px solid var(--border-faint)',
        }}
        onClick={e => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        {/* Modal header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px 12px',
          borderBottom: '1px solid var(--border-faint)',
        }}>
          <h3 style={{
            fontSize: 14,
            fontWeight: 700,
            color: 'var(--text-primary)',
            margin: 0,
            fontFamily: FONT,
          }}>
            {t('collab.notes.new')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-faint)',
              padding: 2,
              borderRadius: 6,
              display: 'flex',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal body */}
        <div style={{
          padding: '14px 16px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          {/* Title */}
          <div>
            <div style={{
              fontSize: 9,
              fontWeight: 600,
              color: 'var(--text-faint)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 4,
              fontFamily: FONT,
            }}>
              {t('collab.notes.title')}
            </div>
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t('collab.notes.titlePlaceholder')}
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
            />
          </div>

          {/* Content */}
          <div>
            <div style={{
              fontSize: 9,
              fontWeight: 600,
              color: 'var(--text-faint)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 4,
              fontFamily: FONT,
            }}>
              {t('collab.notes.contentPlaceholder')}
            </div>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder={t('collab.notes.contentPlaceholder')}
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
                resize: 'vertical',
                minHeight: 90,
                lineHeight: 1.5,
              }}
            />
          </div>

          {/* Category */}
          <div>
            <div style={{
              fontSize: 9,
              fontWeight: 600,
              color: 'var(--text-faint)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 4,
              fontFamily: FONT,
            }}>
              {t('collab.notes.category')}
            </div>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
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
                cursor: 'pointer',
                appearance: 'none',
              }}
            >
              <option value="">{t('collab.notes.noCategory')}</option>
              {existingCategories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
              <option value="__custom__">{t('collab.notes.newCategory')}</option>
            </select>
            {isCustom && (
              <input
                value={customCategory}
                onChange={e => setCustomCategory(e.target.value)}
                placeholder={t('collab.notes.categoryPlaceholder')}
                autoFocus
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
                  marginTop: 8,
                }}
              />
            )}
          </div>

          {/* Color picker */}
          <div>
            <div style={{
              fontSize: 9,
              fontWeight: 600,
              color: 'var(--text-faint)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 4,
              fontFamily: FONT,
            }}>
              {t('collab.notes.color')}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {NOTE_COLORS.map(c => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setColor(c.value)}
                  title={c.label}
                  aria-label={c.label}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 8,
                    background: c.value,
                    border: color === c.value
                      ? '2px solid var(--text-primary)'
                      : '2px solid transparent',
                    cursor: 'pointer',
                    transition: 'transform 0.15s',
                    transform: color === c.value ? 'scale(1.15)' : 'scale(1)',
                    padding: 0,
                  }}
                />
              ))}
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              width: '100%',
              borderRadius: 99,
              padding: '7px 14px',
              background: canSubmit ? 'var(--accent)' : 'var(--border-primary)',
              color: canSubmit ? 'var(--accent-text)' : 'var(--text-faint)',
              fontSize: 12,
              fontWeight: 600,
              fontFamily: FONT,
              border: 'none',
              cursor: canSubmit ? 'pointer' : 'default',
              marginTop: 4,
            }}
          >
            {submitting ? '...' : t('collab.notes.create')}
          </button>
        </div>
      </form>
    </div>,
    document.body
  )
}

// ── Note Card ───────────────────────────────────────────────────────────────
function NoteCard({ note, currentUser, onUpdate, onDelete, t }) {
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(note.title)
  const [editContent, setEditContent] = useState(note.content || '')
  const [saving, setSaving] = useState(false)

  const author = note.author || note.user || {}
  const color = note.color || '#6366f1'

  const handleStartEdit = useCallback(() => {
    setEditTitle(note.title)
    setEditContent(note.content || '')
    setEditing(true)
  }, [note.title, note.content])

  const handleCancelEdit = useCallback(() => {
    setEditing(false)
    setEditTitle(note.title)
    setEditContent(note.content || '')
  }, [note.title, note.content])

  const handleSaveEdit = useCallback(async () => {
    if (!editTitle.trim()) return
    setSaving(true)
    try {
      await onUpdate(note.id, {
        title: editTitle.trim(),
        content: editContent.trim(),
      })
      setEditing(false)
    } catch {
      // error handled upstream
    } finally {
      setSaving(false)
    }
  }, [note.id, editTitle, editContent, onUpdate])

  const handleTogglePin = useCallback(() => {
    onUpdate(note.id, { pinned: !note.pinned })
  }, [note.id, note.pinned, onUpdate])

  const handleDelete = useCallback(() => {
    onDelete(note.id)
  }, [note.id, onDelete])

  useEffect(() => {
    if (!editing) {
      setEditTitle(note.title)
      setEditContent(note.content || '')
    }
  }, [note.title, note.content, editing])

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        borderRadius: 10,
        border: '1px solid var(--border-faint)',
        overflow: 'hidden',
        background: 'var(--bg-card)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: FONT,
      }}
    >
      {/* Color stripe */}
      <div style={{ height: 3, background: color, flexShrink: 0 }} />

      {/* Pin icon — top right */}
      {!editing && (
        <button
          onClick={handleTogglePin}
          title={note.pinned ? t('collab.notes.unpin') : t('collab.notes.pin')}
          style={{
            position: 'absolute',
            top: 10,
            right: 8,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 2,
            borderRadius: 4,
            display: 'flex',
            color: 'var(--text-faint)',
            opacity: note.pinned ? 1 : 0.5,
            zIndex: 2,
          }}
        >
          {note.pinned ? <Pin size={12} /> : <PinOff size={12} />}
        </button>
      )}

      {/* Hover actions — edit + delete */}
      <div style={{
        position: 'absolute',
        top: 10,
        right: note.pinned ? 28 : 8,
        display: 'flex',
        gap: 2,
        opacity: hovered && !editing ? 1 : 0,
        pointerEvents: hovered && !editing ? 'auto' : 'none',
        transition: 'opacity 0.15s',
        zIndex: 3,
      }}>
        <button
          onClick={handleStartEdit}
          title={t('collab.notes.edit')}
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            border: 'none',
            background: 'var(--bg-card)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: 'var(--text-faint)',
          }}
        >
          <Pencil size={11} />
        </button>
        <button
          onClick={handleDelete}
          title={t('collab.notes.delete')}
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            border: 'none',
            background: 'var(--bg-card)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: '#ef4444',
          }}
        >
          <Trash2 size={11} />
        </button>
      </div>

      {/* Card body */}
      <div style={{
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        flex: 1,
      }}>
        {editing ? (
          <>
            <input
              autoFocus
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              placeholder={t('collab.notes.titlePlaceholder')}
              onKeyDown={e => {
                if (e.key === 'Escape') handleCancelEdit()
                if (e.key === 'Enter' && e.metaKey) handleSaveEdit()
              }}
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
            />
            <textarea
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              placeholder={t('collab.notes.contentPlaceholder')}
              onKeyDown={e => {
                if (e.key === 'Escape') handleCancelEdit()
                if (e.key === 'Enter' && e.metaKey) handleSaveEdit()
              }}
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
                resize: 'vertical',
                minHeight: 64,
                lineHeight: 1.5,
              }}
            />
            <div style={{
              display: 'flex',
              gap: 6,
              justifyContent: 'flex-end',
              marginTop: 4,
            }}>
              <button
                type="button"
                onClick={handleCancelEdit}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  borderRadius: 99,
                  padding: '4px 10px',
                  border: '1px solid var(--border-primary)',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  fontSize: 11,
                  fontWeight: 500,
                  fontFamily: FONT,
                  cursor: 'pointer',
                }}
              >
                <X size={10} />
                {t('collab.notes.cancel')}
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={!editTitle.trim() || saving}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  borderRadius: 99,
                  padding: '4px 10px',
                  border: 'none',
                  background: 'var(--accent)',
                  color: 'var(--accent-text)',
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: FONT,
                  cursor: 'pointer',
                }}
              >
                <Check size={10} />
                {saving ? '...' : t('collab.notes.save')}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Title */}
            <div style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-primary)',
              lineHeight: 1.35,
              paddingRight: 24,
              wordBreak: 'break-word',
              fontFamily: FONT,
            }}>
              {note.title}
            </div>

            {/* Content — 3 line clamp */}
            {note.content && (
              <p style={{
                fontSize: 11,
                color: 'var(--text-muted)',
                lineHeight: 1.5,
                margin: 0,
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                wordBreak: 'break-word',
                fontFamily: FONT,
              }}>
                {note.content}
              </p>
            )}

            {/* Category badge */}
            {note.category && (
              <div style={{ marginTop: 2 }}>
                <span style={{
                  display: 'inline-block',
                  fontSize: 9,
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-faint)',
                  fontWeight: 600,
                  fontFamily: FONT,
                  textTransform: 'uppercase',
                  letterSpacing: '0.03em',
                }}>
                  {note.category}
                </span>
              </div>
            )}

            {/* Author row */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              marginTop: 6,
            }}>
              <UserAvatar user={author} size={14} />
              <span style={{
                fontSize: 9,
                color: 'var(--text-faint)',
                fontFamily: FONT,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {author.username || '?'}
              </span>
              <span style={{
                fontSize: 9,
                color: 'var(--text-faint)',
                fontFamily: FONT,
                marginLeft: 'auto',
                flexShrink: 0,
              }}>
                {formatTimestamp(note.updated_at || note.created_at)}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main Component ──────────────────────────────────────────────────────────
export default function CollabNotes({ tripId, currentUser }) {
  const { t } = useTranslation()
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNewModal, setShowNewModal] = useState(false)
  const [activeCategory, setActiveCategory] = useState(null)

  // ── Load notes on mount ──
  useEffect(() => {
    if (!tripId) return
    let cancelled = false
    setLoading(true)
    collabApi.getNotes(tripId)
      .then(data => { if (!cancelled) setNotes(data?.notes || data || []) })
      .catch(() => { if (!cancelled) setNotes([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tripId])

  // ── WebSocket real-time sync ──
  useEffect(() => {
    if (!tripId) return

    const handler = (msg) => {
      if (msg.type === 'collab:note:created' && msg.note) {
        setNotes(prev => {
          if (prev.some(n => n.id === msg.note.id)) return prev
          return [msg.note, ...prev]
        })
      }
      if (msg.type === 'collab:note:updated' && msg.note) {
        setNotes(prev =>
          prev.map(n => (n.id === msg.note.id ? { ...n, ...msg.note } : n))
        )
      }
      if (msg.type === 'collab:note:deleted') {
        const deletedId = msg.noteId || msg.id
        if (deletedId) {
          setNotes(prev => prev.filter(n => n.id !== deletedId))
        }
      }
    }

    addListener(handler)
    return () => removeListener(handler)
  }, [tripId])

  // ── Actions ──
  const handleCreateNote = useCallback(async (data) => {
    const created = await collabApi.createNote(tripId, data)
    if (created) {
      setNotes(prev => {
        if (prev.some(n => n.id === created.id)) return prev
        return [created, ...prev]
      })
    }
  }, [tripId])

  const handleUpdateNote = useCallback(async (noteId, data) => {
    const updated = await collabApi.updateNote(tripId, noteId, data)
    if (updated) {
      setNotes(prev =>
        prev.map(n => (n.id === noteId ? { ...n, ...updated } : n))
      )
    }
  }, [tripId])

  const handleDeleteNote = useCallback(async (noteId) => {
    await collabApi.deleteNote(tripId, noteId)
    setNotes(prev => prev.filter(n => n.id !== noteId))
  }, [tripId])

  // ── Derived data ──
  const categories = [...new Set(notes.map(n => n.category).filter(Boolean))]

  const sortedNotes = [...notes]
    .filter(n => activeCategory === null || n.category === activeCategory)
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1
      if (!a.pinned && b.pinned) return 1
      const tA = new Date(a.updated_at || a.created_at || 0).getTime()
      const tB = new Date(b.updated_at || b.created_at || 0).getTime()
      return tB - tA
    })

  // ── Loading state ──
  if (loading) {
    return (
      <div style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: FONT,
      }}>
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-faint)',
        }}>
          <h3 style={{
            fontSize: 14,
            fontWeight: 700,
            color: 'var(--text-primary)',
            margin: 0,
            fontFamily: FONT,
          }}>
            {t('collab.notes.title')}
          </h3>
        </div>
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div style={{
            width: 20,
            height: 20,
            border: '2px solid var(--border-primary)',
            borderTopColor: 'var(--text-primary)',
            borderRadius: '50%',
            animation: 'collab-notes-spin 0.7s linear infinite',
          }} />
          <style>{`@keyframes collab-notes-spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: FONT,
    }}>
      {/* ── Header ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-faint)',
        flexShrink: 0,
      }}>
        <h3 style={{
          fontSize: 14,
          fontWeight: 700,
          color: 'var(--text-primary)',
          margin: 0,
          fontFamily: FONT,
        }}>
          {t('collab.notes.title')}
        </h3>
        <button
          onClick={() => setShowNewModal(true)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            borderRadius: 99,
            padding: '7px 14px',
            background: 'var(--accent)',
            color: 'var(--accent-text)',
            fontSize: 12,
            fontWeight: 600,
            fontFamily: FONT,
            border: 'none',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <Plus size={13} />
          {t('collab.notes.new')}
        </button>
      </div>

      {/* ── Category filter pills ── */}
      {categories.length > 0 && (
        <div style={{
          display: 'flex',
          gap: 4,
          padding: '8px 12px 0',
          overflowX: 'auto',
          flexShrink: 0,
        }}>
          <button
            onClick={() => setActiveCategory(null)}
            style={{
              flexShrink: 0,
              borderRadius: 99,
              padding: '3px 10px',
              fontSize: 10,
              fontWeight: 600,
              fontFamily: FONT,
              border: activeCategory === null
                ? '1px solid var(--accent)'
                : '1px solid var(--border-faint)',
              background: activeCategory === null
                ? 'var(--accent)'
                : 'transparent',
              color: activeCategory === null
                ? 'var(--accent-text)'
                : 'var(--text-secondary)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
            }}
          >
            {t('collab.notes.all')}
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(prev => prev === cat ? null : cat)}
              style={{
                flexShrink: 0,
                borderRadius: 99,
                padding: '3px 10px',
                fontSize: 10,
                fontWeight: 600,
                fontFamily: FONT,
                border: activeCategory === cat
                  ? '1px solid var(--accent)'
                  : '1px solid var(--border-faint)',
                background: activeCategory === cat
                  ? 'var(--accent)'
                  : 'transparent',
                color: activeCategory === cat
                  ? 'var(--accent-text)'
                  : 'var(--text-secondary)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
              }}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* ── Scrollable content ── */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: 12,
      }}>
        {sortedNotes.length === 0 ? (
          /* ── Empty state ── */
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '48px 20px',
            textAlign: 'center',
          }}>
            <Pencil size={36} color="var(--text-faint)" style={{ marginBottom: 12 }} />
            <div style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--text-secondary)',
              marginBottom: 4,
              fontFamily: FONT,
            }}>
              {t('collab.notes.empty')}
            </div>
            <div style={{
              fontSize: 12,
              color: 'var(--text-faint)',
              fontFamily: FONT,
            }}>
              {t('collab.notes.emptyDesc') || 'Create a note to get started'}
            </div>
          </div>
        ) : (
          /* ── Notes list — single column ── */
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}>
            {sortedNotes.map(note => (
              <NoteCard
                key={note.id}
                note={note}
                currentUser={currentUser}
                onUpdate={handleUpdateNote}
                onDelete={handleDeleteNote}
                t={t}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── New Note Modal ── */}
      {showNewModal && (
        <NewNoteModal
          onClose={() => setShowNewModal(false)}
          onSubmit={handleCreateNote}
          existingCategories={categories}
          t={t}
        />
      )}
    </div>
  )
}
