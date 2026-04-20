import { getTripSummary, listMembers } from '../tripService';
import { getAssignmentsForDay, listDays } from '../dayService';
import { listReservations } from '../reservationService';
import { listItems as listPackingItems } from '../packingService';
import { listItems as listTodoItems } from '../todoService';
import { calculateSettlement, getPerPersonSummary, listBudgetItems } from '../budgetService';
import { listPlaces } from '../placeService';
import { db } from '../../db/database';
import { getMapsKey, getPlaceDetails, searchNearbyPlaces, searchPlaces } from '../mapsService';
import { getPlaceExternalData, persistPlaceGooglePlaceId, upsertPlaceExternalData } from '../placeExternalDataService';

function toIsoDate(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

export function getTripOverview(tripId: number) {
  const summary = getTripSummary(tripId);
  if (!summary) return null;
  const todoItems = listTodoItems(tripId) as any[];

  const trip = summary.trip as Record<string, unknown>;
  return {
    trip: {
      id: Number(trip.id),
      title: String(trip.title || 'Untitled trip'),
      description: typeof trip.description === 'string' ? trip.description : null,
      start_date: toIsoDate(trip.start_date),
      end_date: toIsoDate(trip.end_date),
      currency: typeof trip.currency === 'string' ? trip.currency : null,
    },
    counts: {
      days: Array.isArray(summary.days) ? summary.days.length : 0,
      reservations: Array.isArray(summary.reservations) ? summary.reservations.length : 0,
      packing_items: typeof summary.packing?.total === 'number' ? summary.packing.total : 0,
      todo_items: todoItems.length,
      budget_items: typeof summary.budget?.item_count === 'number' ? summary.budget.item_count : 0,
    },
    budget: summary.budget,
    packing: summary.packing,
  };
}

export function getTripDays(tripId: number) {
  const data = listDays(tripId);
  return data.days.slice(0, 20).map((day: any) => ({
    id: day.id,
    day_number: day.day_number,
    date: day.date || null,
    title: day.title || null,
    assignment_count: Array.isArray(day.assignments) ? day.assignments.length : 0,
    note_count: Array.isArray(day.notes_items) ? day.notes_items.length : 0,
    place_names: (day.assignments || []).slice(0, 5).map((assignment: any) => assignment.place?.name ?? 'Unknown place'),
  }));
}

export function getDayPlan(tripId: number, dayId: number) {
  const data = listDays(tripId);
  const day = data.days.find((entry: any) => Number(entry.id) === Number(dayId));
  if (!day) return null;

  const assignments = getAssignmentsForDay(dayId) as any[];
  return {
    id: day.id,
    day_number: day.day_number,
    date: day.date || null,
    title: day.title || null,
    note_count: Array.isArray(day.notes_items) ? day.notes_items.length : 0,
    assignments: assignments.map((assignment) => ({
      id: assignment.id,
      place_id: assignment.place?.id ?? null,
      place_name: assignment.place?.name ?? 'Unknown place',
      day_section: assignment.day_section ?? null,
      place_time: assignment.place?.place_time ?? null,
      end_time: assignment.place?.end_time ?? null,
      participants: (assignment.participants || []).map((participant: any) => ({
        id: participant.user_id ?? participant.id ?? null,
        username: participant.username ?? null,
      })),
    })),
  };
}

export function getDayWeatherContext(tripId: number, dayId: number) {
  const data = listDays(tripId);
  const day = data.days.find((entry: any) => Number(entry.id) === Number(dayId));
  if (!day) return null;

  const tripPlaces = listPlaces(String(tripId), {}) as any[];
  const dayAssignments = (day.assignments || []) as any[];
  const assignedGeoPlace = dayAssignments.find((assignment) => assignment.place?.lat != null && assignment.place?.lng != null)?.place || null;
  const fallbackGeoPlace = tripPlaces.find((place) => place.lat != null && place.lng != null) || null;
  const geoPlace = assignedGeoPlace || fallbackGeoPlace;

  return {
    id: day.id,
    day_number: day.day_number,
    date: day.date || null,
    title: day.title || null,
    lat: geoPlace?.lat ?? null,
    lng: geoPlace?.lng ?? null,
    place_name: assignedGeoPlace?.name || null,
    coordinate_source: assignedGeoPlace ? 'assigned_place' : (fallbackGeoPlace ? 'trip_fallback' : null),
  };
}

export function getTripPlaces(tripId: number) {
  const places = listPlaces(String(tripId), {}) as any[];
  const assignedRows = db.prepare(`
    SELECT DISTINCT da.place_id
    FROM day_assignments da
    JOIN days d ON d.id = da.day_id
    WHERE d.trip_id = ?
  `).all(tripId) as Array<{ place_id: number }>;
  const assignedPlaceIds = new Set(assignedRows.map((row) => Number(row.place_id)));

  return {
    total: places.length,
    items: places.map((place) => ({
      id: place.id,
      name: place.name,
      address: place.address || null,
      category_name: place.category?.name || null,
      google_place_id: place.google_place_id || null,
      website: place.website || null,
      phone: place.phone || null,
      lat: place.lat ?? null,
      lng: place.lng ?? null,
      has_coordinates: place.lat != null && place.lng != null,
      has_assignment: assignedPlaceIds.has(Number(place.id)),
    })),
  };
}

export function getTripMembersSummary(tripId: number) {
  const ownerRow = (getTripSummary(tripId)?.members?.owner || null) as any;
  const ownerId = ownerRow?.id ? Number(ownerRow.id) : null;
  const membersData = ownerId ? listMembers(tripId, ownerId) : null;
  const members = membersData ? [membersData.owner, ...(membersData.members || [])] : [];
  return members.map((member: any) => ({
    id: member.user_id ?? member.id,
    username: member.username,
    email: member.email ?? null,
    is_owner: Number(member.user_id ?? member.id) === Number(ownerId),
  }));
}

export function getReservationsSummary(tripId: number) {
  const reservations = listReservations(tripId) as any[];
  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};

  for (const reservation of reservations) {
    const status = reservation.status || 'unknown';
    const type = reservation.type || 'other';
    byStatus[status] = (byStatus[status] || 0) + 1;
    byType[type] = (byType[type] || 0) + 1;
  }
  const unscheduledCount = reservations.filter((reservation) => reservation.place_id && !reservation.assignment_id).length;

  return {
    total: reservations.length,
    by_status: byStatus,
    by_type: byType,
    unscheduled_count: unscheduledCount,
    items: reservations.map((reservation) => ({
      id: reservation.id,
      title: reservation.title,
      status: reservation.status,
      type: reservation.type,
      day_number: reservation.day_number ?? null,
      place_id: reservation.place_id ?? null,
      assignment_id: reservation.assignment_id ?? null,
      reservation_time: reservation.reservation_time ?? null,
      reservation_end_time: reservation.reservation_end_time ?? null,
      place_name: reservation.place_name || reservation.accommodation_name || null,
      accommodation_place_id: reservation.accommodation_place_id ?? null,
      accommodation_name: reservation.accommodation_name || null,
      accommodation_check_in: reservation.accommodation_check_in ?? null,
      accommodation_check_out: reservation.accommodation_check_out ?? null,
      is_unscheduled: !!reservation.place_id && !reservation.assignment_id,
      confirmation_number: reservation.confirmation_number || null,
    })),
  };
}

