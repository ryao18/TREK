import React from 'react'
import { CalendarDays, MapPin, Plus } from 'lucide-react'
import WeatherWidget from '../Weather/WeatherWidget'
import { useTranslation } from '../../i18n'

function formatDate(dateStr) {
  if (!dateStr) return null
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('de-DE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

function dayTotal(dayId, assignments) {
  const dayAssignments = assignments[String(dayId)] || []
  return dayAssignments.reduce((sum, a) => {
    const cost = parseFloat(a.place?.cost) || 0
    return sum + cost
  }, 0)
}

export function DaysList({ days, selectedDayId, onSelectDay, assignments, trip }) {
  const { t } = useTranslation()
  const totalCost = days.reduce((sum, d) => sum + dayTotal(d.id, assignments), 0)
  const currency = trip?.currency || 'EUR'

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <h2 className="text-sm font-semibold text-gray-700">{t('planner.dayPlan')}</h2>
        <p className="text-xs text-gray-400 mt-0.5">{t('planner.dayCount', { n: days.length })}</p>
      </div>

      {/* All places overview option */}
      <button
        onClick={() => onSelectDay(null)}
        className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-colors flex items-center gap-2 flex-shrink-0 ${
          selectedDayId === null
            ? 'bg-slate-50 border-l-2 border-l-slate-900'
            : 'hover:bg-gray-50'
        }`}
      >
        <MapPin className={`w-4 h-4 flex-shrink-0 ${selectedDayId === null ? 'text-slate-900' : 'text-gray-400'}`} />
        <div>
          <p className={`text-sm font-medium ${selectedDayId === null ? 'text-slate-900' : 'text-gray-700'}`}>
            {t('planner.allPlaces')}
          </p>
          <p className="text-xs text-gray-400">{t('planner.overview')}</p>
        </div>
      </button>

      {/* Day list */}
      <div className="flex-1 overflow-y-auto">
        {days.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <CalendarDays className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-xs text-gray-400">{t('planner.noDays')}</p>
            <p className="text-xs text-gray-300 mt-1">{t('planner.editTripToAddDays')}</p>
          </div>
        ) : (
          days.map((day, index) => {
            const isSelected = selectedDayId === day.id
            const dayAssignments = assignments[String(day.id)] || []
            const cost = dayTotal(day.id, assignments)
            const placeCount = dayAssignments.length

            return (
              <button
                key={day.id}
                onClick={() => onSelectDay(day.id)}
                className={`w-full text-left px-4 py-3 border-b border-gray-50 transition-colors ${
                  isSelected
                    ? 'bg-slate-50 border-l-2 border-l-slate-900'
                    : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                        isSelected ? 'bg-slate-900 text-white' : 'bg-gray-200 text-gray-600'
                      }`}>
                        {index + 1}
                      </span>
                      <span className={`text-sm font-medium truncate ${isSelected ? 'text-slate-900' : 'text-gray-700'}`}>
                        {day.title || `Tag ${index + 1}`}
                      </span>
                    </div>

                    {day.date && (
                      <p className="text-xs text-gray-400 mt-1 ml-0.5">
                        {formatDate(day.date)}
                      </p>
                    )}

                    <div className="flex items-center gap-3 mt-1.5">
                      {placeCount > 0 && (
                        <span className="text-xs text-gray-400">
                          {placeCount === 1 ? t('planner.placeOne') : t('planner.placeN', { n: placeCount })}
                        </span>
                      )}
                      {cost > 0 && (
                        <span className="text-xs text-emerald-600 font-medium">
                          {cost.toFixed(0)} {currency}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Weather for this day */}
                {day.date && isSelected && (
                  <div className="mt-2">
                    <WeatherWidget date={day.date} compact />
                  </div>
                )}
              </button>
            )
          })
        )}
      </div>

      {/* Budget summary footer */}
      {totalCost > 0 && (
        <div className="flex-shrink-0 border-t border-gray-100 px-4 py-3 bg-gray-50">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">{t('planner.totalCost')}</span>
            <span className="text-sm font-semibold text-gray-800">
              {totalCost.toFixed(2)} {currency}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
