import React from 'react'
import { useAuthStore } from '../../store/authStore'
import CollabChat from './CollabChat'
import CollabNotes from './CollabNotes'
import CollabPolls from './CollabPolls'

export default function CollabPanel({ tripId }) {
  const { user } = useAuthStore()

  return (
    <div style={{ height: '100%', overflowY: 'auto', overscrollBehavior: 'contain', fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '16px' }}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" style={{ alignItems: 'start' }}>

          {/* Chat — takes 1 column, full height */}
          <div style={{ background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border-faint)', overflow: 'hidden', height: 500 }}>
            <CollabChat tripId={tripId} currentUser={user} />
          </div>

          {/* Notes — takes 1 column */}
          <div style={{ background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border-faint)', overflow: 'hidden', maxHeight: 500, display: 'flex', flexDirection: 'column' }}>
            <CollabNotes tripId={tripId} currentUser={user} />
          </div>

          {/* Polls — takes 1 column */}
          <div style={{ background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border-faint)', overflow: 'hidden', maxHeight: 500, display: 'flex', flexDirection: 'column' }}>
            <CollabPolls tripId={tripId} currentUser={user} />
          </div>

        </div>
      </div>
    </div>
  )
}
