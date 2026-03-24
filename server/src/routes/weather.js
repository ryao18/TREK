const express = require('express');
const fetch = require('node-fetch');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// --------------- In-memory weather cache ---------------
const weatherCache = new Map();

const TTL_FORECAST_MS = 60 * 60 * 1000;   // 1 hour
const TTL_CURRENT_MS  = 15 * 60 * 1000;   // 15 minutes
const TTL_CLIMATE_MS  = 24 * 60 * 60 * 1000; // 24 hours (historical data doesn't change)

function cacheKey(lat, lng, date) {
  const rlat = parseFloat(lat).toFixed(2);
  const rlng = parseFloat(lng).toFixed(2);
  return `${rlat}_${rlng}_${date || 'current'}`;
}

function getCached(key) {
  const entry = weatherCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    weatherCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data, ttlMs) {
  weatherCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// WMO weather code mapping → condition string used by client icon map
const WMO_MAP = {
  0: 'Clear',
  1: 'Clear',          // mainly clear
  2: 'Clouds',         // partly cloudy
  3: 'Clouds',         // overcast
  45: 'Fog',
  48: 'Fog',
  51: 'Drizzle',
  53: 'Drizzle',
  55: 'Drizzle',
  56: 'Drizzle',       // freezing drizzle
  57: 'Drizzle',
  61: 'Rain',
  63: 'Rain',
  65: 'Rain',          // heavy rain
  66: 'Rain',          // freezing rain
  67: 'Rain',
  71: 'Snow',
  73: 'Snow',
  75: 'Snow',
  77: 'Snow',          // snow grains
  80: 'Rain',          // rain showers
  81: 'Rain',
  82: 'Rain',
  85: 'Snow',          // snow showers
  86: 'Snow',
  95: 'Thunderstorm',
  96: 'Thunderstorm',
  99: 'Thunderstorm',
};

const WMO_DESCRIPTION_DE = {
  0: 'Klar',
  1: 'Überwiegend klar',
  2: 'Teilweise bewölkt',
  3: 'Bewölkt',
  45: 'Nebel',
  48: 'Nebel mit Reif',
  51: 'Leichter Nieselregen',
  53: 'Nieselregen',
  55: 'Starker Nieselregen',
  56: 'Gefrierender Nieselregen',
  57: 'Starker gefr. Nieselregen',
  61: 'Leichter Regen',
  63: 'Regen',
  65: 'Starker Regen',
  66: 'Gefrierender Regen',
  67: 'Starker gefr. Regen',
  71: 'Leichter Schneefall',
  73: 'Schneefall',
  75: 'Starker Schneefall',
  77: 'Schneekörner',
  80: 'Leichte Regenschauer',
  81: 'Regenschauer',
  82: 'Starke Regenschauer',
  85: 'Leichte Schneeschauer',
  86: 'Starke Schneeschauer',
  95: 'Gewitter',
  96: 'Gewitter mit Hagel',
  99: 'Starkes Gewitter mit Hagel',
};

const WMO_DESCRIPTION_EN = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Freezing drizzle',
  57: 'Heavy freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Heavy freezing rain',
  71: 'Light snowfall',
  73: 'Snowfall',
  75: 'Heavy snowfall',
  77: 'Snow grains',
  80: 'Light rain showers',
  81: 'Rain showers',
  82: 'Heavy rain showers',
  85: 'Light snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Severe thunderstorm with hail',
};

// Estimate weather condition from average temperature + precipitation
function estimateCondition(tempAvg, precipMm) {
  if (precipMm > 5) return tempAvg <= 0 ? 'Snow' : 'Rain';
  if (precipMm > 1) return tempAvg <= 0 ? 'Snow' : 'Drizzle';
  if (precipMm > 0.3) return 'Clouds';
  return tempAvg > 15 ? 'Clear' : 'Clouds';
}
// -------------------------------------------------------