export function getPackingSummary(tripId: number) {
  const items = listPackingItems(tripId) as any[];
  const byOwner: Record<string, { total: number; checked: number }> = {};
  const byCategory: Record<string, { total: number; checked: number }> = {};

  for (const item of items) {
    const owner = item.owner_name || 'Unknown';
    const category = item.category || 'Other';
    if (!byOwner[owner]) byOwner[owner] = { total: 0, checked: 0 };
    if (!byCategory[category]) byCategory[category] = { total: 0, checked: 0 };
    byOwner[owner].total += 1;
    byCategory[category].total += 1;
    if (item.checked) {
      byOwner[owner].checked += 1;
      byCategory[category].checked += 1;
    }
  }

  return {
    total: items.length,
    checked: items.filter(item => item.checked).length,
    by_owner: byOwner,
    by_category: byCategory,
    sample_items: items.slice(0, 8).map((item) => ({
      id: item.id,
      name: item.name,
      checked: !!item.checked,
      owner_name: item.owner_name || null,
      category: item.category || 'Other',
      quantity: item.quantity ?? 1,
    })),
  };
}

export function getTodoSummary(tripId: number) {
  const items = listTodoItems(tripId) as any[];
  const byCategory: Record<string, { total: number; checked: number }> = {};

  for (const item of items) {
    const category = item.category || 'General';
    if (!byCategory[category]) byCategory[category] = { total: 0, checked: 0 };
    byCategory[category].total += 1;
    if (item.checked) byCategory[category].checked += 1;
  }

  return {
    total: items.length,
    checked: items.filter(item => item.checked).length,
    by_category: byCategory,
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      checked: !!item.checked,
      category: item.category || 'General',
      due_date: item.due_date || null,
      assigned_user_id: item.assigned_user_id ?? null,
      priority: item.priority ?? 0,
    })),
  };
}

