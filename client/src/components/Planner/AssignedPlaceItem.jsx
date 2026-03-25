import React from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, X, Edit2, Clock, DollarSign, MapPin } from 'lucide-react'

export default function AssignedPlaceItem({ assignment, dayId, onRemove, onEdit }) {
  const { place } = assignment

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `assignment-${assignment.id}`,
    data: {
      type: 'assignment',
      dayId: dayId,
      assignment,
    },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        group bg-white border rounded-lg p-2.5 transition-all
        ${isDragging
          ? 'opacity-40 border-slate-300 shadow-lg'
          : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'
        }
      `}
    >
      <div className="flex items-start gap-2">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="drag-handle mt-0.5 p-0.5 text-slate-300 hover:text-slate-500 flex-shrink-0 rounded touch-none"
          tabIndex={-1}
        >
          <GripVertical className="w-4 h-4" />
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Name row */}
          <div className="flex items-center gap-1.5 mb-1">
            {place.category && (
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: place.category.color || '#6366f1' }}
              />
            )}
            <span className="text-sm font-medium text-slate-800 truncate">{place.name}</span>
          </div>

          {/* Time & price row */}
          <div className="flex items-center gap-2 mb-1">
            {place.place_time && (
              <span className="flex items-center gap-1 text-xs text-slate-600 bg-slate-50 px-1.5 py-0.5 rounded">
                <Clock className="w-3 h-3" />
                {place.place_time}
              </span>
            )}
            {place.price != null && (
              <span className="flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                <DollarSign className="w-3 h-3" />
                {Number(place.price).toLocaleString()} {place.currency || ''}
              </span>
            )}
          </div>

          {/* Address */}
          {place.address && (
            <p className="text-xs text-slate-400 truncate flex items-center gap-1">
              <MapPin className="w-3 h-3 flex-shrink-0" />
              {place.address}
            </p>
          )}

          {/* Category badge */}
          {place.category && (
            <span
              className="inline-block mt-1 text-xs px-1.5 py-0.5 rounded text-white text-[10px] font-medium"
              style={{ backgroundColor: place.category.color || '#6366f1' }}
            >
              {place.category.name}
            </span>
          )}

          {/* Tags */}
          {place.tags && place.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {place.tags.map(tag => (
                <span
                  key={tag.id}
                  className="text-[10px] px-1.5 py-0.5 rounded-full text-white font-medium"
                  style={{ backgroundColor: tag.color || '#6366f1' }}
                >
                  {tag.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          {onEdit && (
            <button
              onClick={() => onEdit(place, assignment.id)}
              className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors"
              title="Edit place"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => onRemove(assignment.id)}
            className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
            title="Remove from day"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
