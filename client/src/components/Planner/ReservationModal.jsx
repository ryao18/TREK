import React, { useState, useEffect, useRef } from 'react'
import Modal from '../shared/Modal'
import CustomSelect from '../shared/CustomSelect'
import { Plane, Hotel, Utensils, Train, Car, Ship, Ticket, FileText, Users, Paperclip, X, ExternalLink } from 'lucide-react'
import { useToast } from '../shared/Toast'
import { useTranslation } from '../../i18n'
import { CustomDateTimePicker } from '../shared/CustomDateTimePicker'

const TYPE_OPTIONS = [
  { value: 'flight',     labelKey: 'reservations.type.flight',     Icon: Plane },
  { value: 'hotel',      labelKey: 'reservations.type.hotel',      Icon: Hotel },
  { value: 'restaurant', labelKey: 'reservations.type.restaurant', Icon: Utensils },
  { value: 'train',      labelKey: 'reservations.type.train',      Icon: Train },
  { value: 'car',        labelKey: 'reservations.type.car',        Icon: Car },
  { value: 'cruise',     labelKey: 'reservations.type.cruise',     Icon: Ship },
  { value: 'event',      labelKey: 'reservations.type.event',      Icon: Ticket },
  { value: 'tour',       labelKey: 'reservations.type.tour',       Icon: Users },
  { value: 'other',      labelKey: 'reservations.type.other',      Icon: FileText },
]