export function getBudgetSummary(tripId: number) {
  const items = listBudgetItems(tripId) as any[];
  const perPerson = getPerPersonSummary(tripId) as any[];
  const settlement = calculateSettlement(tripId) as any;
  const byCategory: Record<string, { total: number; amount: number }> = {};

  for (const item of items) {
    const category = item.category || 'Other';
    if (!byCategory[category]) byCategory[category] = { total: 0, amount: 0 };
    byCategory[category].total += 1;
    byCategory[category].amount += Number(item.total_price || 0);
  }

  return {
    total_items: items.length,
    total_amount: items.reduce((sum, item) => sum + Number(item.total_price || 0), 0),
    currency: items[0]?.currency || null,
    by_category: byCategory,
    per_person: perPerson.slice(0, 8).map((person) => ({
      user_id: person.user_id,
      username: person.username,
      total_assigned: Number(person.total_assigned || 0),
      total_paid: Number(person.total_paid || 0),
      items_count: Number(person.items_count || 0),
    })),
    settlement: (settlement?.flows || []).slice(0, 8).map((flow: any) => ({
      from: flow.from?.username || 'Unknown',
      to: flow.to?.username || 'Unknown',
      amount: Number(flow.amount || 0),
    })),
    items: items.slice(0, 8).map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category || 'Other',
      total_price: Number(item.total_price || 0),
      persons: item.persons ?? null,
    })),
  };
}

