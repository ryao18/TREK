import { db } from '../db/database';
import { PlaceExternalData } from '../types';

function parseTypes(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
  } catch {
    return [];
  }
}

export function getPlaceExternalData(placeId: number): (PlaceExternalData & { external_types: string[] }) | null {
  const row = db.prepare('SELECT * FROM place_external_data WHERE place_id = ?').get(placeId) as PlaceExternalData | undefined;
  if (!row) return null;
  return {
    ...row,
    external_types: parseTypes(row.types_json),
  };
}

export function upsertPlaceExternalData(
  placeId: number,
  data: {
    source?: string;
    external_types?: string[];
    website?: string | null;
    phone?: string | null;
    rating?: number | null;
    rating_count?: number | null;
  },
): (PlaceExternalData & { external_types: string[] }) | null {
  db.prepare(`
    INSERT INTO place_external_data (
      place_id, source, types_json, website, phone, rating, rating_count, last_synced_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(place_id) DO UPDATE SET
      source = excluded.source,
      types_json = excluded.types_json,
      website = excluded.website,
      phone = excluded.phone,
      rating = excluded.rating,
      rating_count = excluded.rating_count,
      last_synced_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    placeId,
    data.source || 'google_places',
    JSON.stringify(data.external_types || []),
    data.website ?? null,
    data.phone ?? null,
    data.rating ?? null,
    data.rating_count ?? null,
  );

  return getPlaceExternalData(placeId);
}

export function persistPlaceGooglePlaceId(placeId: number, googlePlaceId: string): void {
  db.prepare(`
    UPDATE places
    SET google_place_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND (google_place_id IS NULL OR google_place_id = '' OR google_place_id != ?)
  `).run(googlePlaceId, placeId, googlePlaceId);
}