export function ReservationModal({ isOpen, onClose, onSave, reservation, days, places, selectedDayId, files = [], onFileUpload, onFileDelete }) {
  const toast = useToast()
  const { t } = useTranslation()
  const fileInputRef = useRef(null)

  const [form, setForm] = useState({
    title: '', type: 'other', status: 'pending',
    reservation_time: '', location: '', confirmation_number: '',
    notes: '', day_id: '', place_id: '',
  })
  const [isSaving, setIsSaving] = useState(false)
  const [uploadingFile, setUploadingFile] = useState(false)
  const [pendingFiles, setPendingFiles] = useState([]) // for new reservations

  useEffect(() => {
    if (reservation) {
      setForm({
        title: reservation.title || '',
        type: reservation.type || 'other',
        status: reservation.status || 'pending',
        reservation_time: reservation.reservation_time ? reservation.reservation_time.slice(0, 16) : '',
        location: reservation.location || '',
        confirmation_number: reservation.confirmation_number || '',
        notes: reservation.notes || '',
        day_id: reservation.day_id || '',
        place_id: reservation.place_id || '',
      })
    } else {
      setForm({
        title: '', type: 'other', status: 'pending',
        reservation_time: '', location: '', confirmation_number: '',
        notes: '', day_id: selectedDayId || '', place_id: '',
      })
      setPendingFiles([])
    }
  }, [reservation, isOpen, selectedDayId])

  const set = (field, value) => setForm(prev => ({ ...prev, [field]: value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) return
    setIsSaving(true)
    try {
      const saved = await onSave({
        ...form,
        day_id: form.day_id || null,
        place_id: form.place_id || null,
      })
      // Upload pending files for newly created reservations
      if (!reservation?.id && saved?.id && pendingFiles.length > 0) {
        for (const file of pendingFiles) {
          const fd = new FormData()
          fd.append('file', file)
          fd.append('reservation_id', saved.id)
          fd.append('description', form.title)
          await onFileUpload(fd)
        }
      }
    } finally {
      setIsSaving(false)
    }
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (reservation?.id) {
      // Existing reservation — upload immediately
      setUploadingFile(true)
      try {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('reservation_id', reservation.id)
        fd.append('description', reservation.title)
        await onFileUpload(fd)
        toast.success(t('reservations.toast.fileUploaded'))
      } catch {
        toast.error(t('reservations.toast.uploadError'))
      } finally {
        setUploadingFile(false)
        e.target.value = ''
      }
    } else {
      // New reservation — stage locally
      setPendingFiles(prev => [...prev, file])
      e.target.value = ''
    }
  }

  const attachedFiles = reservation?.id ? files.filter(f => f.reservation_id === reservation.id) : []

  const inputStyle = {
    width: '100%', border: '1px solid var(--border-primary)', borderRadius: 10,
    padding: '8px 14px', fontSize: 13, fontFamily: 'inherit',
    outline: 'none', boxSizing: 'border-box', color: 'var(--text-primary)', background: 'var(--bg-input)',
  }
  const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 5 }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={reservation ? t('reservations.editTitle') : t('reservations.newTitle')} size="md">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Type selector */}
        <div>
          <label style={labelStyle}>{t('reservations.bookingType')}</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {TYPE_OPTIONS.map(({ value, labelKey, Icon }) => (
              <button key={value} type="button" onClick={() => set('type', value)} style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '6px 11px', borderRadius: 99, border: '1px solid',
                fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.12s',
                background: form.type === value ? 'var(--text-primary)' : 'var(--bg-card)',
                borderColor: form.type === value ? 'var(--text-primary)' : 'var(--border-primary)',
                color: form.type === value ? 'var(--bg-primary)' : 'var(--text-muted)',
              }}>
                <Icon size={12} /> {t(labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* Title */}
        <div>
          <label style={labelStyle}>{t('reservations.titleLabel')} *</label>
          <input type="text" value={form.title} onChange={e => set('title', e.target.value)} required
            placeholder={t('reservations.titlePlaceholder')} style={inputStyle} />
        </div>

        {/* Date/Time + Status */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
          <div>
            <label style={labelStyle}>{t('reservations.datetime')}</label>
            <CustomDateTimePicker value={form.reservation_time} onChange={v => set('reservation_time', v)} />
          </div>
          <div>
            <label style={labelStyle}>{t('reservations.status')}</label>
            <CustomSelect
              value={form.status}
              onChange={value => set('status', value)}
              options={[
                { value: 'pending', label: t('reservations.pending') },
                { value: 'confirmed', label: t('reservations.confirmed') },
              ]}
              size="sm"
            />
          </div>
        </div>

        {/* Location */}
        <div>
          <label style={labelStyle}>{t('reservations.locationAddress')}</label>
          <input type="text" value={form.location} onChange={e => set('location', e.target.value)}
            placeholder={t('reservations.locationPlaceholder')} style={inputStyle} />
        </div>

        {/* Confirmation number */}
        <div>
          <label style={labelStyle}>{t('reservations.confirmationCode')}</label>
          <input type="text" value={form.confirmation_number} onChange={e => set('confirmation_number', e.target.value)}
            placeholder={t('reservations.confirmationPlaceholder')} style={inputStyle} />
        </div>

        {/* Linked day + place */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={labelStyle}>{t('reservations.day')}</label>
            <CustomSelect
              value={form.day_id}
              onChange={value => set('day_id', value)}
              placeholder={t('reservations.noDay')}
              options={[
                { value: '', label: t('reservations.noDay') },
                ...(days || []).map(day => ({
                  value: day.id,
                  label: `${t('reservations.day')} ${day.day_number}${day.date ? ` · ${formatDate(day.date)}` : ''}`,
                })),
              ]}
              size="sm"
            />
          </div>
          <div>
            <label style={labelStyle}>{t('reservations.place')}</label>
            <CustomSelect
              value={form.place_id}
              onChange={value => set('place_id', value)}
              placeholder={t('reservations.noPlace')}
              options={[
                { value: '', label: t('reservations.noPlace') },
                ...(places || []).map(place => ({
                  value: place.id,
                  label: place.name,
                })),
              ]}
              searchable
              size="sm"
            />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label style={labelStyle}>{t('reservations.notes')}</label>
          <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3}
            placeholder={t('reservations.notesPlaceholder')}
            style={{ ...inputStyle, resize: 'none', lineHeight: 1.5 }} />
        </div>

        {/* File upload — always visible */}
        <div>
          <label style={labelStyle}>{t('files.title')}</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {attachedFiles.map(f => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border-primary)' }}>
                <FileText size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.original_name}</span>
                <a href={f.url} target="_blank" rel="noreferrer" style={{ color: 'var(--text-faint)', display: 'flex', flexShrink: 0 }} title={t('common.open')}>
                  <ExternalLink size={12} />
                </a>
                {onFileDelete && (
                  <button type="button" onClick={() => onFileDelete(f.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', display: 'flex', padding: 0, flexShrink: 0 }}
                    onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                    onMouseLeave={e => e.currentTarget.style.color = '#9ca3af'}>
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
            {pendingFiles.map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border-primary)' }}>
                <FileText size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                <span style={{ fontSize: 11, color: 'var(--text-faint)', flexShrink: 0 }}>{t('reservations.pendingSave')}</span>
                <button type="button" onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', display: 'flex', padding: 0, flexShrink: 0 }}
                  onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                  onMouseLeave={e => e.currentTarget.style.color = '#9ca3af'}>
                  <X size={12} />
                </button>
              </div>
            ))}
            <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.txt,image/*" style={{ display: 'none' }} onChange={handleFileChange} />
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadingFile} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px',
              border: '1px dashed var(--border-primary)', borderRadius: 8, background: 'var(--bg-card)',
              fontSize: 12.5, color: 'var(--text-muted)', cursor: uploadingFile ? 'default' : 'pointer',
              fontFamily: 'inherit', transition: 'all 0.12s',
            }}
              onMouseEnter={e => { if (!uploadingFile) { e.currentTarget.style.borderColor = 'var(--text-faint)'; e.currentTarget.style.color = 'var(--text-secondary)' } }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-primary)'; e.currentTarget.style.color = 'var(--text-muted)' }}>
              <Paperclip size={13} />
              {uploadingFile ? t('reservations.uploading') : t('reservations.attachFile')}
            </button>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4, borderTop: '1px solid var(--border-secondary)' }}>
          <button type="button" onClick={onClose} style={{ padding: '8px 16px', borderRadius: 10, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text-secondary)' }}>
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={isSaving || !form.title.trim()} style={{ padding: '8px 20px', borderRadius: 10, border: 'none', background: 'var(--text-primary)', color: 'var(--bg-primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: isSaving || !form.title.trim() ? 0.5 : 1 }}>
            {isSaving ? t('common.saving') : reservation ? t('common.update') : t('common.add')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })
}