function normalizeForAssistantLookup(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[?!.,;:()]+/g, ' ')
    .replace(/\bthe\b/g, ' ')
    .replace(/\boffice\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function simplifyForFuzzyLookup(value: string): string {
  return normalizeForAssistantLookup(value)
    .replace(/(.)\1+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGenericAnchorReference(anchorText: string | null | undefined): boolean {
  const normalized = normalizeForAssistantLookup(anchorText);
  return !normalized
    || normalized === 'this place'
    || normalized === 'here'
    || normalized === 'this day'
    || normalized === 'today'
    || normalized === 'selected day';
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  const curr = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }

  return prev[b.length];
}

function fuzzyScore(text: string, query: string): number {
  if (!text || !query) return 0;
  const variants: Array<[string, string]> = [
    [text, query],
    [simplifyForFuzzyLookup(text), simplifyForFuzzyLookup(query)],
  ];
  let best = 0;
  for (const [left, right] of variants) {
    if (!left || !right) continue;
    const distance = levenshteinDistance(left, right);
    const maxLength = Math.max(left.length, right.length);
    if (maxLength === 0) continue;
    const similarity = 1 - distance / maxLength;
    if (similarity >= 0.68) {
      best = Math.max(best, Math.round(similarity * 85));
    }
  }
  return best;
}

function scorePlaceMatch(place: any, anchorText: string): number {
  const anchor = normalizeForAssistantLookup(anchorText);
  if (!anchor) return 0;

  const name = normalizeForAssistantLookup(place?.name);
  const address = normalizeForAssistantLookup(place?.address);
  if (!name && !address) return 0;

  if (name === anchor) return 100;
  if (name.includes(anchor)) return 90;
  if (anchor.includes(name) && name.length >= 4) return 85;
  if (address && address.includes(anchor)) return 70;

  const tokens = anchor.split(' ').filter((token) => token.length >= 3);
  const bestFuzzy = Math.max(
    fuzzyScore(name, anchor),
    ...tokens.map((token) => fuzzyScore(name, token)),
  );
  if (!tokens.length) return bestFuzzy;
  const haystack = `${name} ${address}`.trim();
  const matchedTokens = tokens.filter((token) => haystack.includes(token)).length;
  const tokenScore = matchedTokens > 0 ? matchedTokens * 10 : 0;
  return Math.max(tokenScore, bestFuzzy);
}

function extractPlaceLookupText(value: string): string {
  const normalized = String(value || '')
    .replace(/[?!]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';

  const patterns = [
    /^(?:what kind of(?:\s+of)*\s+food|what cuisine|what kind of place|what type of place)\s+is\s+(.+)$/i,
    /^(?:what is|what's)\s+the\s+(?:rating|review count|website|phone number|telephone)\s+(?:for|of)\s+(.+)$/i,
    /^(?:what are|what're|what is|what's)\s+the\s+(?:hours|rating|review count|website|phone number|telephone)\s+(?:for|of)\s+(.+)$/i,
    /^(?:does|is)\s+(.+?)\s+have\s+(?:a\s+)?website$/i,
    /^(?:what is|what's)\s+(.+?)$/i,
    /^(?:what are|what's)\s+(.+?)'s\s+hours$/i,
    /^(?:what are|what're|what is|what's)\s+the?\s*hours\s+of\s+(.+)$/i,
    /^(?:when does|what time does)\s+(.+?)\s+(?:open|close)$/i,
    /^(?:is)\s+(.+?)\s+open(?:\s+right\s+now)?$/i,
    /^(?:of|for)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) return match[1].trim();
  }

  return normalized;
}

function isGenericPlaceReferenceMessage(value: string): boolean {
  const normalized = normalizeForAssistantLookup(value);
  return normalized === 'this place'
    || normalized === 'here'
    || normalized === 'this spot'
    || normalized === 'this location'
    || normalized === 'this venue';
}

function resolveSavedTripPlaceFromHistory(places: any[], history?: Array<{ role: string; content: string }>): any | null {
  const entries = [...(history || [])].reverse();
  for (const entry of entries) {
    if (!entry || entry.role !== 'user' || typeof entry.content !== 'string') continue;
    const candidateText = extractPlaceLookupText(entry.content);
    if (!candidateText || isGenericPlaceReferenceMessage(candidateText)) continue;
    const bestSavedPlace = places
      .map((place) => ({ place, score: scorePlaceMatch(place, candidateText) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)[0];
    if (bestSavedPlace?.score >= 70) return bestSavedPlace.place;
  }
  return null;
}

export function resolveSavedTripPlace(params: {
  tripId: number;
  message?: string | null;
  selectedPlaceId?: number | null;
  explicitPlaceName?: string | null;
  history?: Array<{ role: string; content: string }>;
}) {
  const { tripId, message, selectedPlaceId = null, explicitPlaceName = null, history = [] } = params;
  const places = listPlaces(String(tripId), {}) as any[];
  const candidateText = explicitPlaceName || extractPlaceLookupText(message || '');
  const bestSavedPlace = places
    .map((place) => ({ place, score: scorePlaceMatch(place, candidateText) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)[0];

  if (bestSavedPlace?.score >= 70) return bestSavedPlace.place;

  if (selectedPlaceId) {
    const selected = places.find((place) => Number(place.id) === Number(selectedPlaceId));
    if (selected) return selected;
  }

  if (isGenericPlaceReferenceMessage(candidateText)) {
    const priorPlace = resolveSavedTripPlaceFromHistory(places, history);
    if (priorPlace) return priorPlace;
  }

  return bestSavedPlace?.score >= 70 ? bestSavedPlace.place : null;
}

async function resolveGooglePlaceIdForSavedPlace(userId: number, place: any): Promise<string | null> {
  if (place?.google_place_id) return String(place.google_place_id);

  const searchQuery = [place?.name, place?.address].filter(Boolean).join(' ').trim();
  if (!searchQuery) return null;

  let candidates: any[] = [];
  try {
    if (place?.lat != null && place?.lng != null) {
      const nearby = await searchNearbyPlaces(userId, Number(place.lat), Number(place.lng), String(place.name || searchQuery), 5, 'en');
      candidates = nearby.places as any[];
    } else {
      const searched = await searchPlaces(userId, searchQuery, 'en');
      candidates = searched.places as any[];
    }
  } catch {
    return null;
  }

  const best = candidates
    .map((candidate) => ({ candidate, score: scorePlaceMatch(candidate, searchQuery) }))
    .sort((a, b) => b.score - a.score)[0];

  if (!best || best.score < 70 || !best.candidate?.google_place_id) return null;
  return String(best.candidate.google_place_id);
}

export async function findSavedPlaceLiveDetails(params: {
  tripId: number;
  userId: number;
  message: string;
  selectedPlaceId?: number | null;
  explicitPlaceName?: string | null;
  history?: Array<{ role: string; content: string }>;
}) {
  const { tripId, userId, message, selectedPlaceId = null, explicitPlaceName = null, history = [] } = params;
  const place = resolveSavedTripPlace({ tripId, message, selectedPlaceId, explicitPlaceName, history });

  if (!place) {
    return {
      available: false,
      reason: 'place_not_found',
      place: null,
      externalData: null,
      liveDetails: null,
      usedLiveLookup: false,
    };
  }

  const externalData = getPlaceExternalData(Number(place.id));
  let googlePlaceId = place.google_place_id ? String(place.google_place_id) : null;
  let liveDetails: Record<string, unknown> | null = null;
  let usedLiveLookup = false;

  if (!googlePlaceId) {
    googlePlaceId = await resolveGooglePlaceIdForSavedPlace(userId, place);
    if (googlePlaceId) {
      persistPlaceGooglePlaceId(Number(place.id), googlePlaceId);
    }
  }

  if (googlePlaceId) {
    try {
      const details = await getPlaceDetails(userId, googlePlaceId, 'en');
      liveDetails = details.place as Record<string, unknown>;
      usedLiveLookup = true;

      upsertPlaceExternalData(Number(place.id), {
        source: 'google_places',
        external_types: Array.isArray(liveDetails.types) ? (liveDetails.types as string[]) : [],
        website: typeof liveDetails.website === 'string' ? liveDetails.website : null,
        phone: typeof liveDetails.phone === 'string' ? liveDetails.phone : null,
        rating: typeof liveDetails.rating === 'number' ? liveDetails.rating : null,
        rating_count: typeof liveDetails.rating_count === 'number' ? liveDetails.rating_count : null,
      });
    } catch {
      liveDetails = null;
    }
  }

  const refreshedExternalData = getPlaceExternalData(Number(place.id));
  return {
    available: true,
    reason: googlePlaceId ? null : 'google_place_not_resolved',
    place: {
      id: place.id,
      name: place.name || 'Unknown place',
      address: place.address || null,
      category_name: place.category?.name || null,
      website: place.website || null,
      phone: place.phone || null,
      google_place_id: googlePlaceId || null,
    },
    externalData: refreshedExternalData,
    liveDetails,
    usedLiveLookup,
  };
}

export async function findNearbyPlaces(params: {
  tripId: number;
  userId: number;
  query: string;
  anchorText?: string | null;
  selectedDayId?: number | null;
  selectedPlaceId?: number | null;
  limit?: number;
}) {
  const {
    tripId,
    userId,
    query,
    anchorText,
    selectedDayId = null,
    selectedPlaceId = null,
    limit = 5,
  } = params;

  const anchor = await resolveNearbyAnchor({
    tripId,
    userId,
    anchorText,
    selectedDayId,
    selectedPlaceId,
    allowExternalSearch: true,
  });

  if (!anchor) {
    return {
      available: false,
      reason: 'anchor_not_found',
      query: String(query || '').trim() || 'places',
      anchor: null,
      results: [],
      source: 'unavailable',
    };
  }

  try {
    const nearby = await searchNearbyPlaces(
      userId,
      Number(anchor.lat),
      Number(anchor.lng),
      query,
      limit,
      'en',
    );
    return {
      available: true,
      reason: null,
      query: String(query || '').trim() || 'places',
      anchor,
      results: nearby.places,
      source: nearby.source,
    };
  } catch (error) {
    const status = (error as { status?: number })?.status || 500;
    return {
      available: false,
      reason: status === 400 ? 'maps_key_missing' : 'search_failed',
      query: String(query || '').trim() || 'places',
      anchor,
      results: [],
      source: 'unavailable',
    };
  }
}

async function resolveNearbyAnchor(params: {
  tripId: number;
  userId: number;
  anchorText?: string | null;
  selectedDayId?: number | null;
  selectedPlaceId?: number | null;
  allowExternalSearch: boolean;
}): Promise<Record<string, unknown> | null> {
  const {
    tripId,
    userId,
    anchorText,
    selectedDayId = null,
    selectedPlaceId = null,
    allowExternalSearch,
  } = params;

  const allPlaces = listPlaces(String(tripId), {}) as any[];
  const normalizedAnchor = normalizeForAssistantLookup(anchorText);
  const wantsContextualAnchor = isGenericAnchorReference(anchorText) || /\bday\s+\d{1,2}\b/.test(normalizedAnchor);

  const useSelectedPlace = !normalizedAnchor || /\bthis place\b|\bhere\b/.test(normalizedAnchor);
  if (selectedPlaceId && useSelectedPlace) {
    const selectedPlace = allPlaces.find((place) => Number(place.id) === Number(selectedPlaceId));
    if (selectedPlace?.lat != null && selectedPlace?.lng != null) {
      return {
        source: 'selected_place',
        trip_place_id: selectedPlace.id,
        google_place_id: selectedPlace.google_place_id || null,
        name: selectedPlace.name || 'Selected place',
        address: selectedPlace.address || null,
        lat: selectedPlace.lat,
        lng: selectedPlace.lng,
      };
    }
  }

  if (selectedDayId && (!normalizedAnchor || /\bthis day\b|\btoday\b|\bselected day\b|\bday\s+\d{1,2}\b/.test(normalizedAnchor))) {
    const dayContext = getDayWeatherContext(tripId, selectedDayId);
    if (dayContext?.lat != null && dayContext?.lng != null) {
      return {
        source: 'selected_day',
        trip_place_id: null,
        google_place_id: null,
        name: dayContext.place_name || `Day ${dayContext.day_number}`,
        address: null,
        lat: dayContext.lat,
        lng: dayContext.lng,
        day_number: dayContext.day_number,
      };
    }
  }

  if (normalizedAnchor && !wantsContextualAnchor) {
    const bestSavedPlace = [...allPlaces]
      .map((place) => ({ place, score: scorePlaceMatch(place, normalizedAnchor) }))
      .filter((entry) => entry.score > 0 && entry.place?.lat != null && entry.place?.lng != null)
      .sort((a, b) => b.score - a.score)[0];

    if (bestSavedPlace?.place) {
      return {
        source: 'saved_place',
        trip_place_id: bestSavedPlace.place.id,
        google_place_id: bestSavedPlace.place.google_place_id || null,
        name: bestSavedPlace.place.name || 'Saved place',
        address: bestSavedPlace.place.address || null,
        lat: bestSavedPlace.place.lat,
        lng: bestSavedPlace.place.lng,
      };
    }
  }

  if (allowExternalSearch && normalizedAnchor && !wantsContextualAnchor) {
    const searched = await searchPlaces(userId, anchorText || normalizedAnchor, 'en');
    const first = (searched.places || []).find((place: any) => place.lat != null && place.lng != null) as any;
    if (first) {
      return {
        source: 'external_search',
        trip_place_id: null,
        google_place_id: first.google_place_id || null,
        name: first.name || anchorText || normalizedAnchor,
        address: first.address || null,
        lat: first.lat,
        lng: first.lng,
      };
    }
  }

  return null;
}

function formatSavedNearbyDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadiusMeters = 6371000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(earthRadiusMeters * c);
}

function matchesSavedNearbyCategory(place: any, query: string): boolean {
  const normalizedQuery = normalizeForAssistantLookup(query);
  const category = normalizeForAssistantLookup(place?.category_name);
  const name = normalizeForAssistantLookup(place?.name);

  if (!normalizedQuery) return true;
  if (/\bfood\b|\brestaurant\b|\brestaurants\b/.test(normalizedQuery)) {
    return category.includes('restaurant') || category.includes('bar/cafe') || category.includes('bar cafe');
  }
  if (/\bcafe\b|\bcafes\b|\bcoffee\b|\bboba\b|\bbubble tea\b|\btea\b/.test(normalizedQuery)) {
    return category.includes('bar/cafe') || category.includes('bar cafe') || name.includes('tea') || name.includes('boba') || name.includes('cafe') || name.includes('coffee');
  }
  if (/\bgrocery\b|\bgroceries\b|\bsupermarket\b|\bmarket\b/.test(normalizedQuery)) {
    return category.includes('shopping')
      && /\bgrocery\b|\bmarket\b|\bmart\b|\bsafeway\b|\btrader joe\b|\bwhole foods\b|\bwegmans\b|\bcostco\b/.test(name);
  }
  if (/\bstore\b|\bstores\b/.test(normalizedQuery)) {
    return category.includes('shopping');
  }
  if (/\battraction\b|\battractions\b|\bthings to do\b|\bplaces to visit\b|\bplaces to see\b|\bvisit\b/.test(normalizedQuery)) {
    return category.includes('attraction') || category.includes('activity');
  }
  return category.includes(normalizedQuery) || name.includes(normalizedQuery);
}

export async function findSavedNearbyTripPlaces(params: {
  tripId: number;
  userId: number;
  query: string;
  anchorText?: string | null;
  selectedDayId?: number | null;
  selectedPlaceId?: number | null;
  limit?: number;
}) {
  const {
    tripId,
    userId,
    query,
    anchorText,
    selectedDayId = null,
    selectedPlaceId = null,
    limit = 10,
  } = params;

  const anchor = await resolveNearbyAnchor({
    tripId,
    userId,
    anchorText,
    selectedDayId,
    selectedPlaceId,
    allowExternalSearch: !!getMapsKey(userId),
  });

  if (!anchor) {
    return {
      available: false,
      reason: 'anchor_not_found',
      query,
      anchor: null,
      results: [],
      source: 'trip_saved',
    };
  }

  const anchorLat = Number((anchor as any).lat);
  const anchorLng = Number((anchor as any).lng);
  const allPlaces = listPlaces(String(tripId), {}) as any[];
  const results = allPlaces
    .filter((place) => place.lat != null && place.lng != null)
    .filter((place) => Number(place.id) !== Number((anchor as any).trip_place_id))
    .filter((place) => matchesSavedNearbyCategory(place, query))
    .map((place) => ({
      id: place.id,
      name: place.name || 'Unknown place',
      address: place.address || null,
      category_name: place.category?.name || null,
      lat: place.lat,
      lng: place.lng,
      distance_meters: formatSavedNearbyDistanceMeters(anchorLat, anchorLng, Number(place.lat), Number(place.lng)),
      source: 'trip_saved',
    }))
    .sort((a, b) => a.distance_meters - b.distance_meters)
    .slice(0, Math.min(Math.max(Number(limit) || 10, 1), 25));

  return {
    available: true,
    reason: null,
    query,
    anchor,
    results,
    source: 'trip_saved',
  };
}
