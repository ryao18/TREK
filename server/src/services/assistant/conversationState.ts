import { db } from '../../db/database';
import { listPlaces } from '../placeService';
import { listDays } from '../dayService';
import { listReservations } from '../reservationService';
import { AssistantQueryInput } from './types';
import { resolveSavedTripPlace } from './tools';

export type PlaceCategoryScope =
  | 'hotel'
  | 'restaurant'
  | 'cafe'
  | 'attraction'
  | 'shopping'
  | 'activity'
  | 'other';

export type ComparisonTravelMode = 'walking' | 'driving' | 'transit';
export type ComparisonType = 'distance' | 'travel_time';

export interface AssistantConversationState {
  previousPlaceId: number | null;
  previousPlaceName: string | null;
  activePlaceId: number | null;
  activePlaceName: string | null;
  activePlaceCategory: string | null;
  activePlaceCategoryScope: PlaceCategoryScope | null;
  previousDayId: number | null;
  previousDayNumber: number | null;
  activeDayId: number | null;
  activeDayNumber: number | null;
  activeReservationId: number | null;
  activeReservationLabel: string | null;
  activeStayReservationId: number | null;
  activeComparisonOriginPlaceId: number | null;
  activeComparisonOriginPlaceName: string | null;
  activeComparisonDestinationPlaceId: number | null;
  activeComparisonDestinationPlaceName: string | null;
  activeComparisonTravelMode: ComparisonTravelMode | null;
  activeComparisonType: ComparisonType | null;
  activeSubjectKind: 'place' | 'reservation' | 'stay' | 'day' | 'result_set' | null;
  activeResultSetKind: 'trip_places_filtered' | 'trip_places_full' | 'unplanned_places' | null;
  activeResultSetPlaceIds: number[];
  activeReferenceOrdinal: number | null;
}

function normalizeConversationQuery(message: string): string {
  return String(message || '')
    .toLowerCase()
    .replace(/[?!.,;:()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mapPlaceCategoryToScope(categoryName: string | null | undefined): PlaceCategoryScope | null {
  const normalized = normalizeConversationQuery(categoryName || '');
  if (!normalized) return null;
  if (/\bhotel\b|\baccommodation\b/.test(normalized)) return 'hotel';
  if (/\brestaurant\b|\bfood\b/.test(normalized)) return 'restaurant';
  if (/\bcafe\b|\bcoffee\b|\btea\b|\bbakery\b|\bbar\/cafe\b|\bbar cafe\b/.test(normalized)) return 'cafe';
  if (/\battraction\b|\bmuseum\b|\bpark\b|\bsight\b/.test(normalized)) return 'attraction';
  if (/\bshopping\b|\bshop\b|\bstore\b/.test(normalized)) return 'shopping';
  if (/\bactivity\b|\bvenue\b/.test(normalized)) return 'activity';
  return 'other';
}

export function extractPlaceCategoryScope(message: string): PlaceCategoryScope | null {
  const lower = normalizeConversationQuery(message);
  if (/\bhotels?\b|\baccommodations?\b/.test(lower)) return 'hotel';
  if (/\brestaurants?\b|\bfood places?\b|\bfood spots?\b/.test(lower)) return 'restaurant';
  if (/\bcafes?\b|\bcoffee shops?\b|\bbakeries\b|\btea shops?\b|\bboba\b|\bbubble tea\b/.test(lower)) return 'cafe';
  if (/\battractions?\b|\bmuseums?\b|\bparks?\b|\bplaces to visit\b|\bthings to do\b/.test(lower)) return 'attraction';
  if (/\bshopping\b|\bshops?\b|\bstores?\b|\bboutiques?\b/.test(lower)) return 'shopping';
  if (/\bactivities\b|\bvenues\b/.test(lower)) return 'activity';
  return null;
}

function inferCategoryScopeFromHistory(history?: AssistantQueryInput['history']): PlaceCategoryScope | null {
  const entries = [...(history || [])].reverse();
  for (const entry of entries) {
    if (entry.role !== 'user') continue;
    if (!entry || typeof entry.content !== 'string') continue;
    const scope = extractPlaceCategoryScope(entry.content);
    if (scope) return scope;
  }
  return null;
}

function isFullPlaceListRequest(message: string): boolean {
  const lower = normalizeConversationQuery(message);
  return /\bshow all places\b|\blist all places\b|\ball places\b|\bwhat places are listed\b|\bshow all saved places\b/.test(lower);
}

function isUnplannedPlaceListRequest(message: string): boolean {
  const lower = normalizeConversationQuery(message);
  return /\bunplanned places\b|\bplaces are still unplanned\b|\bwhich places are still unplanned\b|\blist all unplanned places\b/.test(lower);
}

function deriveResultSet(
  tripId: number,
  message: string,
  history?: AssistantQueryInput['history'],
): { kind: AssistantConversationState['activeResultSetKind']; placeIds: number[]; scope: PlaceCategoryScope | null } {
  const places = listPlaces(String(tripId), {}) as any[];
  const assignedRows = db.prepare(`
    SELECT DISTINCT da.place_id
    FROM day_assignments da
    JOIN days d ON d.id = da.day_id
    WHERE d.trip_id = ?
  `).all(tripId) as Array<{ place_id: number }>;
  const assignedPlaceIds = new Set(assignedRows.map((row) => Number(row.place_id)));
  const entries = [...(history || []), { role: 'user' as const, content: message }].filter((entry) => entry.role === 'user');

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const content = entries[index].content;
    const scope = extractPlaceCategoryScope(content);
    if (scope) {
      return {
        kind: 'trip_places_filtered',
        placeIds: places
          .filter((place) => mapPlaceCategoryToScope(place.category?.name || place.category_name || null) === scope)
          .map((place) => Number(place.id)),
        scope,
      };
    }
    if (isUnplannedPlaceListRequest(content)) {
      return {
        kind: 'unplanned_places',
        placeIds: places.filter((place) => !assignedPlaceIds.has(Number(place.id))).map((place) => Number(place.id)),
        scope: null,
      };
    }
    if (isFullPlaceListRequest(content)) {
      return {
        kind: 'trip_places_full',
        placeIds: places.map((place) => Number(place.id)),
        scope: null,
      };
    }
  }

  return { kind: null, placeIds: [], scope: null };
}

function extractOrdinalReference(message: string): number | null {
  const lower = normalizeConversationQuery(message);
  const byWord: Record<string, number> = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7,
    eighth: 8,
    ninth: 9,
    tenth: 10,
  };
  for (const [word, index] of Object.entries(byWord)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) return index;
  }
  const numericMatch = lower.match(/\b(\d+)(?:st|nd|rd|th)\b/);
  if (numericMatch) return Number(numericMatch[1]);
  return null;
}

