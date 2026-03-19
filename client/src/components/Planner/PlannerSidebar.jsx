import React, { useState, useCallback, useEffect, useRef, useMemo, useLayoutEffect } from 'react'
import { FixedSizeList } from 'react-window'
import {
  Plus, Search, X, Navigation, RotateCcw, ExternalLink,
  ChevronDown, ChevronRight, ChevronUp, Clock, MapPin,
  CalendarDays, FileText, Check, Pencil, Trash2,
} from 'lucide-react'
import { calculateRoute, generateGoogleMapsUrl, optimizeRoute } from '../Map/RouteCalculator'
import PackingListPanel from '../Packing/PackingListPanel'
import FileManager from '../Files/FileManager'
import { ReservationModal } from './ReservationModal'
import { PlaceDetailPanel } from './PlaceDetailPanel'
import WeatherWidget from '../Weather/WeatherWidget'
import { useTripStore } from '../../store/tripStore'
import { useToast } from '../shared/Toast'

const SEGMENTS = [
  { id: 'plan', label: 'Plan' },
  { id: 'orte', label: 'Orte' },
  { id: 'reservierungen', label: 'Buchungen' },
  { id: 'packliste', label: 'Packliste' },
  { id: 'dokumente', label: 'Dokumente' },
]

const TRANSPORT_MODES = [
  { value: 'driving', label: 'Auto', icon: '🚗' },
  { value: 'walking', label: 'Fuß', icon: '🚶' },
  { value: 'cycling', label: 'Rad', icon: '🚲' },
]

function formatShortDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('de-DE', {
    day: 'numeric', month: 'short',
  })
}

