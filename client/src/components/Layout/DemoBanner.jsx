import React, { useState, useEffect } from 'react'
import { Info, Github, Shield, Key, Users, Database, ChevronDown, ChevronUp } from 'lucide-react'
import { useTranslation } from '../../i18n'

const texts = {
  de: {
    title: 'Demo-Modus',
    resetInfo: 'Aenderungen werden stuendlich zurueckgesetzt',
    nextReset: 'naechster Reset in ~{min} Min.',
    moreInfo: 'Mehr Info',
    lessInfo: 'Weniger',
    description: 'Du nutzt die NOMAD Demo. Du kannst Reisen ansehen, bearbeiten und eigene erstellen — alles wird jede Stunde automatisch zurueckgesetzt.',
    fullVersionTitle: 'Diese Funktionen sind in der Vollversion verfuegbar:',
    features: [
      'API-Schluessel verwalten (Google Maps, Wetter)',
      'Benutzer & Rechte verwalten',
      'Automatische Backups & Wiederherstellung',
      'Registrierung & Sicherheitseinstellungen',
    ],
    selfHost: 'NOMAD ist Open Source — ',
    selfHostLink: 'selbst hosten',
  },
  en: {
    title: 'Demo Mode',
    resetInfo: 'Changes are reset every hour',
    nextReset: 'next reset in ~{min} min.',
    moreInfo: 'More info',
    lessInfo: 'Less',
    description: 'You are using the NOMAD demo. You can view, edit and create trips — everything is automatically reset every hour.',
    fullVersionTitle: 'These features are available in the full version:',
    features: [
      'API key management (Google Maps, Weather)',
      'User & permission management',
      'Automatic backups & restore',
      'Registration & security settings',
    ],
    selfHost: 'NOMAD is open source — ',
    selfHostLink: 'self-host it',
  },
}

const featureIcons = [Key, Users, Database, Shield]

export default function DemoBanner() {
  const [expanded, setExpanded] = useState(false)
  const [minutesLeft, setMinutesLeft] = useState(null)
  const { language } = useTranslation()
  const t = texts[language] || texts.en

  useEffect(() => {
    const update = () => setMinutesLeft(59 - new Date().getMinutes())
    update()
    const interval = setInterval(update, 30000)
    return () => clearInterval(interval)
  }, [])

  const bannerHeight = expanded ? undefined : 36

  return (
    <div style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', zIndex: 300 }}>
      {/* Main banner bar */}
      <div style={{
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
      }}>
        <Info size={15} style={{ flexShrink: 0 }} />
        <span>
          {t.title}
          <span style={{ fontWeight: 400, margin: '0 6px' }}>&middot;</span>
          {t.resetInfo}
          {minutesLeft !== null && (
            <span style={{ fontWeight: 400, opacity: 0.8, marginLeft: 4 }}>
              ({t.nextReset.replace('{min}', minutesLeft)})
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
          {expanded ? t.lessInfo : t.moreInfo}
        </button>
      </div>

      {/* Expanded info panel */}
      {expanded && (
        <div style={{
          background: '#fffbeb',
          borderBottom: '1px solid #fbbf24',
          padding: '16px 24px',
          fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
        }}>
          <div style={{ maxWidth: 640, margin: '0 auto' }}>
            <p style={{ fontSize: 13, color: '#92400e', margin: '0 0 12px', lineHeight: 1.6 }}>
              {t.description}
            </p>

            <p style={{ fontSize: 12, fontWeight: 700, color: '#78350f', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {t.fullVersionTitle}
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 6 }}>
              {t.features.map((text, i) => {
                const Icon = featureIcons[i]
                return (
                  <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#92400e' }}>
                    <Icon size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
                    <span>{text}</span>
                  </div>
                )
              })}
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
              <span>{t.selfHost}</span>
              <a
                href="https://github.com/mauriceboe/NOMAD"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#78350f', fontWeight: 700, textDecoration: 'underline' }}
              >
                {t.selfHostLink} &rarr;
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
