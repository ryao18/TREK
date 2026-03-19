import React, { useState } from 'react'
import { Info, Github, Shield, Key, Users, Database, X } from 'lucide-react'
import { useTranslation } from '../../i18n'

const texts = {
  de: {
    title: 'Willkommen zur NOMAD Demo',
    description: 'Du kannst Reisen ansehen, bearbeiten und eigene erstellen. Alle Aenderungen werden jede Stunde automatisch zurueckgesetzt.',
    fullVersionTitle: 'In der Vollversion zusaetzlich verfuegbar:',
    features: [
      'API-Schluessel verwalten (Google Maps, Wetter)',
      'Benutzer & Rechte verwalten',
      'Automatische Backups & Wiederherstellung',
      'Registrierung & Sicherheitseinstellungen',
    ],
    selfHost: 'NOMAD ist Open Source — ',
    selfHostLink: 'selbst hosten',
    close: 'Verstanden',
  },
  en: {
    title: 'Welcome to the NOMAD Demo',
    description: 'You can view, edit and create trips. All changes are automatically reset every hour.',
    fullVersionTitle: 'Additionally available in the full version:',
    features: [
      'API key management (Google Maps, Weather)',
      'User & permission management',
      'Automatic backups & restore',
      'Registration & security settings',
    ],
    selfHost: 'NOMAD is open source — ',
    selfHostLink: 'self-host it',
    close: 'Got it',
  },
}

const featureIcons = [Key, Users, Database, Shield]

export default function DemoBanner() {
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem('demo_dismissed') === 'true')
  const { language } = useTranslation()
  const t = texts[language] || texts.en

  if (dismissed) return null

  const handleClose = () => {
    sessionStorage.setItem('demo_dismissed', 'true')
    setDismissed(true)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
    }} onClick={handleClose}>
      <div style={{
        background: 'white', borderRadius: 20, padding: '32px 28px 24px',
        maxWidth: 440, width: '100%',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }} onClick={e => e.stopPropagation()}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'linear-gradient(135deg, #f59e0b, #d97706)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Info size={20} style={{ color: 'white' }} />
          </div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#111827' }}>
            {t.title}
          </h2>
        </div>

        <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.6, margin: '0 0 20px' }}>
          {t.description}
        </p>

        <p style={{ fontSize: 12, fontWeight: 700, color: '#374151', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {t.fullVersionTitle}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          {t.features.map((text, i) => {
            const Icon = featureIcons[i]
            return (
              <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#4b5563' }}>
                <Icon size={15} style={{ flexShrink: 0, color: '#d97706' }} />
                <span>{text}</span>
              </div>
            )
          })}
        </div>

        <div style={{
          paddingTop: 16, borderTop: '1px solid #e5e7eb',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#9ca3af' }}>
            <Github size={14} />
            <span>{t.selfHost}</span>
            <a href="https://github.com/mauriceboe/NOMAD" target="_blank" rel="noopener noreferrer"
              style={{ color: '#d97706', fontWeight: 600, textDecoration: 'none' }}>
              {t.selfHostLink}
            </a>
          </div>

          <button onClick={handleClose} style={{
            background: '#111827', color: 'white', border: 'none',
            borderRadius: 10, padding: '8px 20px', fontSize: 13,
            fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            {t.close}
          </button>
        </div>
      </div>
    </div>
  )
}
