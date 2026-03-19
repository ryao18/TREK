import React, { useState, useEffect } from 'react'
import { Info, X, Github, Shield, Key, Users, Database, ChevronDown, ChevronUp } from 'lucide-react'

export default function DemoBanner() {
  const [expanded, setExpanded] = useState(false)
  const [minutesLeft, setMinutesLeft] = useState(null)

  useEffect(() => {
    const update = () => {
      const now = new Date()
      setMinutesLeft(59 - now.getMinutes())
    }
    update()
    const interval = setInterval(update, 30000)
    return () => clearInterval(interval)
  }, [])

  const adminFeatures = [
    { icon: Key, text: 'API-Schluessel verwalten (Google Maps, Wetter)' },
    { icon: Users, text: 'Benutzer & Rechte verwalten' },
    { icon: Database, text: 'Automatische Backups & Wiederherstellung' },
    { icon: Shield, text: 'Registrierung & Sicherheitseinstellungen' },
  ]

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 300 }}>
      {/* Main banner bar */}
      <div style={{
        background: 'linear-gradient(135deg, #f59e0b, #d97706)',
        color: '#451a03',
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        fontSize: 13,
        fontWeight: 600,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
        minHeight: 36,
        boxShadow: '0 2px 8px rgba(217, 119, 6, 0.3)',
      }}>
        <Info size={15} style={{ flexShrink: 0 }} />
        <span>
          Demo-Modus
          <span style={{ fontWeight: 400, margin: '0 6px' }}>&middot;</span>
          Aenderungen werden stuendlich zurueckgesetzt
          {minutesLeft !== null && (
            <span style={{ fontWeight: 400, opacity: 0.8, marginLeft: 4 }}>
              (naechster Reset in ~{minutesLeft} Min.)
            </span>
          )}
        </span>
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            background: 'rgba(69, 26, 3, 0.15)',
            border: 'none',
            borderRadius: 6,
            padding: '3px 8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            color: '#451a03',
            fontSize: 12,
            fontWeight: 600,
            fontFamily: 'inherit',
            marginLeft: 4,
          }}
        >
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {expanded ? 'Weniger' : 'Mehr Info'}
        </button>
      </div>

      {/* Expanded info panel */}
      {expanded && (
        <div style={{
          background: '#fffbeb',
          borderBottom: '1px solid #fbbf24',
          padding: '16px 24px',
          fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        }}>
          <div style={{ maxWidth: 640, margin: '0 auto' }}>
            <p style={{ fontSize: 13, color: '#92400e', margin: '0 0 12px', lineHeight: 1.6 }}>
              Du nutzt die NOMAD Demo. Du kannst Reisen ansehen, bearbeiten und eigene erstellen —
              alles wird <strong>jede Stunde automatisch zurueckgesetzt</strong>.
            </p>

            <p style={{ fontSize: 12, fontWeight: 700, color: '#78350f', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Diese Funktionen sind in der Vollversion verfuegbar:
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 6 }}>
              {adminFeatures.map(({ icon: Icon, text }) => (
                <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#92400e' }}>
                  <Icon size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
                  <span>{text}</span>
                </div>
              ))}
            </div>

            <div style={{
              marginTop: 14,
              paddingTop: 12,
              borderTop: '1px solid #fde68a',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: '#92400e',
            }}>
              <Github size={14} />
              <span>NOMAD ist Open Source — </span>
              <a
                href="https://github.com/mauriceboe/NOMAD"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#78350f', fontWeight: 700, textDecoration: 'underline' }}
              >
                selbst hosten &rarr;
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
