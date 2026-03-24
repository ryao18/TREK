import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Globe, MapPin, Plane } from 'lucide-react'
import { authApi } from '../../api/client'
import { useTranslation } from '../../i18n'
import { useSettingsStore } from '../../store/settingsStore'

// Numeric ISO → country name lookup (countries-110m uses numeric IDs)
const NUMERIC_TO_NAME = {"004":"Afghanistan","008":"Albania","012":"Algeria","024":"Angola","032":"Argentina","036":"Australia","040":"Austria","050":"Bangladesh","056":"Belgium","064":"Bhutan","068":"Bolivia","070":"Bosnia and Herzegovina","072":"Botswana","076":"Brazil","100":"Bulgaria","104":"Myanmar","108":"Burundi","112":"Belarus","116":"Cambodia","120":"Cameroon","124":"Canada","140":"Central African Republic","144":"Sri Lanka","148":"Chad","152":"Chile","156":"China","170":"Colombia","178":"Congo","180":"Democratic Republic of the Congo","188":"Costa Rica","191":"Croatia","192":"Cuba","196":"Cyprus","203":"Czech Republic","204":"Benin","208":"Denmark","214":"Dominican Republic","218":"Ecuador","818":"Egypt","222":"El Salvador","226":"Equatorial Guinea","232":"Eritrea","233":"Estonia","231":"Ethiopia","238":"Falkland Islands","246":"Finland","250":"France","266":"Gabon","270":"Gambia","268":"Georgia","276":"Germany","288":"Ghana","300":"Greece","320":"Guatemala","324":"Guinea","328":"Guyana","332":"Haiti","340":"Honduras","348":"Hungary","352":"Iceland","356":"India","360":"Indonesia","364":"Iran","368":"Iraq","372":"Ireland","376":"Israel","380":"Italy","384":"Ivory Coast","388":"Jamaica","392":"Japan","400":"Jordan","398":"Kazakhstan","404":"Kenya","408":"North Korea","410":"South Korea","414":"Kuwait","417":"Kyrgyzstan","418":"Laos","422":"Lebanon","426":"Lesotho","430":"Liberia","434":"Libya","440":"Lithuania","442":"Luxembourg","450":"Madagascar","454":"Malawi","458":"Malaysia","466":"Mali","478":"Mauritania","484":"Mexico","496":"Mongolia","498":"Moldova","504":"Morocco","508":"Mozambique","516":"Namibia","524":"Nepal","528":"Netherlands","540":"New Caledonia","554":"New Zealand","558":"Nicaragua","562":"Niger","566":"Nigeria","578":"Norway","512":"Oman","586":"Pakistan","591":"Panama","598":"Papua New Guinea","600":"Paraguay","604":"Peru","608":"Philippines","616":"Poland","620":"Portugal","630":"Puerto Rico","634":"Qatar","642":"Romania","643":"Russia","646":"Rwanda","682":"Saudi Arabia","686":"Senegal","688":"Serbia","694":"Sierra Leone","703":"Slovakia","705":"Slovenia","706":"Somalia","710":"South Africa","724":"Spain","729":"Sudan","740":"Suriname","748":"Swaziland","752":"Sweden","756":"Switzerland","760":"Syria","762":"Tajikistan","764":"Thailand","768":"Togo","780":"Trinidad and Tobago","788":"Tunisia","792":"Turkey","795":"Turkmenistan","800":"Uganda","804":"Ukraine","784":"United Arab Emirates","826":"United Kingdom","840":"United States of America","858":"Uruguay","860":"Uzbekistan","862":"Venezuela","704":"Vietnam","887":"Yemen","894":"Zambia","716":"Zimbabwe"}

// Our country names from addresses → match against GeoJSON names
function isCountryMatch(geoName, visitedCountries) {
  if (!geoName) return false
  const lower = geoName.toLowerCase()
  return visitedCountries.some(c => {
    const cl = c.toLowerCase()
    return lower === cl || lower.includes(cl) || cl.includes(lower)
      // Handle common mismatches
      || (cl === 'usa' && lower.includes('united states'))
      || (cl === 'uk' && lower === 'united kingdom')
      || (cl === 'south korea' && lower === 'korea' || lower === 'south korea')
      || (cl === 'deutschland' && lower === 'germany')
      || (cl === 'frankreich' && lower === 'france')
      || (cl === 'italien' && lower === 'italy')
      || (cl === 'spanien' && lower === 'spain')
      || (cl === 'österreich' && lower === 'austria')
      || (cl === 'schweiz' && lower === 'switzerland')
      || (cl === 'niederlande' && lower === 'netherlands')
      || (cl === 'türkei' && (lower === 'turkey' || lower === 'türkiye'))
      || (cl === 'griechenland' && lower === 'greece')
      || (cl === 'tschechien' && (lower === 'czech republic' || lower === 'czechia'))
      || (cl === 'ägypten' && lower === 'egypt')
      || (cl === 'südkorea' && lower.includes('korea'))
      || (cl === 'indien' && lower === 'india')
      || (cl === 'brasilien' && lower === 'brazil')
      || (cl === 'argentinien' && lower === 'argentina')
      || (cl === 'russland' && lower === 'russia')
      || (cl === 'australien' && lower === 'australia')
      || (cl === 'kanada' && lower === 'canada')
      || (cl === 'mexiko' && lower === 'mexico')
      || (cl === 'neuseeland' && lower === 'new zealand')
      || (cl === 'singapur' && lower === 'singapore')
      || (cl === 'kroatien' && lower === 'croatia')
      || (cl === 'ungarn' && lower === 'hungary')
      || (cl === 'rumänien' && lower === 'romania')
      || (cl === 'polen' && lower === 'poland')
      || (cl === 'schweden' && lower === 'sweden')
      || (cl === 'norwegen' && lower === 'norway')
      || (cl === 'dänemark' && lower === 'denmark')
      || (cl === 'finnland' && lower === 'finland')
      || (cl === 'irland' && lower === 'ireland')
      || (cl === 'portugal' && lower === 'portugal')
      || (cl === 'belgien' && lower === 'belgium')
  })
}