function extractRequestedDayNumber(message: string): number | null {
  const match = normalizeConversationQuery(message).match(/\bday\s+(\d{1,2})\b/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function isReferenceMessage(message: string): boolean {
  const lower = normalizeConversationQuery(message);
  return /\bthis one\b|\bthat one\b|\bother one\b|\bother ones\b|\bfirst\b|\bsecond\b|\bthird\b|\bfourth\b|\bfifth\b|\bsixth\b|\bseventh\b|\beighth\b|\bninth\b|\btenth\b/.test(lower);
}

function resolveDayFromInput(
  tripId: number,
  message: string,
  selectedDayId?: number | null,
  history?: AssistantQueryInput['history'],
): { id: number | null; dayNumber: number | null } {
  const days = listDays(tripId).days as Array<{ id: number; day_number: number }>;
  const explicitDayNumber = extractRequestedDayNumber(message);
  if (explicitDayNumber != null) {
    const matchedDay = days.find((day) => Number(day.day_number) === explicitDayNumber);
    return {
      id: matchedDay?.id != null ? Number(matchedDay.id) : null,
      dayNumber: matchedDay?.day_number != null ? Number(matchedDay.day_number) : explicitDayNumber,
    };
  }

  if (selectedDayId != null) {
    const selectedDay = days.find((day) => Number(day.id) === Number(selectedDayId));
    return {
      id: selectedDay?.id != null ? Number(selectedDay.id) : Number(selectedDayId),
      dayNumber: selectedDay?.day_number != null ? Number(selectedDay.day_number) : null,
    };
  }

  const entries = [...(history || [])].reverse();
  for (const entry of entries) {
    if (!entry || entry.role !== 'user' || typeof entry.content !== 'string') continue;
    const dayNumber = extractRequestedDayNumber(entry.content);
    if (dayNumber == null) continue;
    const matchedDay = days.find((day) => Number(day.day_number) === dayNumber);
    return {
      id: matchedDay?.id != null ? Number(matchedDay.id) : null,
      dayNumber: matchedDay?.day_number != null ? Number(matchedDay.day_number) : dayNumber,
    };
  }

  return { id: null, dayNumber: null };
}

function resolveReservationFromState(
  tripId: number,
  activePlaceId: number | null,
  activePlaceName: string | null,
): {
  reservationId: number | null;
  reservationLabel: string | null;
  stayReservationId: number | null;
} {
  const reservations = listReservations(tripId) as Array<{
    id?: number;
    type?: string | null;
    title?: string | null;
    place_id?: number | null;
    place_name?: string | null;
    accommodation_place_id?: number | null;
    accommodation_name?: string | null;
  }>;

  const normalizedPlaceName = activePlaceName ? normalizeConversationQuery(activePlaceName) : null;
  const matched = reservations.find((reservation) =>
    (activePlaceId != null
      && (Number(reservation.place_id) === Number(activePlaceId)
        || Number(reservation.accommodation_place_id) === Number(activePlaceId)))
    || (normalizedPlaceName
      && normalizeConversationQuery(reservation.place_name || reservation.accommodation_name || '').includes(normalizedPlaceName))
  ) || null;

  return {
    reservationId: matched?.id != null ? Number(matched.id) : null,
    reservationLabel: matched?.accommodation_name || matched?.place_name || matched?.title || null,
    stayReservationId: matched?.type === 'hotel' && matched?.id != null ? Number(matched.id) : null,
  };
}

interface ParsedComparisonRequest {
  originText: string | null;
  destinationText: string | null;
  travelMode: ComparisonTravelMode | null;
  comparisonType: ComparisonType | null;
}

interface DerivedComparisonState {
  originPlaceId: number | null;
  originPlaceName: string | null;
  destinationPlaceId: number | null;
  destinationPlaceName: string | null;
  travelMode: ComparisonTravelMode | null;
  comparisonType: ComparisonType | null;
}

function extractComparisonTravelMode(message: string): ComparisonTravelMode | null {
  const lower = normalizeConversationQuery(message);
  if (/\bwalk\b|\bwalking\b|\bon foot\b/.test(lower)) return 'walking';
  if (/\bdrive\b|\bdriving\b|\bcar\b/.test(lower)) return 'driving';
  if (/\bpublic transit\b|\btransit\b|\bbus\b|\btrain\b|\bsubway\b|\bmetro\b/.test(lower)) return 'transit';
  return null;
}

function extractComparisonType(message: string): ComparisonType | null {
  const lower = normalizeConversationQuery(message);
  if (/\bhow long\b|\btravel time\b|\bminutes\b|\bminute\b|\bhours\b|\bhour\b/.test(lower)) return 'travel_time';
  if (/\bhow close\b|\bhow far\b|\bdistance\b|\bclose is\b|\bfar is\b/.test(lower)) return 'distance';
  return null;
}

function parseExplicitComparisonRequest(message: string): ParsedComparisonRequest | null {
  const lower = normalizeConversationQuery(message);
  const travelMode = extractComparisonTravelMode(lower);
  const comparisonType = extractComparisonType(lower) || (travelMode ? 'travel_time' : null);
  const patterns: Array<{ regex: RegExp; originIndex: number; destinationIndex: number }> = [
    { regex: /^(?:how close|how far)\s+is\s+(.+?)\s+(?:to|from)\s+(.+)$/, originIndex: 1, destinationIndex: 2 },
    { regex: /^(?:what is|what's)\s+the\s+distance\s+(?:from|between)\s+(.+?)\s+(?:to|and)\s+(.+)$/, originIndex: 1, destinationIndex: 2 },
    { regex: /^(?:how long(?: would it take)?(?: to)?(?: walk| drive| get)?)\s+(?:from\s+)?(.+?)\s+(?:to)\s+(.+)$/, originIndex: 1, destinationIndex: 2 },
    { regex: /^(?:what is|what's)\s+the\s+(?:walking|driving|transit)\s+time\s+(?:from\s+)?(.+?)\s+(?:to)\s+(.+)$/, originIndex: 1, destinationIndex: 2 },
    { regex: /^(?:where is|show me)?\s*distance\s+from\s+(.+?)\s+to\s+(.+)$/, originIndex: 1, destinationIndex: 2 },
    { regex: /^(?:how close|how far)\s+is\s+it\s+(?:to|from)\s+(.+)$/, originIndex: 0, destinationIndex: 1 },
    { regex: /^(?:how long(?: would it take)?(?: to)?(?: walk| drive| get)?)\s+to\s+(.+)$/, originIndex: 0, destinationIndex: 1 },
  ];

  for (const pattern of patterns) {
    const match = lower.match(pattern.regex);
    if (!match) continue;
    return {
      originText: pattern.originIndex > 0 ? match[pattern.originIndex].trim() : null,
      destinationText: match[pattern.destinationIndex]?.trim() || null,
      travelMode,
      comparisonType,
    };
  }

  return null;
}

function parseComparisonFollowUp(message: string): { placeText?: string; side?: 'origin' | 'destination'; travelMode?: ComparisonTravelMode; comparisonType?: ComparisonType } | null {
  const lower = normalizeConversationQuery(message);
  const travelMode = extractComparisonTravelMode(lower);
  const comparisonType = extractComparisonType(lower) || (travelMode ? 'travel_time' : null);
  const toMatch = lower.match(/^(?:how about|what about|and)\s+(?:to\s+)?(.+)$/);
  if (toMatch?.[1]) {
    const candidate = toMatch[1].trim();
    if (!candidate) return travelMode || comparisonType ? { travelMode: travelMode || undefined, comparisonType: comparisonType || undefined } : null;
    if (!extractComparisonTravelMode(candidate) && !/^(walking|driving|public transit|transit)$/.test(candidate)) {
      return {
        placeText: candidate,
        side: /\bto\b/.test(lower) ? 'destination' : 'origin',
        travelMode: travelMode || undefined,
        comparisonType: comparisonType || undefined,
      };
    }
  }

  if (travelMode || comparisonType) {
    return {
      travelMode: travelMode || undefined,
      comparisonType: comparisonType || undefined,
    };
  }

  return null;
}

function resolvePlaceTextToPlace(
  tripId: number,
  text: string | null | undefined,
  selectedPlaceId: number | null,
  history?: AssistantQueryInput['history'],
): any | null {
  if (!text) return null;
  return resolveSavedTripPlace({
    tripId,
    message: null,
    selectedPlaceId,
    explicitPlaceName: text,
    history,
  }) as any;
}

function deriveComparisonState(
  input: AssistantQueryInput,
  currentResolvedPlace: any | null,
  priorResolvedPlace: any | null,
): DerivedComparisonState {
  const entries = [...(input.history || [])].filter((entry) => entry.role === 'user');
  let state: DerivedComparisonState = {
    originPlaceId: null,
    originPlaceName: null,
    destinationPlaceId: null,
    destinationPlaceName: null,
    travelMode: null,
    comparisonType: null,
  };

  const applyMessage = (message: string, allowPlaceFallback: boolean) => {
    const explicit = parseExplicitComparisonRequest(message);
    if (explicit) {
      const fallbackPlace = allowPlaceFallback ? (priorResolvedPlace || currentResolvedPlace) : null;
      const originPlace = explicit.originText
        ? resolvePlaceTextToPlace(input.tripId, explicit.originText, input.context?.selected_place_id ?? null, input.history)
        : (fallbackPlace || (state.originPlaceId != null
          ? { id: state.originPlaceId, name: state.originPlaceName }
          : null));
      const destinationPlace = explicit.destinationText
        ? resolvePlaceTextToPlace(input.tripId, explicit.destinationText, input.context?.selected_place_id ?? null, input.history)
        : (state.destinationPlaceId != null ? { id: state.destinationPlaceId, name: state.destinationPlaceName } : null);

      state = {
        originPlaceId: originPlace?.id != null ? Number(originPlace.id) : state.originPlaceId,
        originPlaceName: originPlace?.name
          ? String(originPlace.name)
          : (explicit.originText || state.originPlaceName),
        destinationPlaceId: destinationPlace?.id != null ? Number(destinationPlace.id) : state.destinationPlaceId,
        destinationPlaceName: destinationPlace?.name
          ? String(destinationPlace.name)
          : (explicit.destinationText || state.destinationPlaceName),
        travelMode: explicit.travelMode || state.travelMode,
        comparisonType: explicit.comparisonType || state.comparisonType || 'distance',
      };
      return;
    }

    const followUp = parseComparisonFollowUp(message);
    if (!followUp) return;
    const referencedPlace = followUp.placeText
      ? resolvePlaceTextToPlace(input.tripId, followUp.placeText, input.context?.selected_place_id ?? null, input.history)
      : null;
    if (referencedPlace) {
      if (followUp.side === 'destination') {
        state.destinationPlaceId = Number(referencedPlace.id);
        state.destinationPlaceName = String(referencedPlace.name || '');
      } else {
        state.originPlaceId = Number(referencedPlace.id);
        state.originPlaceName = String(referencedPlace.name || '');
      }
    } else if (followUp.placeText) {
      if (followUp.side === 'destination') {
        state.destinationPlaceId = null;
        state.destinationPlaceName = followUp.placeText;
      } else {
        state.originPlaceId = null;
        state.originPlaceName = followUp.placeText;
      }
    }
    if (followUp.travelMode) state.travelMode = followUp.travelMode;
    if (followUp.comparisonType) state.comparisonType = followUp.comparisonType;
  };

  for (const entry of entries) {
    applyMessage(entry.content, false);
  }
  applyMessage(input.message, true);

  return state;
}

export function deriveAssistantConversationState(
  input: AssistantQueryInput,
): AssistantConversationState {
  const allPlaces = listPlaces(String(input.tripId), {}) as any[];
  const priorResolvedPlace = resolveSavedTripPlace({
    tripId: input.tripId,
    message: null,
    selectedPlaceId: input.context?.selected_place_id ?? null,
    history: input.history,
  }) as any;
  const resultSet = deriveResultSet(input.tripId, input.message, input.history);
  const ordinalReference = extractOrdinalReference(input.message);
  const normalizedMessage = normalizeConversationQuery(input.message);
  let resolvedPlace = resolveSavedTripPlace({
    tripId: input.tripId,
    message: input.message,
    selectedPlaceId: input.context?.selected_place_id ?? null,
    history: input.history,
  }) as any;

  if (!resolvedPlace && isReferenceMessage(input.message) && resultSet.placeIds.length > 0) {
    let targetPlaceId: number | null = null;
    if (/\bother ones\b/.test(normalizedMessage)) {
      targetPlaceId = null;
    } else if (/\bother one\b/.test(normalizedMessage) && priorResolvedPlace?.id != null) {
      targetPlaceId = resultSet.placeIds.find((id) => Number(id) !== Number(priorResolvedPlace.id)) ?? null;
    } else {
      const targetIndex = ordinalReference != null ? ordinalReference - 1 : 0;
      targetPlaceId = resultSet.placeIds[targetIndex] ?? null;
    }
    if (targetPlaceId != null) {
      resolvedPlace = allPlaces.find((place) => Number(place.id) === Number(targetPlaceId)) || null;
    }
  }

  const previousDay = resolveDayFromInput(input.tripId, '', input.context?.selected_day_id ?? null, input.history);
  const activeDay = resolveDayFromInput(input.tripId, input.message, input.context?.selected_day_id ?? null, input.history);
  const reservationState = resolveReservationFromState(
    input.tripId,
    resolvedPlace?.id != null ? Number(resolvedPlace.id) : null,
    resolvedPlace?.name ? String(resolvedPlace.name) : null,
  );
  const comparisonState = deriveComparisonState(input, resolvedPlace, priorResolvedPlace);
  const categoryFromResolvedPlace = mapPlaceCategoryToScope(resolvedPlace?.category?.name || resolvedPlace?.category_name || null);
  const categoryFromMessage = extractPlaceCategoryScope(input.message);
  const categoryFromHistory = inferCategoryScopeFromHistory(input.history);
  const activeSubjectKind: AssistantConversationState['activeSubjectKind'] =
    reservationState.stayReservationId != null ? 'stay'
      : reservationState.reservationId != null ? 'reservation'
      : resolvedPlace ? 'place'
      : activeDay.id != null ? 'day'
      : (resultSet.kind ? 'result_set' : null);

  return {
    previousPlaceId: priorResolvedPlace?.id != null ? Number(priorResolvedPlace.id) : null,
    previousPlaceName: priorResolvedPlace?.name ? String(priorResolvedPlace.name) : null,
    activePlaceId: resolvedPlace?.id != null ? Number(resolvedPlace.id) : null,
    activePlaceName: resolvedPlace?.name ? String(resolvedPlace.name) : null,
    activePlaceCategory: resolvedPlace?.category?.name || resolvedPlace?.category_name || null,
    activePlaceCategoryScope: categoryFromResolvedPlace || categoryFromMessage || resultSet.scope || categoryFromHistory,
    previousDayId: previousDay.id,
    previousDayNumber: previousDay.dayNumber,
    activeDayId: activeDay.id,
    activeDayNumber: activeDay.dayNumber,
    activeReservationId: reservationState.reservationId,
    activeReservationLabel: reservationState.reservationLabel,
    activeStayReservationId: reservationState.stayReservationId,
    activeComparisonOriginPlaceId: comparisonState.originPlaceId,
    activeComparisonOriginPlaceName: comparisonState.originPlaceName,
    activeComparisonDestinationPlaceId: comparisonState.destinationPlaceId,
    activeComparisonDestinationPlaceName: comparisonState.destinationPlaceName,
    activeComparisonTravelMode: comparisonState.travelMode,
    activeComparisonType: comparisonState.comparisonType,
    activeSubjectKind,
    activeResultSetKind: resultSet.kind,
    activeResultSetPlaceIds: resultSet.placeIds,
    activeReferenceOrdinal: ordinalReference,
  };
}