function formatDateTime(dt) {
  if (!dt) return ''
  try {
    return new Date(dt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
  } catch { return dt }
}

export default function PlannerSidebar({
  trip, days, places, categories, tags,
  assignments, reservations, packingItems,
  selectedDayId, selectedPlaceId,
  onSelectDay, onPlaceClick, onPlaceEdit, onPlaceDelete,
  onAssignToDay, onRemoveAssignment, onReorder,
  onAddPlace, onEditTrip, onRouteCalculated, tripId,
}) {
  const [activeSegment, setActiveSegment] = useState('plan')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [transportMode, setTransportMode] = useState('driving')
  const [isCalculatingRoute, setIsCalculatingRoute] = useState(false)
  const [showReservationModal, setShowReservationModal] = useState(false)
  const [editingReservation, setEditingReservation] = useState(null)
  const [routeInfo, setRouteInfo] = useState(null)
  const [expandedDays, setExpandedDays] = useState(new Set())
  // Day notes inline UI state: { [dayId]: { mode: 'add'|'edit', noteId?, text, time } }
  const [noteUi, setNoteUi] = useState({})
  const noteInputRef = useRef(null)

  const tripStore = useTripStore()
  const toast = useToast()
  const dayNotes = tripStore.dayNotes || {}
  const placesListRef = useRef(null)
  const [placesListHeight, setPlacesListHeight] = useState(400)

  useLayoutEffect(() => {
    if (!placesListRef.current) return
    const ro = new ResizeObserver(([entry]) => {
      setPlacesListHeight(entry.contentRect.height)
    })
    ro.observe(placesListRef.current)
    return () => ro.disconnect()
  }, [activeSegment])

  // Auto-expand selected day
  useEffect(() => {
    if (selectedDayId) {
      setExpandedDays(prev => new Set([...prev, selectedDayId]))
    }
  }, [selectedDayId])

  const toggleDay = (dayId) => {
    setExpandedDays(prev => {
      const next = new Set(prev)
      if (next.has(dayId)) next.delete(dayId)
      else next.add(dayId)
      return next
    })
  }

  const getDayAssignments = (dayId) =>
    (assignments[String(dayId)] || []).slice().sort((a, b) => a.order_index - b.order_index)

  const selectedDayAssignments = selectedDayId ? getDayAssignments(selectedDayId) : []
  const selectedDay = selectedDayId ? days.find(d => d.id === selectedDayId) : null

  const filteredPlaces = useMemo(() => places.filter(p => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.address || '').toLowerCase().includes(search.toLowerCase())
    const matchCat = !categoryFilter || String(p.category_id) === String(categoryFilter)
    return matchSearch && matchCat
  }), [places, search, categoryFilter])

  const isAssignedToDay = (placeId) =>
    selectedDayId && selectedDayAssignments.some(a => a.place?.id === placeId)

  const totalCost = days.reduce((sum, d) => {
    const da = assignments[String(d.id)] || []
    return sum + da.reduce((s, a) => s + (parseFloat(a.place?.price) || 0), 0)
  }, 0)
  const currency = trip?.currency || 'EUR'

  const filteredReservations = selectedDayId
    ? reservations.filter(r => String(r.day_id) === String(selectedDayId) || !r.day_id)
    : reservations

  // Get representative location for a day (first place with coords)
  const getDayLocation = (dayId) => {
    const da = getDayAssignments(dayId)
    const p = da.find(a => a.place?.lat && a.place?.lng)
    return p ? { lat: p.place.lat, lng: p.place.lng } : null
  }

  // Route handlers
  const handleCalculateRoute = async () => {
    if (!selectedDayId) return
    const waypoints = selectedDayAssignments
      .map(a => a.place)
      .filter(p => p?.lat && p?.lng)
      .map(p => ({ lat: p.lat, lng: p.lng }))
    if (waypoints.length < 2) {
      toast.error('Mindestens 2 Orte mit Koordinaten benötigt')
      return
    }
    setIsCalculatingRoute(true)
    try {
      const result = await calculateRoute(waypoints, transportMode)
      setRouteInfo({ distance: result.distanceText, duration: result.durationText })
      onRouteCalculated?.(result)
      toast.success('Route berechnet')
    } catch {
      toast.error('Route konnte nicht berechnet werden')
    } finally {
      setIsCalculatingRoute(false)
    }
  }

  const handleOptimizeRoute = async () => {
    if (!selectedDayId || selectedDayAssignments.length < 3) return
    const withCoords = selectedDayAssignments.map(a => a.place).filter(p => p?.lat && p?.lng)
    const optimized = optimizeRoute(withCoords)
    const reorderedIds = optimized
      .map(p => selectedDayAssignments.find(a => a.place?.id === p.id)?.id)
      .filter(Boolean)
    // Append assignments without coordinates at end
    for (const a of selectedDayAssignments) {
      if (!reorderedIds.includes(a.id)) reorderedIds.push(a.id)
    }
    await onReorder(selectedDayId, reorderedIds)
    toast.success('Route optimiert')
  }

  const handleOpenGoogleMaps = () => {
    const ps = selectedDayAssignments.map(a => a.place).filter(p => p?.lat && p?.lng)
    const url = generateGoogleMapsUrl(ps)
    if (url) window.open(url, '_blank')
    else toast.error('Keine Orte mit Koordinaten vorhanden')
  }

  const handleMoveUp = async (dayId, idx) => {
    const da = getDayAssignments(dayId)
    if (idx === 0) return
    const ids = da.map(a => a.id)
    ;[ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]]
    await onReorder(dayId, ids)
  }

  const handleMoveDown = async (dayId, idx) => {
    const da = getDayAssignments(dayId)
    if (idx === da.length - 1) return
    const ids = da.map(a => a.id)
    ;[ids[idx], ids[idx + 1]] = [ids[idx + 1], ids[idx]]
    await onReorder(dayId, ids)
  }

  // Merge place assignments + day notes into a single sorted list
  const getMergedDayItems = (dayId) => {
    const da = getDayAssignments(dayId)
    const dn = (dayNotes[String(dayId)] || []).slice().sort((a, b) => a.sort_order - b.sort_order)
    return [
      ...da.map(a => ({ type: 'place', sortKey: a.order_index, data: a })),
      ...dn.map(n => ({ type: 'note', sortKey: n.sort_order, data: n })),
    ].sort((a, b) => a.sortKey - b.sortKey)
  }

  const openAddNote = (dayId) => {
    const merged = getMergedDayItems(dayId)
    const maxKey = merged.length > 0 ? Math.max(...merged.map(i => i.sortKey)) : -1
    setNoteUi(prev => ({ ...prev, [dayId]: { mode: 'add', text: '', time: '', sortOrder: maxKey + 1 } }))
    setTimeout(() => noteInputRef.current?.focus(), 50)
  }

  const openEditNote = (dayId, note) => {
    setNoteUi(prev => ({ ...prev, [dayId]: { mode: 'edit', noteId: note.id, text: note.text, time: note.time || '' } }))
    setTimeout(() => noteInputRef.current?.focus(), 50)
  }

  const cancelNote = (dayId) => {
    setNoteUi(prev => { const n = { ...prev }; delete n[dayId]; return n })
  }

  const saveNote = async (dayId) => {
    const ui = noteUi[dayId]
    if (!ui?.text?.trim()) return
    try {
      if (ui.mode === 'add') {
        await tripStore.addDayNote(tripId, dayId, { text: ui.text.trim(), time: ui.time || null, sort_order: ui.sortOrder })
      } else {
        await tripStore.updateDayNote(tripId, dayId, ui.noteId, { text: ui.text.trim(), time: ui.time || null })
      }
      cancelNote(dayId)
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleDeleteNote = async (dayId, noteId) => {
    try {
      await tripStore.deleteDayNote(tripId, dayId, noteId)
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleNoteMoveUp = async (dayId, noteId) => {
    const merged = getMergedDayItems(dayId)
    const idx = merged.findIndex(item => item.type === 'note' && item.data.id === noteId)
    if (idx <= 0) return
    const newSortOrder = idx >= 2
      ? (merged[idx - 2].sortKey + merged[idx - 1].sortKey) / 2
      : merged[idx - 1].sortKey - 1
    try {
      await tripStore.updateDayNote(tripId, dayId, noteId, { sort_order: newSortOrder })
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleNoteMoveDown = async (dayId, noteId) => {
    const merged = getMergedDayItems(dayId)
    const idx = merged.findIndex(item => item.type === 'note' && item.data.id === noteId)
    if (idx === -1 || idx >= merged.length - 1) return
    const newSortOrder = idx < merged.length - 2
      ? (merged[idx + 1].sortKey + merged[idx + 2].sortKey) / 2
      : merged[idx + 1].sortKey + 1
    try {
      await tripStore.updateDayNote(tripId, dayId, noteId, { sort_order: newSortOrder })
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleSaveReservation = async (data) => {
    try {
      if (editingReservation) {
        await tripStore.updateReservation(tripId, editingReservation.id, data)
        toast.success('Reservierung aktualisiert')
      } else {
        await tripStore.addReservation(tripId, { ...data, day_id: selectedDayId || null })
        toast.success('Reservierung hinzugefügt')
      }
      setShowReservationModal(false)
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleDeleteReservation = async (id) => {
    if (!confirm('Reservierung löschen?')) return
    try {
      await tripStore.deleteReservation(tripId, id)
      toast.success('Reservierung gelöscht')
    } catch (err) {
      toast.error(err.message)
    }
  }

  const selectedPlace = selectedPlaceId ? places.find(p => p.id === selectedPlaceId) : null

  return (
    <div className="flex flex-col h-full bg-white relative overflow-hidden" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif" }}>

      <div className="px-4 pt-4 pb-3 flex-shrink-0 border-b border-gray-100">
        <button onClick={onEditTrip} className="w-full text-left group">
          <h1 className="font-semibold text-gray-900 text-[15px] leading-tight truncate group-hover:text-slate-600 transition-colors">
            {trip?.title}
          </h1>
          {(trip?.start_date || trip?.end_date) && (
            <p className="text-xs text-gray-400 mt-0.5">
              {trip.start_date && formatShortDate(trip.start_date)}
              {trip.start_date && trip.end_date && ' – '}
              {trip.end_date && formatShortDate(trip.end_date)}
              {days.length > 0 && ` · ${days.length} Tage`}
            </p>
          )}
        </button>
      </div>

      <div className="px-3 py-2 flex-shrink-0 border-b border-gray-100">
        <div className="flex bg-gray-100 rounded-[10px] p-0.5 gap-0.5">
          {SEGMENTS.map(seg => (
            <button
              key={seg.id}
              onClick={() => setActiveSegment(seg.id)}
              className={`flex-1 py-[5px] text-[11px] font-medium rounded-[8px] transition-all duration-150 leading-none ${
                activeSegment === seg.id
                  ? 'bg-white shadow-sm text-gray-900'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {seg.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">

        {/* ── PLAN ── */}
        {activeSegment === 'plan' && (
          <div className="pb-4">
            <button
              onClick={() => onSelectDay(null)}
              className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors border-b border-gray-50 ${
                selectedDayId === null ? 'bg-slate-100/70' : 'hover:bg-gray-50/80'
              }`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                selectedDayId === null ? 'bg-slate-900' : 'bg-gray-100'
              }`}>
                <MapPin className={`w-4 h-4 ${selectedDayId === null ? 'text-white' : 'text-gray-400'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${selectedDayId === null ? 'text-slate-900' : 'text-gray-700'}`}>
                  Alle Orte
                </p>
                <p className="text-xs text-gray-400">{places.length} Orte gesamt</p>
              </div>
            </button>

            {days.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <CalendarDays className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-sm text-gray-400">Noch keine Tage geplant</p>
                <button onClick={onEditTrip} className="mt-2 text-slate-700 text-sm">
                  Reise bearbeiten →
                </button>
              </div>
            ) : (
              days.map((day, index) => {
                const isSelected = selectedDayId === day.id
                const isExpanded = expandedDays.has(day.id)
                const da = getDayAssignments(day.id)
                const cost = da.reduce((s, a) => s + (parseFloat(a.place?.price) || 0), 0)
                const loc = getDayLocation(day.id)
                const merged = getMergedDayItems(day.id)
                const dayNoteUi = noteUi[day.id]
                const placeItems = merged.filter(i => i.type === 'place')

                return (
                  <div key={day.id} className="border-b border-gray-50">
                    <div
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer select-none transition-colors ${
                        isSelected ? 'bg-slate-100/60' : 'hover:bg-gray-50/80'
                      }`}
                      onClick={() => {
                        onSelectDay(day.id)
                        if (!isExpanded) toggleDay(day.id)
                      }}
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                        isSelected ? 'bg-slate-900 text-white' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`text-sm font-medium truncate ${isSelected ? 'text-slate-900' : 'text-gray-800'}`}>
                            {day.title || `Tag ${index + 1}`}
                          </p>
                          {da.length > 0 && (
                            <span className="text-xs text-gray-400 flex-shrink-0">
                              {da.length} {da.length === 1 ? 'Ort' : 'Orte'}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {day.date && <span className="text-xs text-gray-400">{formatShortDate(day.date)}</span>}
                          {cost > 0 && <span className="text-xs text-emerald-600">{cost.toFixed(0)} {currency}</span>}
                          {day.date && loc && (
                            <WeatherWidget lat={loc.lat} lng={loc.lng} date={day.date} compact />
                          )}
                        </div>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); openAddNote(day.id); if (!isExpanded) toggleDay(day.id) }}
                        title="Notiz hinzufügen"
                        className="p-1 text-gray-300 hover:text-amber-500 flex-shrink-0 transition-colors"
                      >
                        <FileText className="w-4 h-4" />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); toggleDay(day.id) }}
                        className="p-1 text-gray-300 hover:text-gray-500 flex-shrink-0"
                      >
                        {isExpanded
                          ? <ChevronDown className="w-4 h-4" />
                          : <ChevronRight className="w-4 h-4" />
                        }
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="bg-gray-50/40">
                        {merged.length === 0 && !dayNoteUi ? (
                          <div className="px-4 py-4 text-center">
                            <p className="text-xs text-gray-400">Keine Einträge für diesen Tag</p>
                            <button
                              onClick={() => { onSelectDay(day.id); setActiveSegment('orte') }}
                              className="mt-1 text-xs text-slate-700"
                            >
                              + Ort hinzufügen
                            </button>
                          </div>
                        ) : (
                          <div className="divide-y divide-gray-100/60">
                            {merged.map((item, idx) => {
                              if (item.type === 'place') {
                                const assignment = item.data
                                const place = assignment.place
                                if (!place) return null
                                const category = categories.find(c => c.id === place.category_id)
                                const isPlaceSelected = place.id === selectedPlaceId
                                const placeIdx = placeItems.findIndex(i => i.data.id === assignment.id)

                                return (
                                  <div
                                    key={`place-${assignment.id}`}
                                    className={`group flex items-center gap-2.5 pl-4 pr-3 py-2.5 cursor-pointer transition-colors ${
                                      isPlaceSelected ? 'bg-slate-50' : 'hover:bg-white/80'
                                    }`}
                                    onClick={() => onPlaceClick(isPlaceSelected ? null : place.id)}
                                  >
                                    <div
                                      className="w-9 h-9 rounded-[10px] overflow-hidden flex items-center justify-center flex-shrink-0"
                                      style={{ backgroundColor: (category?.color || '#6366f1') + '22' }}
                                    >
                                      {place.image_url ? (
                                        <img src={place.image_url} alt={place.name} className="w-full h-full object-cover" />
                                      ) : (
                                        <span className="text-lg">{category?.icon || '📍'}</span>
                                      )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className={`text-[13px] font-medium truncate leading-snug ${isPlaceSelected ? 'text-slate-900' : 'text-gray-800'}`}>
                                        {place.name}
                                      </p>
                                      {(place.description || place.notes) && (
                                        <p className="text-[11px] text-gray-400 mt-0.5 leading-snug line-clamp-2">
                                          {place.description || place.notes}
                                        </p>
                                      )}
                                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                        {place.place_time && (
                                          <span className="text-[11px] text-slate-600 font-medium">{place.place_time}</span>
                                        )}
                                        {place.price > 0 && (
                                          <span className="text-[11px] text-gray-400">{place.price} {place.currency || currency}</span>
                                        )}
                                        {place.reservation_status && place.reservation_status !== 'none' && (
                                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                                            place.reservation_status === 'confirmed'
                                              ? 'bg-emerald-50 text-emerald-600'
                                              : 'bg-amber-50 text-amber-600'
                                          }`}>
                                            {place.reservation_status === 'confirmed' ? '✓ Bestätigt' : '⏳ Res. ausstehend'}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="flex flex-col gap-0 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button
                                        onClick={e => { e.stopPropagation(); handleMoveUp(day.id, placeIdx) }}
                                        disabled={placeIdx === 0}
                                        className="p-0.5 text-gray-300 hover:text-gray-600 disabled:opacity-20"
                                      >
                                        <ChevronUp className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        onClick={e => { e.stopPropagation(); handleMoveDown(day.id, placeIdx) }}
                                        disabled={placeIdx === placeItems.length - 1}
                                        className="p-0.5 text-gray-300 hover:text-gray-600 disabled:opacity-20"
                                      >
                                        <ChevronDown className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                )
                              }

                              const note = item.data
                              const isEditingThis = dayNoteUi?.mode === 'edit' && dayNoteUi.noteId === note.id
                              if (isEditingThis) {
                                return (
                                  <div key={`note-edit-${note.id}`} className="px-3 py-2 bg-amber-50/60">
                                    <div className="flex gap-2 mb-1.5">
                                      <input
                                        type="text"
                                        value={dayNoteUi.time}
                                        onChange={e => setNoteUi(prev => ({ ...prev, [day.id]: { ...prev[day.id], time: e.target.value } }))}
                                        placeholder="Zeit (optional)"
                                        className="w-24 text-[11px] border border-amber-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-amber-300"
                                      />
                                    </div>
                                    <textarea
                                      ref={noteInputRef}
                                      value={dayNoteUi.text}
                                      onChange={e => setNoteUi(prev => ({ ...prev, [day.id]: { ...prev[day.id], text: e.target.value } }))}
                                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveNote(day.id) } if (e.key === 'Escape') cancelNote(day.id) }}
                                      placeholder="Notiz…"
                                      rows={2}
                                      className="w-full text-[12px] border border-amber-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-amber-300 resize-none"
                                    />
                                    <div className="flex gap-1.5 mt-1.5">
                                      <button onClick={() => saveNote(day.id)} className="flex items-center gap-1 text-[11px] bg-amber-500 text-white px-2.5 py-1 rounded-lg hover:bg-amber-600">
                                        <Check className="w-3 h-3" /> Speichern
                                      </button>
                                      <button onClick={() => cancelNote(day.id)} className="text-[11px] text-gray-500 px-2.5 py-1 rounded-lg hover:bg-gray-100">
                                        Abbrechen
                                      </button>
                                    </div>
                                  </div>
                                )
                              }

                              return (
                                <div key={`note-${note.id}`} className="group flex items-start gap-2 pl-4 pr-3 py-2 bg-amber-50/40 hover:bg-amber-50/70 transition-colors">
                                  <FileText className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                                  <div className="flex-1 min-w-0">
                                    {note.time && (
                                      <span className="text-[11px] font-semibold text-amber-600 mr-1.5">{note.time}</span>
                                    )}
                                    <span className="text-[12px] text-gray-700 leading-snug">{note.text}</span>
                                  </div>
                                  <div className="flex flex-col gap-0 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={e => { e.stopPropagation(); handleNoteMoveUp(day.id, note.id) }} className="p-0.5 text-gray-300 hover:text-gray-600">
                                      <ChevronUp className="w-3.5 h-3.5" />
                                    </button>
                                    <button onClick={e => { e.stopPropagation(); handleNoteMoveDown(day.id, note.id) }} className="p-0.5 text-gray-300 hover:text-gray-600">
                                      <ChevronDown className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                  <div className="flex gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={e => { e.stopPropagation(); openEditNote(day.id, note) }} className="p-1 text-gray-300 hover:text-amber-500 rounded">
                                      <Pencil className="w-3 h-3" />
                                    </button>
                                    <button onClick={e => { e.stopPropagation(); handleDeleteNote(day.id, note.id) }} className="p-1 text-gray-300 hover:text-red-500 rounded">
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}

                        {dayNoteUi?.mode === 'add' && (
                          <div className="px-3 py-2 border-t border-amber-100 bg-amber-50/60">
                            <div className="flex gap-2 mb-1.5">
                              <input
                                type="text"
                                value={dayNoteUi.time}
                                onChange={e => setNoteUi(prev => ({ ...prev, [day.id]: { ...prev[day.id], time: e.target.value } }))}
                                placeholder="Zeit (optional)"
                                className="w-24 text-[11px] border border-amber-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-amber-300"
                              />
                            </div>
                            <textarea
                              ref={noteInputRef}
                              value={dayNoteUi.text}
                              onChange={e => setNoteUi(prev => ({ ...prev, [day.id]: { ...prev[day.id], text: e.target.value } }))}
                              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveNote(day.id) } if (e.key === 'Escape') cancelNote(day.id) }}
                              placeholder="z.B. S3 um 14:30 ab Hauptbahnhof, Fähre ab Pier 7, Mittagspause…"
                              rows={2}
                              className="w-full text-[12px] border border-amber-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-amber-300 resize-none"
                            />
                            <div className="flex gap-1.5 mt-1.5">
                              <button onClick={() => saveNote(day.id)} className="flex items-center gap-1 text-[11px] bg-amber-500 text-white px-2.5 py-1 rounded-lg hover:bg-amber-600">
                                <Check className="w-3 h-3" /> Hinzufügen
                              </button>
                              <button onClick={() => cancelNote(day.id)} className="text-[11px] text-gray-500 px-2.5 py-1 rounded-lg hover:bg-gray-100">
                                Abbrechen
                              </button>
                            </div>
                          </div>
                        )}

                        {!dayNoteUi && (
                          <div className="px-4 py-2 border-t border-gray-100/60 flex gap-2">
                            <button
                              onClick={() => openAddNote(day.id)}
                              className="flex items-center gap-1 text-[11px] text-amber-600 hover:text-amber-700 py-1"
                            >
                              <FileText className="w-3 h-3" />
                              Notiz hinzufügen
                            </button>
                          </div>
                        )}

                        {/* Route tools — only for the selected day */}
                        {isSelected && da.length >= 2 && (
                          <div className="px-4 py-3 space-y-2 border-t border-gray-100/60">
                            <div className="flex bg-gray-100 rounded-[8px] p-0.5 gap-0.5">
                              {TRANSPORT_MODES.map(m => (
                                <button
                                  key={m.value}
                                  onClick={() => setTransportMode(m.value)}
                                  className={`flex-1 py-1 text-[11px] rounded-[6px] transition-all ${
                                    transportMode === m.value
                                      ? 'bg-white shadow-sm text-gray-900 font-medium'
                                      : 'text-gray-500'
                                  }`}
                                >
                                  {m.icon} {m.label}
                                </button>
                              ))}
                            </div>
                            {routeInfo && (
                              <div className="flex items-center justify-center gap-3 text-xs bg-slate-50 rounded-lg px-3 py-2">
                                <span className="text-slate-900">🛣️ {routeInfo.distance}</span>
                                <span className="text-slate-300">·</span>
                                <span className="text-slate-900">⏱️ {routeInfo.duration}</span>
                              </div>
                            )}
                            <div className="grid grid-cols-2 gap-1.5">
                              <button
                                onClick={handleCalculateRoute}
                                disabled={isCalculatingRoute}
                                className="flex items-center justify-center gap-1.5 bg-slate-900 text-white text-xs py-2 rounded-lg hover:bg-slate-700 disabled:opacity-60 transition-colors"
                              >
                                <Navigation className="w-3.5 h-3.5" />
                                {isCalculatingRoute ? 'Berechne...' : 'Route'}
                              </button>
                              <button
                                onClick={handleOptimizeRoute}
                                className="flex items-center justify-center gap-1.5 bg-emerald-600 text-white text-xs py-2 rounded-lg hover:bg-emerald-700 transition-colors"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                Optimieren
                              </button>
                            </div>
                            <button
                              onClick={handleOpenGoogleMaps}
                              className="w-full flex items-center justify-center gap-1.5 border border-gray-200 text-gray-600 text-xs py-2 rounded-lg hover:bg-gray-50 transition-colors"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              In Google Maps öffnen
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )}

            {totalCost > 0 && (
              <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
                <span className="text-xs text-gray-500">Gesamtkosten</span>
                <span className="text-sm font-semibold text-gray-800">{totalCost.toFixed(2)} {currency}</span>
              </div>
            )}
          </div>
        )}

        {/* ── ORTE ── */}
        {activeSegment === 'orte' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div className="p-3 space-y-2 border-b border-gray-100">
              <div className="relative">
                <Search className="absolute left-3 top-[9px] w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Orte suchen…"
                  className="w-full pl-8 pr-8 py-2 bg-gray-100 rounded-[10px] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-slate-400 transition-colors"
                />
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-3 top-[9px]">
                    <X className="w-3.5 h-3.5 text-gray-400" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={categoryFilter}
                  onChange={e => setCategoryFilter(e.target.value)}
                  className="flex-1 bg-gray-100 rounded-lg text-xs py-2 px-2 focus:outline-none text-gray-600"
                >
                  <option value="">Alle Kategorien</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                  ))}
                </select>
                <button
                  onClick={onAddPlace}
                  className="flex items-center gap-1 bg-slate-900 text-white text-xs px-3 py-2 rounded-lg hover:bg-slate-700 whitespace-nowrap transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Neu
                </button>
              </div>
            </div>

            {filteredPlaces.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                <span className="text-3xl mb-2">📍</span>
                <p className="text-sm">Keine Orte gefunden</p>
                <button onClick={onAddPlace} className="mt-3 text-slate-700 text-sm">
                  Ersten Ort hinzufügen
                </button>
              </div>
            ) : (
              <div ref={placesListRef} style={{ flex: 1, minHeight: 0 }}>
                <FixedSizeList
                  height={placesListHeight}
                  itemCount={filteredPlaces.length}
                  itemSize={68}
                  overscanCount={10}
                  width="100%"
                >
                  {({ index, style }) => {
                    const place = filteredPlaces[index]
                    const category = categories.find(c => c.id === place.category_id)
                    const inDay = isAssignedToDay(place.id)
                    const isSelected = place.id === selectedPlaceId
                    return (
                      <div
                        style={style}
                        key={place.id}
                        onClick={() => onPlaceClick(isSelected ? null : place.id)}
                        className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors border-b border-gray-50 ${
                          isSelected ? 'bg-slate-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        <div
                          className="w-9 h-9 rounded-[10px] overflow-hidden flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: (category?.color || '#6366f1') + '22' }}
                        >
                          {place.image_url ? (
                            <img src={place.image_url} alt={place.name} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-lg">{category?.icon || '📍'}</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-medium text-[13px] text-gray-900 truncate">{place.name}</span>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {inDay
                                ? <span className="text-[11px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">✓</span>
                                : selectedDayId && (
                                  <button
                                    onClick={e => { e.stopPropagation(); onAssignToDay(place.id) }}
                                    className="text-[11px] text-slate-700 bg-slate-50 px-1.5 py-0.5 rounded hover:bg-slate-100 transition-colors"
                                  >
                                    + Tag
                                  </button>
                                )
                              }
                            </div>
                          </div>
                          {category && <p className="text-xs text-gray-500 mt-0.5">{category.icon} {category.name}</p>}
                          {place.address && <p className="text-xs text-gray-400 truncate">{place.address}</p>}
                        </div>
                      </div>
                    )
                  }}
                </FixedSizeList>
              </div>
            )}
          </div>
        )}

        {/* ── RESERVIERUNGEN ── */}
        {activeSegment === 'reservierungen' && (
          <div>
            <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
              <h3 className="font-medium text-sm text-gray-900">
                Reservierungen
                {selectedDay && <span className="text-gray-400 font-normal"> · Tag {selectedDay.day_number}</span>}
              </h3>
              <button
                onClick={() => { setEditingReservation(null); setShowReservationModal(true) }}
                className="flex items-center gap-1 bg-slate-900 text-white text-xs px-2.5 py-1.5 rounded-lg hover:bg-slate-700 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Hinzufügen
              </button>
            </div>
            {filteredReservations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                <span className="text-3xl mb-2">🎫</span>
                <p className="text-sm">Keine Reservierungen</p>
              </div>
            ) : (
              <div className="p-3 space-y-2.5">
                {filteredReservations.map(r => (
                  <div key={r.id} className="bg-white border border-gray-100 rounded-2xl p-3.5 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-[13px] text-gray-900">{r.title}</div>
                        {r.reservation_time && (
                          <div className="flex items-center gap-1 mt-1 text-xs text-slate-700">
                            <Clock className="w-3 h-3" />
                            {formatDateTime(r.reservation_time)}
                          </div>
                        )}
                        {r.location && <div className="text-xs text-gray-500 mt-0.5">📍 {r.location}</div>}
                        {r.confirmation_number && (
                          <div className="text-xs text-emerald-600 mt-1 bg-emerald-50 rounded-lg px-2 py-0.5 inline-block">
                            # {r.confirmation_number}
                          </div>
                        )}
                        {r.notes && <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">{r.notes}</p>}
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <button
                          onClick={() => { setEditingReservation(r); setShowReservationModal(true) }}
                          className="p-1.5 text-gray-400 hover:text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
                        >✏️</button>
                        <button
                          onClick={() => handleDeleteReservation(r.id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                        >🗑️</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── PACKLISTE ── */}
        {activeSegment === 'packliste' && (
          <PackingListPanel tripId={tripId} items={packingItems} />
        )}

        {/* ── DOKUMENTE ── */}
        {activeSegment === 'dokumente' && (
          <FileManager tripId={tripId} />
        )}
      </div>

      {/* ── INSPECTOR OVERLAY ── */}
      {selectedPlace && (
        <div className="absolute inset-0 bg-white z-10 overflow-y-auto">
          <PlaceDetailPanel
            place={selectedPlace}
            categories={categories}
            tags={tags}
            selectedDayId={selectedDayId}
            dayAssignments={selectedDayAssignments}
            onClose={() => onPlaceClick(null)}
            onEdit={() => onPlaceEdit(selectedPlace)}
            onDelete={() => onPlaceDelete(selectedPlace.id)}
            onAssignToDay={onAssignToDay}
            onRemoveAssignment={onRemoveAssignment}
          />
        </div>
      )}

      <ReservationModal
        isOpen={showReservationModal}
        onClose={() => { setShowReservationModal(false); setEditingReservation(null) }}
        onSave={handleSaveReservation}
        reservation={editingReservation}
        days={days}
        places={places}
        selectedDayId={selectedDayId}
      />
    </div>
  )
}