const TOTAL_COUNTRIES = 195

// Simple Mercator projection for SVG
function project(lon, lat, width, height) {
  const clampedLat = Math.max(-75, Math.min(83, lat))
  const x = ((lon + 180) / 360) * width
  const latRad = (clampedLat * Math.PI) / 180
  const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2))
  const y = (height / 2) - (width * mercN) / (2 * Math.PI)
  return [x, y]
}

function geoToPath(coords, width, height) {
  return coords.map((ring) => {
    // Split ring at dateline crossings to avoid horizontal stripes
    const segments = [[]]
    for (let i = 0; i < ring.length; i++) {
      const [lon, lat] = ring[i]
      if (i > 0) {
        const prevLon = ring[i - 1][0]
        if (Math.abs(lon - prevLon) > 180) {
          // Dateline crossing — start new segment
          segments.push([])
        }
      }
      const [x, y] = project(lon, Math.max(-75, Math.min(83, lat)), width, height)
      segments[segments.length - 1].push(`${x.toFixed(1)},${y.toFixed(1)}`)
    }
    return segments
      .filter(s => s.length > 2)
      .map(s => 'M' + s.join('L') + 'Z')
      .join(' ')
  }).join(' ')
}

let geoJsonCache = null
async function loadGeoJson() {
  if (geoJsonCache) return geoJsonCache
  try {
    const res = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
    const topo = await res.json()
    const { feature } = await import('topojson-client')
    const geo = feature(topo, topo.objects.countries)
    geo.features.forEach(f => {
      f.properties.name = NUMERIC_TO_NAME[f.id] || f.properties?.name || ''
    })
    geoJsonCache = geo
    return geo
  } catch { return null }
}

export default function TravelStats() {
  const { t } = useTranslation()
  const dm = useSettingsStore(s => s.settings.dark_mode)
  const dark = dm === true || dm === 'dark' || (dm === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const [stats, setStats] = useState(null)
  const [geoData, setGeoData] = useState(null)

  useEffect(() => {
    authApi.travelStats().then(setStats).catch(() => {})
    loadGeoJson().then(setGeoData)
  }, [])

  const countryCount = stats?.countries?.length || 0
  const worldPercent = ((countryCount / TOTAL_COUNTRIES) * 100).toFixed(1)

  if (!stats || stats.totalPlaces === 0) return null

  return (
    <div style={{ width: 340 }}>
      {/* Stats Card */}
      <div style={{
        borderRadius: 20, overflow: 'hidden', height: 300,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        border: '1px solid var(--border-primary)',
        background: 'var(--bg-card)',
        padding: 16,
      }}>
        {/* Progress bar */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{t('stats.worldProgress')}</span>
            <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>{worldPercent}%</span>
          </div>
          <div style={{ height: 6, borderRadius: 99, background: 'var(--bg-hover)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 99,
              background: dark ? 'linear-gradient(90deg, #e2e8f0, #cbd5e1)' : 'linear-gradient(90deg, #111827, #374151)',
              width: `${Math.max(1, parseFloat(worldPercent))}%`,
              transition: 'width 0.5s ease',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{countryCount} {t('stats.visited')}</span>
            <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{TOTAL_COUNTRIES - countryCount} {t('stats.remaining')}</span>
          </div>
        </div>

        {/* Stat grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
          <StatBox icon={Globe} value={countryCount} label={t('stats.countries')} />
          <StatBox icon={MapPin} value={stats.cities.length} label={t('stats.cities')} />
          <StatBox icon={Plane} value={stats.totalTrips} label={t('stats.trips')} />
          <StatBox icon={MapPin} value={stats.totalPlaces} label={t('stats.places')} />
        </div>

        {/* Country tags */}
        {stats.countries.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>{t('stats.visitedCountries')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {stats.countries.map(c => (
                <span key={c} style={{
                  fontSize: 10.5, fontWeight: 500, color: 'var(--text-secondary)',
                  background: 'var(--bg-hover)', borderRadius: 99, padding: '3px 9px',
                }}>{c}</span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function StatBox({ icon: Icon, value, label }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
      borderRadius: 10, background: 'var(--bg-hover)',
    }}>
      <Icon size={14} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 1 }}>{label}</div>
      </div>
    </div>
  )
}
