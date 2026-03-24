import React, { useState, useCallback } from 'react'
import { Plus, Search, ChevronUp, ChevronDown, X, Map, ExternalLink, Navigation, RotateCcw, Clock, Euro, FileText, Package } from 'lucide-react'
import { calculateRoute, generateGoogleMapsUrl, optimizeRoute } from '../Map/RouteCalculator'
import PackingListPanel from '../Packing/PackingListPanel'
import { ReservationModal } from './ReservationModal'
import { PlaceDetailPanel } from './PlaceDetailPanel'
import { useTripStore } from '../../store/tripStore'
import { useToast } from '../shared/Toast'
import { useTranslation } from '../../i18n'

export function RightPanel({
  trip, days, places, categories, tags,
  assignments, reservations, packingItems,
  selectedDay, selectedDayId, selectedPlaceId,
  onPlaceClick, onPlaceEdit, onPlaceDelete,
  onAssignToDay, onRemoveAssignment, onReorder,
  onAddPlace, onEditTrip, onRouteCalculated, tripId,
}) {
  const [activeTab, setActiveTab] = useState('orte')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [isCalculatingRoute, setIsCalculatingRoute] = useState(false)
  const [showReservationModal, setShowReservationModal] = useState(false)
  const [editingReservation, setEditingReservation] = useState(null)
  const [routeInfo, setRouteInfo] = useState(null)

  const tripStore = useTripStore()
  const toast = useToast()
  const { t } = useTranslation()

  const TABS = [
    { id: 'orte', label: t('planner.places'), icon: '📍' },
    { id: 'tagesplan', label: t('planner.dayPlan'), icon: '📅' },
    { id: 'reservierungen', label: t('planner.reservations'), icon: '🎫' },
    { id: 'packliste', label: t('planner.packingList'), icon: '🎒' },
  ]

  // Filtered places for Orte tab
  const filteredPlaces = places.filter(p => {
    const matchesSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.address || '').toLowerCase().includes(search.toLowerCase())
    const matchesCategory = !categoryFilter || String(p.category_id) === String(categoryFilter)
    return matchesSearch && matchesCategory
  })

  // Ordered assignments for selected day
  const dayAssignments = selectedDayId
    ? (assignments[String(selectedDayId)] || []).slice().sort((a, b) => a.order_index - b.order_index)
    : []

  const isAssignedToSelectedDay = (placeId) =>
    selectedDayId && dayAssignments.some(a => a.place?.id === placeId)

  // Calculate schedule with times
  const getSchedule = () => {
    if (!dayAssignments.length) return []
    let currentTime = null
    return dayAssignments.map((assignment, idx) => {
      const place = assignment.place
      const startTime = place?.place_time || (currentTime ? currentTime : null)
      const duration = place?.duration_minutes || 60
      if (startTime) {
        const [h, m] = startTime.split(':').map(Number)
        const endMinutes = h * 60 + m + duration
        const endH = Math.floor(endMinutes / 60) % 24
        const endM = endMinutes % 60
        currentTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`
      }
      return { assignment, startTime, endTime: currentTime }
    })
  }

  const handleCalculateRoute = async () => {
    if (!selectedDayId) return
    const waypoints = dayAssignments
      .map(a => a.place)
      .filter(p => p?.lat && p?.lng)
      .map(p => ({ lat: p.lat, lng: p.lng }))

    if (waypoints.length < 2) {
      toast.error(t('planner.minTwoPlaces'))
      return
    }

    setIsCalculatingRoute(true)
    try {
      const result = await calculateRoute(waypoints, 'walking')
      if (result) {
        setRouteInfo({ distance: result.distanceText, duration: result.durationText })
        onRouteCalculated?.(result)
        toast.success(t('planner.routeCalculated'))
      } else {
        toast.error(t('planner.routeCalcFailed'))
      }
    } catch (err) {
      toast.error(t('planner.routeError'))
    } finally {
      setIsCalculatingRoute(false)
    }
  }

  const handleOptimizeRoute = async () => {
    if (!selectedDayId || dayAssignments.length < 3) return
    const places = dayAssignments.map(a => a.place).filter(p => p?.lat && p?.lng)
    const optimized = optimizeRoute(places)
    const optimizedIds = optimized.map(p => {
      const a = dayAssignments.find(a => a.place?.id === p.id)
      return a?.id
    }).filter(Boolean)
    await onReorder(selectedDayId, optimizedIds)
    toast.success(t('planner.routeOptimized'))
  }

  const handleOpenGoogleMaps = () => {
    const places = dayAssignments.map(a => a.place).filter(p => p?.lat && p?.lng)
    const url = generateGoogleMapsUrl(places)
    if (url) window.open(url, '_blank')
    else toast.error(t('planner.noGeoPlaces'))
  }

  const handleMoveUp = async (idx) => {
    if (idx === 0) return
    const ids = dayAssignments.map(a => a.id)
    ;[ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]]
    await onReorder(selectedDayId, ids)
  }

  const handleMoveDown = async (idx) => {
    if (idx === dayAssignments.length - 1) return
    const ids = dayAssignments.map(a => a.id)
    ;[ids[idx], ids[idx + 1]] = [ids[idx + 1], ids[idx]]
    await onReorder(selectedDayId, ids)
  }

  const handleAddReservation = () => {
    setEditingReservation(null)
    setShowReservationModal(true)
  }

  const handleSaveReservation = async (data) => {
    try {
      if (editingReservation) {
        await tripStore.updateReservation(tripId, editingReservation.id, data)
        toast.success(t('planner.reservationUpdated'))
      } else {
        await tripStore.addReservation(tripId, { ...data, day_id: selectedDayId || null })
        toast.success(t('planner.reservationAdded'))
      }
      setShowReservationModal(false)
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleDeleteReservation = async (id) => {
    if (!confirm(t('planner.confirmDeleteReservation'))) return
    try {
      await tripStore.deleteReservation(tripId, id)
      toast.success(t('planner.reservationDeleted'))
    } catch (err) {
      toast.error(err.message)
    }
  }

  // Reservations for selected day (or all if no day selected)
  const filteredReservations = selectedDayId
    ? reservations.filter(r => String(r.day_id) === String(selectedDayId) || !r.day_id)
    : reservations

  const selectedPlace = selectedPlaceId ? places.find(p => p.id === selectedPlaceId) : null

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Tabs */}
      <div className="flex border-b border-gray-200 flex-shrink-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors flex flex-col items-center gap-0.5 ${
              activeTab === tab.id
                ? 'text-slate-700 border-b-2 border-slate-700'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <span className="text-base leading-none">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">

        {/* ORTE TAB */}
        {activeTab === 'orte' && (
          <div className="flex flex-col h-full">
            {/* Place detail (when selected) */}
            {selectedPlace && (
              <div className="border-b border-gray-100">
                <PlaceDetailPanel
                  place={selectedPlace}
                  categories={categories}
                  tags={tags}
                  selectedDayId={selectedDayId}
                  dayAssignments={dayAssignments}
                  onClose={() => onPlaceClick(null)}
                  onEdit={() => onPlaceEdit(selectedPlace)}
                  onDelete={() => onPlaceDelete(selectedPlace.id)}
                  onAssignToDay={onAssignToDay}
                  onRemoveAssignment={onRemoveAssignment}
                />
              </div>
            )}

            {/* Search & filter */}
            <div className="p-3 space-y-2 border-b border-gray-100 flex-shrink-0">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={t('planner.searchPlaces')}
                  className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-2.5 top-2.5">
                    <X className="w-4 h-4 text-gray-400" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={categoryFilter}
                  onChange={e => setCategoryFilter(e.target.value)}
                  className="flex-1 border border-gray-200 rounded-lg text-xs py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-slate-900 text-gray-600"
                >
                  <option value="">{t('planner.allCategories')}</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                  ))}
                </select>
                <button
                  onClick={onAddPlace}
                  className="flex items-center gap-1 bg-slate-700 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-slate-900 whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t('planner.addPlace')}
                </button>
              </div>
            </div>

            {/* Places list */}
            <div className="flex-1 overflow-y-auto">
              {filteredPlaces.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                  <span className="text-3xl mb-2">📍</span>
                  <p className="text-sm">{t('planner.noPlacesFound')}</p>
                  <button onClick={onAddPlace} className="mt-3 text-slate-700 text-sm hover:underline">
                    {t('planner.addFirstPlace')}
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {filteredPlaces.map(place => {
                    const category = categories.find(c => c.id === place.category_id)
                    const isInDay = isAssignedToSelectedDay(place.id)
                    const isSelected = place.id === selectedPlaceId

                    return (
                      <div
                        key={place.id}
                        onClick={() => onPlaceClick(isSelected ? null : place.id)}
                        className={`px-3 py-2.5 cursor-pointer transition-colors ${
                          isSelected ? 'bg-slate-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          {/* Category color bar */}
                          <div
                            className="w-1 rounded-full flex-shrink-0 mt-1 self-stretch"
                            style={{ backgroundColor: category?.color || '#6366f1', minHeight: 16 }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-medium text-sm text-gray-900 truncate">{place.name}</span>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                {isInDay && (
                                  <span className="text-xs text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">✓</span>
                                )}
                                {!isInDay && selectedDayId && (
                                  <button
                                    onClick={e => { e.stopPropagation(); onAssignToDay(place.id) }}
                                    className="text-xs text-slate-700 bg-slate-50 px-1.5 py-0.5 rounded hover:bg-slate-100"
                                  >
                                    {t('planner.addToDay')}
                                  </button>
                                )}
                              </div>
                            </div>
                            {category && (
                              <span className="text-xs text-gray-500">{category.icon} {category.name}</span>
                            )}
                            {place.address && (
                              <p className="text-xs text-gray-400 truncate mt-0.5">{place.address}</p>
                            )}
                            <div className="flex items-center gap-2 mt-1">
                              {place.place_time && (
                                <span className="text-xs text-gray-500">🕐 {place.place_time}{place.end_time ? ` – ${place.end_time}` : ''}</span>
                              )}
                              {place.price > 0 && (
                                <span className="text-xs text-gray-500">
                                  {place.price} {place.currency || trip?.currency}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAGESPLAN TAB */}
        {activeTab === 'tagesplan' && (
          <div className="flex flex-col h-full">
            {!selectedDayId ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400 px-6">
                <span className="text-4xl mb-3">📅</span>
                <p className="text-sm text-center">{t('planner.selectDayHint')}</p>
              </div>
            ) : (
              <>
                {/* Day header */}
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex-shrink-0">
                  <h3 className="font-semibold text-slate-900 text-sm">
                    Tag {selectedDay?.day_number}
                    {selectedDay?.date && (
                      <span className="font-normal text-slate-700 ml-2">
                        {formatGermanDate(selectedDay.date)}
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-700 mt-0.5">
                    {dayAssignments.length === 1 ? t('planner.placeOne') : t('planner.placeN', { n: dayAssignments.length })}
                    {dayAssignments.length > 0 && ` · ${dayAssignments.reduce((s, a) => s + (a.place?.duration_minutes || 60), 0)} ${t('planner.minTotal')}`}
                  </p>
                </div>

                {/* Places list with order */}
                <div className="flex-1 overflow-y-auto">
                  {dayAssignments.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                      <span className="text-3xl mb-2">🗺️</span>
                      <p className="text-sm">{t('planner.noPlacesForDay')}</p>
                      <button
                        onClick={() => setActiveTab('orte')}
                        className="mt-3 text-slate-700 text-sm hover:underline"
                      >
                        {t('planner.addPlacesLink')}
                      </button>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-50">
                      {getSchedule().map(({ assignment, startTime, endTime }, idx) => {
                        const place = assignment.place
                        if (!place) return null
                        const category = categories.find(c => c.id === place.category_id)

                        return (
                          <div key={assignment.id} className="px-3 py-3 flex items-start gap-2">
                            {/* Order number */}
                            <div
                              className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5"
                              style={{ backgroundColor: category?.color || '#6366f1' }}
                            >
                              {idx + 1}
                            </div>

                            {/* Place info */}
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm text-gray-900 truncate">{place.name}</div>
                              <div className="flex items-center gap-2 mt-0.5">
                                {startTime && (
                                  <span className="text-xs text-slate-700">🕐 {startTime}</span>
                                )}
                                <span className="text-xs text-gray-400">
                                  {place.duration_minutes || 60} Min.
                                </span>
                                {place.price > 0 && (
                                  <span className="text-xs text-gray-400">
                                    {place.price} {place.currency || trip?.currency}
                                  </span>
                                )}
                              </div>
                              {place.address && (
                                <p className="text-xs text-gray-400 mt-0.5 truncate">{place.address}</p>
                              )}
                              {assignment.notes && (
                                <p className="text-xs text-gray-500 mt-1 bg-gray-50 rounded px-2 py-1">{assignment.notes}</p>
                              )}
                            </div>

                            {/* Actions */}
                            <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
                              <button
                                onClick={() => handleMoveUp(idx)}
                                disabled={idx === 0}
                                className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                              >
                                <ChevronUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleMoveDown(idx)}
                                disabled={idx === dayAssignments.length - 1}
                                className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                              >
                                <ChevronDown className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => onRemoveAssignment(selectedDayId, assignment.id)}
                                className="p-1 text-red-400 hover:text-red-600"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Route buttons */}
                {dayAssignments.length >= 2 && (
                  <div className="p-3 border-t border-gray-100 flex-shrink-0 space-y-2">
                    {routeInfo && (
                      <div className="flex items-center justify-center gap-3 text-sm bg-slate-50 rounded-lg px-3 py-2">
                        <span className="text-slate-900">🛣️ {routeInfo.distance}</span>
                        <span className="text-slate-400">·</span>
                        <span className="text-slate-900">⏱️ {routeInfo.duration}</span>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={handleCalculateRoute}
                        disabled={isCalculatingRoute}
                        className="flex items-center justify-center gap-1.5 bg-slate-700 text-white text-xs py-2 rounded-lg hover:bg-slate-900 disabled:opacity-60"
                      >
                        <Navigation className="w-3.5 h-3.5" />
                        {isCalculatingRoute ? t('planner.calculating') : t('planner.route')}
                      </button>
                      <button
                        onClick={handleOptimizeRoute}
                        className="flex items-center justify-center gap-1.5 bg-emerald-600 text-white text-xs py-2 rounded-lg hover:bg-emerald-700"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        {t('planner.optimize')}
                      </button>
                    </div>
                    <button
                      onClick={handleOpenGoogleMaps}
                      className="w-full flex items-center justify-center gap-1.5 bg-white border border-gray-200 text-gray-700 text-xs py-2 rounded-lg hover:bg-gray-50"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      {t('planner.openGoogleMaps')}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* RESERVIERUNGEN TAB */}
        {activeTab === 'reservierungen' && (
          <div className="flex flex-col h-full">
            <div className="p-3 flex items-center justify-between border-b border-gray-100 flex-shrink-0">
              <h3 className="font-medium text-sm text-gray-900">
                {t('planner.reservations')}
                {selectedDay && <span className="text-gray-500 font-normal"> · Tag {selectedDay.day_number}</span>}
              </h3>
              <button
                onClick={handleAddReservation}
                className="flex items-center gap-1 bg-slate-700 text-white text-xs px-2.5 py-1.5 rounded-lg hover:bg-slate-900"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('common.add')}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {filteredReservations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                  <span className="text-3xl mb-2">🎫</span>
                  <p className="text-sm">{t('planner.noReservations')}</p>
                  <button onClick={handleAddReservation} className="mt-3 text-slate-700 text-sm hover:underline">
                    {t('planner.addFirstReservation')}
                  </button>
                </div>
              ) : (
                <div className="p-3 space-y-3">
                  {filteredReservations.map(reservation => (
                    <div key={reservation.id} className="bg-white border border-gray-200 rounded-xl p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm text-gray-900">{reservation.title}</div>
                          {reservation.reservation_time && (
                            <div className="flex items-center gap-1 mt-1 text-xs text-slate-700">
                              <Clock className="w-3 h-3" />
                              {formatDateTime(reservation.reservation_time)}
                            </div>
                          )}
                          {reservation.location && (
                            <div className="text-xs text-gray-500 mt-0.5">📍 {reservation.location}</div>
                          )}
                          {reservation.confirmation_number && (
                            <div className="text-xs text-emerald-600 mt-1 bg-emerald-50 rounded px-2 py-0.5 inline-block">
                              # {reservation.confirmation_number}
                            </div>
                          )}
                          {reservation.notes && (
                            <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">{reservation.notes}</p>
                          )}
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          <button
                            onClick={() => { setEditingReservation(reservation); setShowReservationModal(true) }}
                            className="p-1.5 text-gray-400 hover:text-slate-700 hover:bg-slate-50 rounded-lg"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => handleDeleteReservation(reservation.id)}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* PACKLISTE TAB */}
        {activeTab === 'packliste' && (
          <PackingListPanel
            tripId={tripId}
            items={packingItems}
          />
        )}
      </div>

      {/* Reservation Modal */}
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

function formatGermanDate(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })
}

function formatDateTime(dt) {
  if (!dt) return ''
  try {
    return new Date(dt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return dt
  }
}