// GET /api/weather?lat=&lng=&date=&lang=de
router.get('/', authenticate, async (req, res) => {
  const { lat, lng, date, lang = 'de' } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'Breiten- und Längengrad sind erforderlich' });
  }

  const ck = cacheKey(lat, lng, date);

  try {
    // ── Forecast for a specific date ──
    if (date) {
      const cached = getCached(ck);
      if (cached) return res.json(cached);

      const targetDate = new Date(date);
      const now = new Date();
      const diffDays = (targetDate - now) / (1000 * 60 * 60 * 24);

      // Within 16-day forecast window → real forecast
      if (diffDays >= -1 && diffDays <= 16) {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=temperature_2m_max,temperature_2m_min,weathercode&timezone=auto&forecast_days=16`;
        const response = await fetch(url);
        const data = await response.json();

        if (!response.ok || data.error) {
          return res.status(response.status || 500).json({ error: data.reason || 'Open-Meteo API Fehler' });
        }

        const dateStr = targetDate.toISOString().slice(0, 10);
        const idx = (data.daily?.time || []).indexOf(dateStr);

        if (idx !== -1) {
          const code = data.daily.weathercode[idx];
          const descriptions = lang === 'de' ? WMO_DESCRIPTION_DE : WMO_DESCRIPTION_EN;

          const result = {
            temp: Math.round((data.daily.temperature_2m_max[idx] + data.daily.temperature_2m_min[idx]) / 2),
            temp_max: Math.round(data.daily.temperature_2m_max[idx]),
            temp_min: Math.round(data.daily.temperature_2m_min[idx]),
            main: WMO_MAP[code] || 'Clouds',
            description: descriptions[code] || '',
            type: 'forecast',
          };

          setCache(ck, result, TTL_FORECAST_MS);
          return res.json(result);
        }
        // Forecast didn't include this date — fall through to climate
      }

      // Beyond forecast range or forecast gap → historical climate average
      if (diffDays > -1) {
        const month = targetDate.getMonth() + 1;
        const day = targetDate.getDate();
        // Query a 5-day window around the target date for smoother averages (using last year as reference)
        const refYear = targetDate.getFullYear() - 1;
        const startDate = new Date(refYear, month - 1, day - 2);
        const endDate = new Date(refYear, month - 1, day + 2);
        const startStr = startDate.toISOString().slice(0, 10);
        const endStr = endDate.toISOString().slice(0, 10);

        const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${startStr}&end_date=${endStr}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`;
        const response = await fetch(url);
        const data = await response.json();

        if (!response.ok || data.error) {
          return res.status(response.status || 500).json({ error: data.reason || 'Open-Meteo Climate API Fehler' });
        }

        const daily = data.daily;
        if (!daily || !daily.time || daily.time.length === 0) {
          return res.json({ error: 'no_forecast' });
        }

        // Average across the window
        let sumMax = 0, sumMin = 0, sumPrecip = 0, count = 0;
        for (let i = 0; i < daily.time.length; i++) {
          if (daily.temperature_2m_max[i] != null && daily.temperature_2m_min[i] != null) {
            sumMax += daily.temperature_2m_max[i];
            sumMin += daily.temperature_2m_min[i];
            sumPrecip += daily.precipitation_sum[i] || 0;
            count++;
          }
        }

        if (count === 0) {
          return res.json({ error: 'no_forecast' });
        }

        const avgMax = sumMax / count;
        const avgMin = sumMin / count;
        const avgTemp = (avgMax + avgMin) / 2;
        const avgPrecip = sumPrecip / count;
        const main = estimateCondition(avgTemp, avgPrecip);

        const result = {
          temp: Math.round(avgTemp),
          temp_max: Math.round(avgMax),
          temp_min: Math.round(avgMin),
          main,
          description: '',
          type: 'climate',
        };

        setCache(ck, result, TTL_CLIMATE_MS);
        return res.json(result);
      }

      // Past dates beyond yesterday
      return res.json({ error: 'no_forecast' });
    }

    // ── Current weather (no date) ──
    const cached = getCached(ck);
    if (cached) return res.json(cached);

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weathercode&timezone=auto`;
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok || data.error) {
      return res.status(response.status || 500).json({ error: data.reason || 'Open-Meteo API Fehler' });
    }

    const code = data.current.weathercode;
    const descriptions = lang === 'de' ? WMO_DESCRIPTION_DE : WMO_DESCRIPTION_EN;

    const result = {
      temp: Math.round(data.current.temperature_2m),
      main: WMO_MAP[code] || 'Clouds',
      description: descriptions[code] || '',
      type: 'current',
    };

    setCache(ck, result, TTL_CURRENT_MS);
    res.json(result);
  } catch (err) {
    console.error('Weather error:', err);
    res.status(500).json({ error: 'Fehler beim Abrufen der Wetterdaten' });
  }
});

module.exports = router;
