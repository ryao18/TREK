import React, { useMemo, useState, useCallback, useRef } from 'react'
import { useVacayStore } from '../../store/vacayStore'
import { useTranslation } from '../../i18n'
import { isWeekend } from './holidays'
import VacayMonthCard from './VacayMonthCard'
import { Building2, MousePointer2 } from 'lucide-react'

export default function VacayCalendar() {
  const { t } = useTranslation()
  const { selectedYear, selectedUserId, entries, companyHolidays, toggleEntry, toggleCompanyHoliday, plan, users, holidays } = useVacayStore()
  const [companyMode, setCompanyMode] = useState(false)

  const companyHolidaySet = useMemo(() => {
    const s = new Set()
    companyHolidays.forEach(h => s.add(h.date))
    return s
  }, [companyHolidays])

  const entryMap = useMemo(() => {
    const map = {}
    entries.forEach(e => {
      if (!map[e.date]) map[e.date] = []
      map[e.date].push(e)
    })
    return map
  }, [entries])

  const blockWeekends = plan?.block_weekends !== false
  const companyHolidaysEnabled = plan?.company_holidays_enabled !== false

  // Drag-to-paint state
  const isDragging = useRef(false)
  const dragAction = useRef(null) // 'add' or 'remove'
  const dragProcessed = useRef(new Set())

  const isDayBlocked = useCallback((dateStr) => {
    if (holidays[dateStr]) return true
    if (blockWeekends && isWeekend(dateStr)) return true
    if (companyHolidaysEnabled && companyHolidaySet.has(dateStr) && !companyMode) return true
    return false
  }, [holidays, blockWeekends, companyHolidaySet, companyHolidaysEnabled, companyMode])

  const handleCellMouseDown = useCallback((dateStr) => {
    if (isDayBlocked(dateStr) && !companyMode) return
    isDragging.current = true
    dragProcessed.current = new Set([dateStr])

    if (companyMode) {
      dragAction.current = companyHolidaySet.has(dateStr) ? 'remove' : 'add'
      toggleCompanyHoliday(dateStr)
    } else {
      const hasEntry = (entryMap[dateStr] || []).some(e => e.user_id === (selectedUserId || undefined))
      dragAction.current = hasEntry ? 'remove' : 'add'
      toggleEntry(dateStr, selectedUserId || undefined)
    }
  }, [companyMode, isDayBlocked, toggleEntry, toggleCompanyHoliday, entryMap, companyHolidaySet, selectedUserId])

  const handleCellMouseEnter = useCallback((dateStr) => {
    if (!isDragging.current) return
    if (dragProcessed.current.has(dateStr)) return
    if (isDayBlocked(dateStr) && !companyMode) return
    dragProcessed.current.add(dateStr)

    if (companyMode) {
      const isSet = companyHolidaySet.has(dateStr)
      if ((dragAction.current === 'add' && !isSet) || (dragAction.current === 'remove' && isSet)) {
        toggleCompanyHoliday(dateStr)
      }
    } else {
      const hasEntry = (entryMap[dateStr] || []).some(e => e.user_id === (selectedUserId || undefined))
      if ((dragAction.current === 'add' && !hasEntry) || (dragAction.current === 'remove' && hasEntry)) {
        toggleEntry(dateStr, selectedUserId || undefined)
      }
    }
  }, [companyMode, isDayBlocked, toggleEntry, toggleCompanyHoliday, entryMap, companyHolidaySet, selectedUserId])

  const handleMouseUp = useCallback(() => {
    isDragging.current = false
    dragAction.current = null
    dragProcessed.current.clear()
  }, [])

  // Also handle click for single taps (touch/accessibility)
  const handleCellClick = useCallback(async (dateStr) => {
    // Already handled by mousedown for mouse users, this is fallback for touch
    if (isDragging.current) return
    if (companyMode) {
      if (!companyHolidaysEnabled) return
      await toggleCompanyHoliday(dateStr)
      return
    }
    if (isDayBlocked(dateStr)) return
    await toggleEntry(dateStr, selectedUserId || undefined)
  }, [companyMode, toggleEntry, toggleCompanyHoliday, companyHolidaysEnabled, isDayBlocked, selectedUserId])

  const selectedUser = users.find(u => u.id === selectedUserId)

  return (
    <div onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} style={{ userSelect: 'none' }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {Array.from({ length: 12 }, (_, i) => (
          <VacayMonthCard
            key={i}
            year={selectedYear}
            month={i}
            holidays={holidays}
            companyHolidaySet={companyHolidaySet}
            companyHolidaysEnabled={companyHolidaysEnabled}
            entryMap={entryMap}
            onCellClick={handleCellClick}
            onCellMouseDown={handleCellMouseDown}
            onCellMouseEnter={handleCellMouseEnter}
            companyMode={companyMode}
            blockWeekends={blockWeekends}
          />
        ))}
      </div>

      {/* Floating toolbar */}
      <div className="sticky bottom-3 sm:bottom-4 mt-3 sm:mt-4 flex items-center justify-center z-30 px-2">
        <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 rounded-xl border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-primary)', boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}>
          <button
            onClick={() => setCompanyMode(false)}
            className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-medium transition-all"
            style={{
              background: !companyMode ? 'var(--text-primary)' : 'transparent',
              color: !companyMode ? 'var(--bg-card)' : 'var(--text-muted)',
              border: companyMode ? '1px solid var(--border-primary)' : '1px solid transparent',
            }}>
            <MousePointer2 size={13} />
            {selectedUser && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: selectedUser.color }} />}
            {selectedUser ? selectedUser.username : t('vacay.modeVacation')}
          </button>
          {companyHolidaysEnabled && (
            <button
              onClick={() => setCompanyMode(true)}
              className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-medium transition-all"
              style={{
                background: companyMode ? '#d97706' : 'transparent',
                color: companyMode ? '#fff' : 'var(--text-muted)',
                border: !companyMode ? '1px solid var(--border-primary)' : '1px solid transparent',
              }}>
              <Building2 size={13} />
              {t('vacay.modeCompany')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
