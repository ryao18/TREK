import { getTripSummary, listMembers } from '../tripService';
import { getAssignmentsForDay, listDays } from '../dayService';
import { listReservations } from '../reservationService';
import { listItems as listPackingItems } from '../packingService';
import { listItems as listTodoItems } from '../todoService';
import { calculateSettlement, getPerPersonSummary, listBudgetItems } from '../budgetService';
import { listPlaces } from '../placeService';
import { db } from '../../db/database';
import { searchNearbyPlaces, searchPlaces } from '../mapsService';

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
      assignment_id: reservation.assignment_id ?? null,
      reservation_time: reservation.reservation_time ?? null,
      reservation_end_time: reservation.reservation_end_time ?? null,
      place_name: reservation.place_name || reservation.accommodation_name || null,
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

function isGenericAnchorReference(anchorText: string | null | undefined): boolean {
  const normalized = normalizeForAssistantLookup(anchorText);
  return !normalized
    || normalized === 'this place'
    || normalized === 'here'
    || normalized === 'this day'
    || normalized === 'today'
    || normalized === 'selected day';
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
  if (!tokens.length) return 0;
  const haystack = `${name} ${address}`.trim();
  const matchedTokens = tokens.filter((token) => haystack.includes(token)).length;
  return matchedTokens > 0 ? matchedTokens * 10 : 0;
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

  const allPlaces = listPlaces(String(tripId), {}) as any[];
  const normalizedAnchor = normalizeForAssistantLookup(anchorText);
  const wantsContextualAnchor = isGenericAnchorReference(anchorText) || /\bday\s+\d{1,2}\b/.test(normalizedAnchor);

  let anchor: Record<string, unknown> | null = null;

  const useSelectedPlace = !normalizedAnchor || /\bthis place\b|\bhere\b/.test(normalizedAnchor);
  if (selectedPlaceId && useSelectedPlace) {
    const selectedPlace = allPlaces.find((place) => Number(place.id) === Number(selectedPlaceId));
    if (selectedPlace?.lat != null && selectedPlace?.lng != null) {
      anchor = {
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

  if (!anchor && selectedDayId && (!normalizedAnchor || /\bthis day\b|\btoday\b|\bselected day\b|\bday\s+\d{1,2}\b/.test(normalizedAnchor))) {
    const dayContext = getDayWeatherContext(tripId, selectedDayId);
    if (dayContext?.lat != null && dayContext?.lng != null) {
      anchor = {
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

  if (!anchor && normalizedAnchor && !wantsContextualAnchor) {
    const bestSavedPlace = [...allPlaces]
      .map((place) => ({ place, score: scorePlaceMatch(place, normalizedAnchor) }))
      .filter((entry) => entry.score > 0 && entry.place?.lat != null && entry.place?.lng != null)
      .sort((a, b) => b.score - a.score)[0];

    if (bestSavedPlace?.place) {
      anchor = {
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

  if (!anchor && normalizedAnchor && !wantsContextualAnchor) {
    const searched = await searchPlaces(userId, anchorText || normalizedAnchor, 'en');
    const first = (searched.places || []).find((place: any) => place.lat != null && place.lng != null) as any;
    if (first) {
      anchor = {
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

  const anchorResult = await findNearbyPlaces({
    tripId,
    userId,
    query: 'places',
    anchorText,
    selectedDayId,
    selectedPlaceId,
    limit: 1,
  });

  if (!anchorResult.available || !anchorResult.anchor) {
    return {
      available: false,
      reason: anchorResult.reason,
      query,
      anchor: anchorResult.anchor,
      results: [],
      source: 'trip_saved',
    };
  }

  const anchorLat = Number((anchorResult.anchor as any).lat);
  const anchorLng = Number((anchorResult.anchor as any).lng);
  const allPlaces = listPlaces(String(tripId), {}) as any[];
  const results = allPlaces
    .filter((place) => place.lat != null && place.lng != null)
    .filter((place) => Number(place.id) !== Number((anchorResult.anchor as any).trip_place_id))
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
    anchor: anchorResult.anchor,
    results,
    source: 'trip_saved',
  };
}
