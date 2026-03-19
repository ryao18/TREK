const express = require('express');
const fetch = require('node-fetch');
const { db } = require('../db/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Get API key: user's own key, or fall back to any admin's key
function getMapsKey(userId) {
  const user = db.prepare('SELECT maps_api_key FROM users WHERE id = ?').get(userId);
  if (user?.maps_api_key) return user.maps_api_key;
  const admin = db.prepare("SELECT maps_api_key FROM users WHERE role = 'admin' AND maps_api_key IS NOT NULL AND maps_api_key != '' LIMIT 1").get();
  return admin?.maps_api_key || null;
}

// In-memory photo cache: placeId → { photoUrl, attribution, fetchedAt }
const photoCache = new Map();
const PHOTO_TTL = 12 * 60 * 60 * 1000; // 12 hours

// POST /api/maps/search
router.post('/search', authenticate, async (req, res) => {
  const { query } = req.body;

  if (!query) return res.status(400).json({ error: 'Suchanfrage ist erforderlich' });

  const apiKey = getMapsKey(req.user.id);
  if (!apiKey) {
    return res.status(400).json({ error: 'Google Maps API-Schlüssel nicht konfiguriert. Bitte in den Einstellungen hinzufügen.' });
  }

  try {
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.websiteUri,places.nationalPhoneNumber,places.types',
      },
      body: JSON.stringify({ textQuery: query, languageCode: req.query.lang || 'en' }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Google Places API Fehler' });
    }

    const places = (data.places || []).map(p => ({
      google_place_id: p.id,
      name: p.displayName?.text || '',
      address: p.formattedAddress || '',
      lat: p.location?.latitude || null,
      lng: p.location?.longitude || null,
      rating: p.rating || null,
      website: p.websiteUri || null,
      phone: p.nationalPhoneNumber || null,
    }));

    res.json({ places });
  } catch (err) {
    console.error('Maps search error:', err);
    res.status(500).json({ error: 'Fehler bei der Google Places Suche' });
  }
});

// GET /api/maps/details/:placeId
router.get('/details/:placeId', authenticate, async (req, res) => {
  const { placeId } = req.params;

  const apiKey = getMapsKey(req.user.id);
  if (!apiKey) {
    return res.status(400).json({ error: 'Google Maps API-Schlüssel nicht konfiguriert' });
  }

  try {
    const lang = req.query.lang || 'de'
    const response = await fetch(`https://places.googleapis.com/v1/places/${placeId}?languageCode=${lang}`, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'id,displayName,formattedAddress,location,rating,userRatingCount,websiteUri,nationalPhoneNumber,regularOpeningHours,googleMapsUri,reviews,editorialSummary',
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Google Places API Fehler' });
    }

    const place = {
      google_place_id: data.id,
      name: data.displayName?.text || '',
      address: data.formattedAddress || '',
      lat: data.location?.latitude || null,
      lng: data.location?.longitude || null,
      rating: data.rating || null,
      rating_count: data.userRatingCount || null,
      website: data.websiteUri || null,
      phone: data.nationalPhoneNumber || null,
      opening_hours: data.regularOpeningHours?.weekdayDescriptions || null,
      open_now: data.regularOpeningHours?.openNow ?? null,
      google_maps_url: data.googleMapsUri || null,
      summary: data.editorialSummary?.text || null,
      reviews: (data.reviews || []).slice(0, 5).map(r => ({
        author: r.authorAttribution?.displayName || null,
        rating: r.rating || null,
        text: r.text?.text || null,
        time: r.relativePublishTimeDescription || null,
        photo: r.authorAttribution?.photoUri || null,
      })),
    };

    res.json({ place });
  } catch (err) {
    console.error('Maps details error:', err);
    res.status(500).json({ error: 'Fehler beim Abrufen der Ortsdetails' });
  }
});

// GET /api/maps/place-photo/:placeId
// Proxies a Google Places photo (hides API key from client). Returns { photoUrl, attribution }.
router.get('/place-photo/:placeId', authenticate, async (req, res) => {
  const { placeId } = req.params;

  // Check TTL cache
  const cached = photoCache.get(placeId);
  if (cached && Date.now() - cached.fetchedAt < PHOTO_TTL) {
    return res.json({ photoUrl: cached.photoUrl, attribution: cached.attribution });
  }

  const apiKey = getMapsKey(req.user.id);
  if (!apiKey) {
    return res.status(400).json({ error: 'Google Maps API-Schlüssel nicht konfiguriert' });
  }

  try {
    // Fetch place details to get photo reference
    const detailsRes = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'photos',
      },
    });
    const details = await detailsRes.json();

    if (!detailsRes.ok) {
      console.error('Google Places photo details error:', details.error?.message || detailsRes.status);
      return res.status(404).json({ error: 'Foto konnte nicht abgerufen werden' });
    }

    if (!details.photos?.length) {
      return res.status(404).json({ error: 'Kein Foto verfügbar' });
    }

    const photo = details.photos[0];
    const photoName = photo.name;
    const attribution = photo.authorAttributions?.[0]?.displayName || null;

    // Fetch the media URL (skipHttpRedirect returns JSON with photoUri)
    const mediaRes = await fetch(
      `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=600&key=${apiKey}&skipHttpRedirect=true`
    );
    const mediaData = await mediaRes.json();
    const photoUrl = mediaData.photoUri;

    if (!photoUrl) {
      return res.status(404).json({ error: 'Foto-URL nicht verfügbar' });
    }

    photoCache.set(placeId, { photoUrl, attribution, fetchedAt: Date.now() });

    // Persist the photo URL to all places with this google_place_id so future
    // loads serve image_url directly without hitting the Google API again.
    try {
      db.prepare(
        'UPDATE places SET image_url = ?, updated_at = CURRENT_TIMESTAMP WHERE google_place_id = ? AND (image_url IS NULL OR image_url = ?)'
      ).run(photoUrl, placeId, '');
    } catch (dbErr) {
      console.error('Failed to persist photo URL to database:', dbErr);
    }

    res.json({ photoUrl, attribution });
  } catch (err) {
    console.error('Place photo error:', err);
    res.status(500).json({ error: 'Fehler beim Abrufen des Fotos' });
  }
});

module.exports = router;
