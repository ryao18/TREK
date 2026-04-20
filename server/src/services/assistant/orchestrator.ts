import { AssistantQueryInput, AssistantResponse } from './types';
import {
  getBudgetSummary,
  getDayPlan,
  getDayWeatherContext,
  getPackingSummary,
  getReservationsSummary,
  getTodoSummary,
  getTripDays,
  getTripMembersSummary,
  getTripOverview,
  getTripPlaces,
  findNearbyPlaces,
  findSavedNearbyTripPlaces,
  findSavedPlaceLiveDetails,
} from './tools';
import { deriveAssistantConversationState, type ComparisonTravelMode, type PlaceCategoryScope } from './conversationState';
import { completeWithLocalModel, type AssistantCompletionMessage } from './provider';
import { comparePlacesForAssistant, executeAssistantToolCall, getAssistantExternalToolDefinitions } from './toolRuntime';
import { getDetailedWeather } from '../weatherService';
import { getUserSettings } from '../settingsService';
import { getMapsKey } from '../mapsService';

type ToolName =
  | 'get_trip_overview'
  | 'get_trip_days'
  | 'get_trip_places'
  | 'get_day_plan'
  | 'get_day_weather_context'
  | 'get_reservations_summary'
  | 'get_budget_summary'
  | 'get_packing_summary'
  | 'get_todo_summary'
  | 'get_trip_members'
  | 'find_nearby_places';

type ResolvedIntentKind =
  | 'unknown'
  | 'live_search_meta'
  | 'nearby_places'
  | 'place_comparison'
  | 'place_live_detail'
  | 'stay_detail'
  | 'subject_location'
  | 'subject_time'
  | 'subject_confirmation'
  | 'place_knowledge'
  | 'trip_places_filtered'
  | 'result_set_unplanned'
  | 'result_set_others'
  | 'trip_places_full'
  | 'unplanned_places_full'
  | 'planning_status'
  | 'packing_status'
  | 'budget_summary'
  | 'reservations_status'
  | 'open_todo_status'
  | 'busiest_day'
  | 'day_weather'
  | 'day_plan';

interface ResolvedIntent {
  kind: ResolvedIntentKind;
  dayNumber: number | null;
  nearbyQuery?: string | null;
  nearbyAnchor?: string | null;
  nearbyMode?: 'default' | 'show_more' | 'closest' | 'closest_list';
  nearbySource?: 'live' | 'saved_trip';
  placeDetailKind?: 'type' | 'cuisine' | 'rating' | 'website' | 'phone' | 'hours' | 'open_now' | null;
  placeCategoryScope?: PlaceCategoryScope | null;
}

function normalizeAssistantQuery(message: string): string {
  return String(message || '')
    .toLowerCase()
    .replace(/[?!.,;:]+/g, ' ')
    .replace(/\blistall\b/g, 'list all')
    .replace(/\baout\b/g, 'about')
    .replace(/\bsitll\b/g, 'still')
    .replace(/\bsiill\b/g, 'still')
    .replace(/\bweahter\b/g, 'weather')
    .replace(/\bwaehter\b/g, 'weather')
    .replace(/\bwether\b/g, 'weather')
    .replace(/\bhich\b/g, 'which')
    .replace(/\s+/g, ' ')
    .trim();
}

function isWeatherFollowUpQuery(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return /\bhow about day\s+\d{1,2}\b|\bwhat about day\s+\d{1,2}\b|^day\s+\d{1,2}$/.test(lower);
}

function isWeatherConversation(history?: AssistantQueryInput['history']): boolean {
  const recent = (history || []).slice(-2);
  return recent.some((entry) => /\bweather\b|\bforecast\b|\btemperature\b|\brain\b/.test(normalizeAssistantQuery(entry.content)));
}

function isGenericFollowUpQuery(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return /^(how about|what about|and then|and)\b/.test(lower)
    || /^day\s+\d{1,2}$/.test(lower)
    || /^this day$/.test(lower)
    || /^today$/.test(lower)
    || /^selected day$/.test(lower);
}

function isNearbyShowMoreQuery(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return /^more$/.test(lower)
    || /^show more$/.test(lower)
    || /^show me more$/.test(lower)
    || /^show more results$/.test(lower)
    || /^list more$/.test(lower)
    || /^show more nearby places$/.test(lower);
}

function isNearbyClosestQuery(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return /\bwhich one is closest\b|\bwhich is closest\b|\bwhat is closest\b|\bclosest one\b|\bclosest result\b|\bnearest one\b|\bwhich one is nearest\b/.test(lower);
}

function isNearbyClosestListQuery(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return /\bwhich ones are closest\b|\bwhich are closest\b|\bwhat are the closest ones\b|\bwhich of those are closest\b|\bnearest ones\b/.test(lower);
}

function normalizeNearbyQuery(query: string): string {
  const normalized = normalizeAssistantQuery(query)
    .replace(/^(show|find|list|what about|how about|show me|some)\s+/g, '')
    .replace(/\bsaved\b|\btrip\b|\btrek\b/g, ' ')
    .replace(/\bplaces\b/g, 'places')
    .trim();

  if (/\bplaces to visit\b|\bthings to do\b|\bplaces to see\b/.test(normalized)) return 'attractions';
  if (/^visit$/.test(normalized)) return 'attractions';
  return normalized.replace(/\s+/g, ' ').trim();
}

function isSavedNearbyRequest(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return /\bsaved\b|\btrip\b|\btrek\b/.test(lower);
}

function parseNearbyClosestRequest(message: string): { query: string; anchorText: string | null } | null {
  const lower = normalizeAssistantQuery(message);
  const explicitAnchor = lower.match(/^(?:where is|what is|show me)?\s*the\s+(?:closest|nearest)\s+(.+?)\s+(?:to|near)\s+(.+)$/);
  if (explicitAnchor) {
    return {
      query: normalizeNearbyQuery(explicitAnchor[1]),
      anchorText: explicitAnchor[2].trim(),
    };
  }

  const relativeTo = lower.match(/^(?:where is|what is|show me)?\s*closest\s+(.+?)\s+(?:to|near)\s+(.+)$/);
  if (relativeTo) {
    return {
      query: normalizeNearbyQuery(relativeTo[1]),
      anchorText: relativeTo[2].trim(),
    };
  }

  const followUp = lower.match(/^(?:where is|what is|show me)?\s*the\s+(?:closest|nearest)\s+(.+)$/);
  if (followUp) {
    return {
      query: normalizeNearbyQuery(followUp[1]),
      anchorText: null,
    };
  }

  return null;
}

function parseNearbyCategoryFollowUp(message: string): string | null {
  const lower = normalizeAssistantQuery(message);
  const stripped = lower.replace(/^(what about|how about|show me|find|list)\s+/g, '').trim();
  if (!stripped) return null;
  if (!/\b(shop|shops|restaurant|restaurants|cafe|cafes|coffee|boba|bubble tea|tea|grocery|groceries|store|stores|attraction|attractions|museum|museums|park|parks|pharmacy|pharmacies|places to visit|things to do|places to see)\b/.test(stripped)) {
    return null;
  }
  return normalizeNearbyQuery(stripped);
}

function isLiveSearchMetaRequest(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return /\bdo you have access to google maps\b|\bdo you have access to maps\b|\bdo you have access to external\b|\byou have access to google maps\b|\bhow did you find these places\b|\bwhere did you source these external results\b|\bwhere did you source these results\b|\bhow did you source these\b|\bhow did you get these results\b|\bwhere did these external results come from\b/.test(lower);
}

function isExplicitPlaceComparisonRequest(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return /\bhow close is\b.+\b(?:to|from)\b.+/.test(lower)
    || /\bhow far is\b.+\b(?:to|from)\b.+/.test(lower)
    || /\bwhat(?:'s| is) the distance\b.+\b(?:from|between)\b.+/.test(lower)
    || /\bhow long\b.+\bto\b.+/.test(lower)
    || /\bhow close is it\b.+\b(?:to|from)\b.+/.test(lower)
    || /\bhow far is it\b.+\b(?:to|from)\b.+/.test(lower);
}

function isComparisonTravelModeFollowUp(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return /^(?:how about|what about|and)\s+(?:walking|driving|public transit|transit)\b/.test(lower)
    || /^(?:walking|driving|public transit|transit)$/.test(lower);
}

function isComparisonPlaceFollowUp(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return /^(?:how about|what about|and)\s+(?:to\s+)?[^?]+$/.test(lower)
    && !isComparisonTravelModeFollowUp(lower)
    && !isCategoryPlaceListRequest(lower)
    && !isSavedPlaceLiveDetailQuestion(lower);
}

function extractPlaceDetailKind(message: string): ResolvedIntent['placeDetailKind'] {
  const lower = normalizeAssistantQuery(message);
  if (/\bopen now\b|\bopen right now\b|\bis it open\b/.test(lower)) return 'open_now';
  if (/\bhours\b|\bopening hours\b|\bwhat time does .* open\b|\bwhat time does .* close\b|\bwhen does .* open\b|\bwhen does .* close\b/.test(lower)) return 'hours';
  if (/\brating\b|\breview count\b|\bhow many reviews\b/.test(lower)) return 'rating';
  if (/\bwebsite\b|\bweb site\b|\burl\b/.test(lower)) return 'website';
  if (/\bphone\b|\bphone number\b|\btelephone\b/.test(lower)) return 'phone';
  if (/\bwhat kind of(?:\s+of)*\s+food\b|\bwhat cuisine\b|\bcuisine\b/.test(lower)) return 'cuisine';
  if (/\bwhat kind of place\b|\bwhat type of place\b|\bwhat is this place\b|\bwhat's this place\b|\bis this a\b/.test(lower)) return 'type';
  return null;
}

function isStayDetailRequest(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return /\bcheck in\b|\bcheck-in\b|\bcheck out\b|\bcheck-out\b/.test(lower);
}

function isSubjectLocationRequest(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return /\bwhere is it\b|\bwhere is this\b|\bwhere is that\b|\bwhere is this place\b|\bwhere is that place\b|\bwhere is the first one\b|\bwhere is the second one\b/.test(lower);
}

function isOrdinalReferenceLocationRequest(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return /\bwhere is the first one\b|\bwhere is the second one\b|\bwhere is the third one\b|\bwhere is that one\b|\bwhere is this one\b/.test(lower);
}

function isSubjectTimeRequest(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return /\bwhen is it\b|\bwhat time is it\b|\bwhen is that\b|\bwhen is this\b/.test(lower);
}

function isSubjectConfirmationRequest(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return /\bis it confirmed\b|\bis that confirmed\b|\bis this confirmed\b|\bwhat is its status\b|\bwhat's its status\b/.test(lower);
}

function isSavedPlaceLiveDetailQuestion(message: string): boolean {
  return extractPlaceDetailKind(message) !== null;
}

function inferIntentKindFromMessage(message: string, selectedDayId?: number | null): ResolvedIntentKind {
  if (isLiveSearchMetaRequest(message)) return 'live_search_meta';
  if (isNearbyPlacesRequest(message)) return 'nearby_places';
  if (isExplicitPlaceComparisonRequest(message)) return 'place_comparison';
  if (isSavedPlaceLiveDetailQuestion(message)) return 'place_live_detail';
  if (isStayDetailRequest(message)) return 'stay_detail';
  if (isSubjectLocationRequest(message)) return 'subject_location';
  if (isSubjectTimeRequest(message)) return 'subject_time';
  if (isSubjectConfirmationRequest(message)) return 'subject_confirmation';
  if (isPlaceKnowledgeQuestion(message)) return 'place_knowledge';
  if (isResultSetUnplannedRequest(message)) return 'result_set_unplanned';
  if (isResultSetOthersRequest(message)) return 'result_set_others';
  if (isExplicitTripPlaceListRequest(message)) return 'trip_places_full';
  if (isExplicitUnplannedPlaceListRequest(message)) return 'unplanned_places_full';
  if (isPlanningStatusRequest(message)) return 'planning_status';
  if (isPackingStatusRequest(message)) return 'packing_status';
  if (isBudgetSummaryRequest(message)) return 'budget_summary';
  if (isReservationsStatusRequest(message)) return 'reservations_status';
  if (isOpenTodoStatusRequest(message)) return 'open_todo_status';
  if (isBusiestDayRequest(message)) return 'busiest_day';
  if (isDayWeatherRequest(message, selectedDayId)) return 'day_weather';
  if (isDayPlanRequest(message, selectedDayId)) return 'day_plan';
  return 'unknown';
}

function inferPriorIntent(history?: AssistantQueryInput['history'], selectedDayId?: number | null): ResolvedIntentKind {
  const entries = [...(history || [])].reverse();
  for (const entry of entries) {
    if (entry.role !== 'user') continue;
    const kind = inferIntentKindFromMessage(entry.content, selectedDayId);
    if (kind !== 'unknown') return kind;
  }
  return 'unknown';
}

function extractPriorPlaceDetailKind(history?: AssistantQueryInput['history']): ResolvedIntent['placeDetailKind'] {
  const entries = [...(history || [])].reverse();
  for (const entry of entries) {
    if (entry.role !== 'user') continue;
    const detailKind = extractPlaceDetailKind(entry.content);
    if (detailKind) return detailKind;
  }
  return null;
}

function extractPriorNearbyRequest(history?: AssistantQueryInput['history']): { query: string; anchorText: string | null } | null {
  const entries = [...(history || [])].reverse();
  for (const entry of entries) {
    if (entry.role !== 'user') continue;
    const parsed = parseNearbyClosestRequest(entry.content) || parseNearbySearchRequest(entry.content);
    if (parsed) return parsed;
  }
  return null;
}

function extractPriorNearbySource(history?: AssistantQueryInput['history']): 'live' | 'saved_trip' | null {
  const entries = [...(history || [])].reverse();
  for (const entry of entries) {
    if (entry.role !== 'user') continue;
    if ((parseNearbyClosestRequest(entry.content) || parseNearbySearchRequest(entry.content)) == null) continue;
    return isSavedNearbyRequest(entry.content) ? 'saved_trip' : 'live';
  }
  return null;
}

function resolveAssistantIntent(input: AssistantQueryInput): ResolvedIntent {
  const conversationState = deriveAssistantConversationState(input);
  const dayNumber = extractRequestedDayNumber(input.message);
  const directKind = inferIntentKindFromMessage(input.message, input.context?.selected_day_id);
  const directPlaceDetailKind = extractPlaceDetailKind(input.message);
  const directClosestRequest = parseNearbyClosestRequest(input.message);
  const directNearbyRequest = parseNearbySearchRequest(input.message);
  const nearbyFollowUpQuery = parseNearbyCategoryFollowUp(input.message);
  const priorNearbyRequest = extractPriorNearbyRequest(input.history);
  const priorNearbySource = extractPriorNearbySource(input.history);
  const priorPlaceDetailKind = extractPriorPlaceDetailKind(input.history);
  const isNearbyFollowUp = isNearbyShowMoreQuery(input.message) || isNearbyClosestQuery(input.message) || isNearbyClosestListQuery(input.message) || !!nearbyFollowUpQuery;
  const nearbyMode = isNearbyClosestListQuery(input.message)
    ? 'closest_list'
    : directClosestRequest || isNearbyClosestQuery(input.message)
    ? 'closest'
    : isNearbyShowMoreQuery(input.message)
      ? 'show_more'
      : 'default';
  const nearbySource = isSavedNearbyRequest(input.message)
    ? 'saved_trip'
    : (isNearbyFollowUp ? (priorNearbySource || 'live') : 'live');
  const nearbyRequest = directClosestRequest || directNearbyRequest || (nearbyFollowUpQuery && priorNearbyRequest ? {
    query: nearbyFollowUpQuery,
    anchorText: priorNearbyRequest.anchorText,
  } : null);
  if (directKind !== 'unknown') {
    if (directKind === 'subject_location' && isOrdinalReferenceLocationRequest(input.message) && conversationState.activeResultSetKind == null) {
      return {
        kind: 'unknown',
        dayNumber,
        nearbyQuery: nearbyRequest?.query || null,
        nearbyAnchor: nearbyRequest?.anchorText || priorNearbyRequest?.anchorText || null,
        nearbyMode,
        nearbySource,
        placeDetailKind: directPlaceDetailKind,
        placeCategoryScope: conversationState.activePlaceCategoryScope,
      };
    }
    return {
      kind: directKind,
      dayNumber,
      nearbyQuery: nearbyRequest?.query || null,
      nearbyAnchor: nearbyRequest?.anchorText || priorNearbyRequest?.anchorText || null,
      nearbyMode,
      nearbySource,
      placeDetailKind: directPlaceDetailKind,
      placeCategoryScope: conversationState.activePlaceCategoryScope,
    };
  }

  const normalized = normalizeAssistantQuery(input.message);
  const hasActiveComparison = !!(
    conversationState.activeComparisonOriginPlaceName
    && conversationState.activeComparisonDestinationPlaceName
  );
  if (hasActiveComparison && (isComparisonTravelModeFollowUp(input.message) || isComparisonPlaceFollowUp(input.message))) {
    return {
      kind: 'place_comparison',
      dayNumber,
      nearbyQuery: nearbyRequest?.query || null,
      nearbyAnchor: nearbyRequest?.anchorText || priorNearbyRequest?.anchorText || null,
      nearbyMode,
      nearbySource,
      placeDetailKind: directPlaceDetailKind,
      placeCategoryScope: conversationState.activePlaceCategoryScope,
    };
  }
  if (isCategoryPlaceListRequest(input.message) && conversationState.activePlaceCategoryScope) {
    return {
      kind: 'trip_places_filtered',
      dayNumber,
      nearbyQuery: nearbyRequest?.query || null,
      nearbyAnchor: nearbyRequest?.anchorText || priorNearbyRequest?.anchorText || null,
      nearbyMode,
      nearbySource,
      placeDetailKind: directPlaceDetailKind,
      placeCategoryScope: conversationState.activePlaceCategoryScope,
    };
  }
  if (isAddedPlacesReferenceRequest(input.message)) {
    return {
      kind: 'trip_places_full',
      dayNumber,
      nearbyQuery: nearbyRequest?.query || null,
      nearbyAnchor: nearbyRequest?.anchorText || priorNearbyRequest?.anchorText || null,
      nearbyMode,
      nearbySource,
      placeDetailKind: directPlaceDetailKind,
      placeCategoryScope: conversationState.activePlaceCategoryScope,
    };
  }
  if (nearbyRequest && priorNearbyRequest && (nearbyFollowUpQuery || isNearbyShowMoreQuery(normalized) || isNearbyClosestQuery(normalized) || isNearbyClosestListQuery(normalized))) {
    return {
      kind: 'nearby_places',
      dayNumber,
      nearbyQuery: nearbyRequest.query,
      nearbyAnchor: nearbyRequest.anchorText || priorNearbyRequest.anchorText || null,
      nearbyMode,
      nearbySource: isSavedNearbyRequest(input.message) ? 'saved_trip' : (priorNearbySource || 'live'),
      placeDetailKind: directPlaceDetailKind,
      placeCategoryScope: conversationState.activePlaceCategoryScope,
    };
  }

  const priorKind = inferPriorIntent(input.history, input.context?.selected_day_id);
  if (priorKind !== 'unknown' && (isGenericFollowUpQuery(normalized) || isNearbyShowMoreQuery(normalized) || isNearbyClosestQuery(normalized) || isNearbyClosestListQuery(normalized) || (dayNumber && priorKind !== 'busiest_day'))) {
    return {
      kind: priorKind,
      dayNumber,
      nearbyQuery: nearbyRequest?.query || priorNearbyRequest?.query || null,
      nearbyAnchor: nearbyRequest?.anchorText || priorNearbyRequest?.anchorText || null,
      nearbyMode,
      nearbySource: isSavedNearbyRequest(input.message) ? 'saved_trip' : (isNearbyFollowUp ? (priorNearbySource || 'live') : 'live'),
      placeDetailKind: priorKind === 'place_live_detail' ? (directPlaceDetailKind || priorPlaceDetailKind) : directPlaceDetailKind,
      placeCategoryScope: conversationState.activePlaceCategoryScope,
    };
  }

  return {
    kind: 'unknown',
    dayNumber,
    nearbyQuery: nearbyRequest?.query || null,
    nearbyAnchor: nearbyRequest?.anchorText || priorNearbyRequest?.anchorText || null,
    nearbyMode,
    nearbySource,
    placeDetailKind: directPlaceDetailKind,
    placeCategoryScope: conversationState.activePlaceCategoryScope,
  };
}

function selectTools(message: string, selectedDayId?: number | null): ToolName[] {
  const lower = normalizeAssistantQuery(message);
  const tools = new Set<ToolName>(['get_trip_overview']);

  if (selectedDayId || /\bday\b|\bitinerary\b|\bbusiest\b|\bplan\b|\bplanned\b/.test(lower)) {
    tools.add('get_trip_days');
  }
  if (/\bplace\b|\bplaces\b|\blocation\b|\blocations\b|\bactivity\b|\bactivities\b|\badded so far\b/.test(lower)) {
    tools.add('get_trip_places');
  }
  if (selectedDayId && /\bthis day\b|\btoday\b|\bselected day\b|\bday\b|\bitinerary\b|\bplan\b/.test(lower)) {
    tools.add('get_day_plan');
  }
  if (/\breservation\b|\bbooking\b|\bhotel\b|\bflight\b|\btrain\b/.test(lower)) {
    tools.add('get_reservations_summary');
  }
  if (/\bbudget\b|\bcost\b|\bspend\b|\bspent\b|\bprice\b|\bsettlement\b|\bpay\b/.test(lower)) {
    tools.add('get_budget_summary');
  }
  if (/\bpack\b|\bpacking\b|\bluggage\b|\bbag\b/.test(lower)) {
    tools.add('get_packing_summary');
  }
  if (/\btodo\b|\bto-do\b|\btask\b|\bchecklist\b|\bprepare\b|\bplanning\b/.test(lower)) {
    tools.add('get_todo_summary');
  }
  if (/\bwho\b|\bmember\b|\btraveler\b|\bassigned\b|\bparticipant\b/.test(lower)) {
    tools.add('get_trip_members');
  }
  if (tools.size === 1) {
    tools.add('get_trip_days');
    tools.add('get_trip_places');
    tools.add('get_reservations_summary');
    tools.add('get_budget_summary');
    tools.add('get_packing_summary');
    tools.add('get_todo_summary');
  }

  return Array.from(tools);
}

function buildContext(tripId: number, tools: ToolName[]) {
  const context: Record<string, unknown> = {};
  for (const tool of tools) {
    if (tool === 'get_trip_overview') context.get_trip_overview = getTripOverview(tripId);
    if (tool === 'get_trip_days') context.get_trip_days = getTripDays(tripId);
    if (tool === 'get_trip_places') context.get_trip_places = getTripPlaces(tripId);
    if (tool === 'get_day_weather_context') context.get_day_weather_context = null;
    if (tool === 'get_reservations_summary') context.get_reservations_summary = getReservationsSummary(tripId);
    if (tool === 'get_budget_summary') context.get_budget_summary = getBudgetSummary(tripId);
    if (tool === 'get_packing_summary') context.get_packing_summary = getPackingSummary(tripId);
    if (tool === 'get_todo_summary') context.get_todo_summary = getTodoSummary(tripId);
    if (tool === 'get_trip_members') context.get_trip_members = getTripMembersSummary(tripId);
  }
  return context;
}

function isOperationalPlaceQuestion(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return /\bon our itinerary\b|\bitinerary\b|\bday\b|\bplanned\b|\bunplanned\b|\bplan\b|\breservation\b|\bbooking\b|\bnotes\b|\baddress\b|\bcoordinates\b|\bwhere\b|\bwhen\b|\bdid we\b|\bdo we\b/.test(lower);
}

function isFullListRequest(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return /\bfull list\b|\ball\b|\blist everything\b|\bshow all\b|\bevery\b/.test(lower);
}

function shouldIncludeFullPlaceList(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return isFullListRequest(lower) && /\bplace\b|\bplaces\b|\blocation\b|\blocations\b|\bactivity\b|\bactivities\b/.test(lower);
}

function shouldIncludeFullReservationList(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return isFullListRequest(lower) && /\breservation\b|\breservations\b|\bbooking\b|\bbookings\b|\bhotel\b|\bflight\b|\btrain\b/.test(lower);
}

function shouldIncludeFullPackingList(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return isFullListRequest(lower) && /\bpacking\b|\bpack\b|\bluggage\b|\bbag\b|\bitems\b/.test(lower);
}

function shouldIncludeFullTodoList(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return isFullListRequest(lower) && /\btodo\b|\bto-do\b|\btask\b|\btasks\b|\bchecklist\b/.test(lower);
}

function shouldIncludeFullBudgetList(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return isFullListRequest(lower) && /\bbudget\b|\bexpense\b|\bexpenses\b|\bcost\b|\bcosts\b|\bspend\b|\bspent\b/.test(lower);
}

function isPlanningStatusRequest(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return /\bwhat still needs planning\b|\bwhat needs planning\b|\bwhat remains to plan\b|\bwhat is left to plan\b|\bwhat places still need planning\b|\bwhich places still need planning\b|\bwhat places need to be planned\b|\bwhich places need to be planned\b/.test(lower);
}

function parseNearbySearchRequest(message: string): { query: string; anchorText: string | null } | null {
  const lower = normalizeAssistantQuery(message);
  const plainMatch = lower.match(/^what(?:'s| is)\s+near\s+(.+)$/);
  if (plainMatch) {
    return {
      query: 'places',
      anchorText: plainMatch[1].trim(),
    };
  }

  const genericMatch = lower.match(/^(?:what(?:'s| is| are| are some)|which|find|show(?: me)?|list)\s+(.+?)\s+(?:are|is)?\s*near\s+(.+)$/);
  if (genericMatch) {
    return {
      query: normalizeNearbyQuery(genericMatch[1]),
      anchorText: genericMatch[2].trim(),
    };
  }

  const terseMatch = lower.match(/^(.+?)\s+near\s+(.+)$/);
  if (terseMatch && /\b(shop|shops|restaurant|restaurants|cafe|cafes|coffee|boba|bubble tea|tea|grocery|groceries|store|stores|grocery stores|attraction|attractions|museum|museums|park|parks|pharmacy|pharmacies|places|places to visit|things to do|places to see)\b/.test(terseMatch[1])) {
    return {
      query: normalizeNearbyQuery(terseMatch[1]),
      anchorText: terseMatch[2].trim(),
    };
  }

  return null;
}

function isNearbyPlacesRequest(message: string): boolean {
  return parseNearbySearchRequest(message) !== null || parseNearbyClosestRequest(message) !== null;
}

function isExplicitUnplannedPlaceListRequest(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return (
    isFullListRequest(lower)
    && /\bplace\b|\bplaces\b|\blocation\b|\blocations\b|\bactivity\b|\bactivities\b/.test(lower)
    && /\bunplanned\b|\bnot planned\b|\bunassigned\b|\bnot assigned\b|\bwithout a day\b|\bno day assigned\b/.test(lower)
  ) || /\b(?:what|which)\b.*\bplaces?\b.*\b(?:still )?(?:need|needs)\b.*\bplanning\b|\b(?:what|which)\b.*\bplaces?\b.*\b(?:need|needs)\b.*\bto be planned\b/.test(lower);
}

function isResultSetUnplannedRequest(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return /\bwhich of those are still unplanned\b|\bwhich ones are still unplanned\b|\bwhich of those are unplanned\b|\bwhich ones are unplanned\b/.test(lower);
}

function isResultSetOthersRequest(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return /\bwhat about the other ones\b|\bwhat about the others\b|\bshow the other ones\b|\bshow the others\b/.test(lower);
}

function isExplicitTripPlaceListRequest(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return isFullListRequest(lower)
    && (
      /\bplace\b|\bplaces\b|\blocation\b|\blocations\b/.test(lower)
      || /\bthose\s+\d+\+?\s+places\b/.test(lower)
    )
    && !/\bunplanned\b|\bnot planned\b|\bunassigned\b|\bnot assigned\b|\bwithout a day\b|\bno day assigned\b/.test(lower);
}

function isAddedPlacesReferenceRequest(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return /\bplaces i added\b|\bplaces we added\b|\ball the places i added\b|\bthose\s+\d+\+?\s+places\b|\bthe\s+\d+\+?\s+places\b/.test(lower);
}

function isCategoryPlaceListRequest(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  if (!/\bhotels?\b|\baccommodations?\b|\brestaurants?\b|\bfood places?\b|\bfood spots?\b|\bcafes?\b|\bcoffee shops?\b|\bbakeries\b|\btea shops?\b|\bboba\b|\bbubble tea\b|\battractions?\b|\bmuseums?\b|\bparks?\b|\bplaces to visit\b|\bthings to do\b|\bshopping\b|\bshops?\b|\bstores?\b|\bboutiques?\b|\bactivities\b|\bvenues\b/.test(lower)) {
    return false;
  }
  return /\blisted\b|\blist\b|\bshow\b|\bwhat\b|\bwhich\b|\bwhat about\b/.test(lower);
}

function isPackingStatusRequest(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return /\bwho still needs to pack\b|\bwho has not packed\b|\bwho hasn't packed\b|\bwho needs to pack\b/.test(lower);
}

function isBudgetSummaryRequest(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return /\bsummarize our budget\b|\bbudget summary\b|\bwhat is our budget\b|\bhow much have we spent\b|\bhow much is assigned\b/.test(lower);
}

function isReservationsStatusRequest(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return /\bwhat reservations do we have\b|\blist reservations\b|\bshow reservations\b|\bwhich reservations are missing\b|\bwhat reservations are missing\b/.test(lower);
}

function isOpenTodoStatusRequest(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return /\bwhat todos are still open\b|\bwhat to-?dos are still open\b|\bwhat tasks are still open\b|\bopen todos\b|\bopen tasks\b/.test(lower);
}

function isBusiestDayRequest(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  return /\bwhich day is the busiest\b|\bwhat day is the busiest\b|\bbusiest day\b/.test(lower);
}

function isDayWeatherRequest(message: string, selectedDayId?: number | null, history?: AssistantQueryInput['history']): boolean {
  const lower = normalizeAssistantQuery(message);
  const asksWeather = /\bweather\b|\bforecast\b|\btemperature\b|\brain\b/.test(lower);
  if (selectedDayId && asksWeather && /\bthis day\b|\btoday\b|\bselected day\b/.test(lower)) {
    return true;
  }
  if (isWeatherFollowUpQuery(lower) && isWeatherConversation(history)) {
    return true;
  }
  return asksWeather && /\bday\s+\d{1,2}\b|\bthis day\b|\btoday\b|\bselected day\b/.test(lower);
}

function extractRequestedDayNumber(message: string): number | null {
  const match = normalizeAssistantQuery(message).match(/\bday\s+(\d{1,2})\b/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function isDayPlanRequest(message: string, selectedDayId?: number | null): boolean {
  const lower = normalizeAssistantQuery(message);
  if (selectedDayId && /\bthis day\b|\btoday\b|\bselected day\b|\bwhat'?s planned\b|\bwhat is planned\b|\bwhat do we have\b/.test(lower)) {
    return true;
  }
  return /\bwhat'?s planned for day\b|\bwhat is planned for day\b|\bwhat'?s on day\b|\bwhat is on day\b/.test(lower);
}

function formatAmount(value: number, currency?: string | null): string {
  const amount = Number.isFinite(value) ? value : 0;
  return currency ? `${amount} ${currency}` : String(amount);
}

function roundTo(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function formatTemperature(value: number, unit: 'celsius' | 'fahrenheit'): string {
  if (unit === 'fahrenheit') {
    return `${roundTo((value * 9) / 5 + 32, 1)} F`;
  }
  return `${roundTo(value, 1)} C`;
}

function formatPrecipitationMm(value: number, unit: 'celsius' | 'fahrenheit'): string {
  if (unit === 'fahrenheit') {
    return `${roundTo(value / 25.4, 2)} in`;
  }
  return `${roundTo(value, 1)} mm`;
}

function formatWindKmh(value: number, unit: 'celsius' | 'fahrenheit'): string {
  if (unit === 'fahrenheit') {
    return `${roundTo(value * 0.621371, 1)} mph`;
  }
  return `${roundTo(value, 1)} km/h`;
}

function sanitizeAssistantPlainText(content: string): string {
  const normalized = String(content || '')
    .replace(/\r\n/g, '\n')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();

  const lines = normalized
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (/^\|(?:\s*[-:]+\s*\|)+\s*$/.test(trimmed)) {
        return '';
      }
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        return trimmed
          .slice(1, -1)
          .split('|')
          .map((cell) => cell.trim())
          .filter(Boolean)
          .join(' | ');
      }
      return line;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  return lines.trim();
}

function makeDeterministicResponse(
  content: string,
  options?: Partial<Pick<AssistantResponse, 'citations' | 'suggested_actions' | 'warnings' | 'missing_data' | 'follow_up_prompts'>> & {
    tools_used?: string[];
  },
): AssistantResponse {
  return {
    message: {
      role: 'assistant',
      content: sanitizeAssistantPlainText(content),
    },
    citations: options?.citations || [],
    suggested_actions: options?.suggested_actions || [],
    warnings: options?.warnings || [],
    missing_data: options?.missing_data || [],
    follow_up_prompts: options?.follow_up_prompts || [],
    meta: {
      provider: 'deterministic',
      model: 'none',
      tools_used: options?.tools_used || [],
    },
  };
}

function trimContextForPrompt(context: Record<string, unknown>, input: AssistantQueryInput) {
  const next = { ...context } as any;
  const includeFullPlaceList = shouldIncludeFullPlaceList(input.message);
  const includeFullReservationList = shouldIncludeFullReservationList(input.message);
  const includeFullPackingList = shouldIncludeFullPackingList(input.message);
  const includeFullTodoList = shouldIncludeFullTodoList(input.message);
  const includeFullBudgetList = shouldIncludeFullBudgetList(input.message);
  if (Array.isArray(next.get_trip_days)) {
    next.get_trip_days = next.get_trip_days.slice(0, 14);
  }
  if (next.get_trip_places?.items) {
    next.get_trip_places = {
      ...next.get_trip_places,
      items: includeFullPlaceList ? next.get_trip_places.items : next.get_trip_places.items.slice(0, 20),
    };
  }
  if (next.get_reservations_summary?.items) {
    next.get_reservations_summary = {
      ...next.get_reservations_summary,
      items: includeFullReservationList ? next.get_reservations_summary.items : next.get_reservations_summary.items.slice(0, 8),
    };
  }
  if (next.get_packing_summary?.sample_items) {
    next.get_packing_summary = {
      ...next.get_packing_summary,
      sample_items: includeFullPackingList ? next.get_packing_summary.sample_items : next.get_packing_summary.sample_items.slice(0, 6),
    };
  }
  if (next.get_todo_summary?.items) {
    next.get_todo_summary = {
      ...next.get_todo_summary,
      items: includeFullTodoList ? next.get_todo_summary.items : next.get_todo_summary.items.slice(0, 8),
    };
  }
  if (next.get_budget_summary?.items) {
    next.get_budget_summary = {
      ...next.get_budget_summary,
      items: includeFullBudgetList ? next.get_budget_summary.items : next.get_budget_summary.items.slice(0, 6),
      per_person: includeFullBudgetList ? (next.get_budget_summary.per_person || []) : (next.get_budget_summary.per_person || []).slice(0, 6),
      settlement: includeFullBudgetList ? (next.get_budget_summary.settlement || []) : (next.get_budget_summary.settlement || []).slice(0, 6),
    };
  }
  if (next.get_day_plan?.assignments) {
    next.get_day_plan = {
      ...next.get_day_plan,
      assignments: next.get_day_plan.assignments.slice(0, 10),
    };
  }
  return next;
}

function addSelectedDayContext(context: Record<string, unknown>, tripId: number, selectedDayId?: number | null) {
  if (!selectedDayId) return context;
  return {
    ...context,
    ...(context.get_day_plan ? {} : { get_day_plan: getDayPlan(tripId, selectedDayId) }),
  };
}

function buildPrompt(input: AssistantQueryInput, toolContext: Record<string, unknown>) {
  const history = (input.history || []).slice(-10).map(message => `${message.role.toUpperCase()}: ${message.content}`).join('\n');
  const plannerContext = JSON.stringify(input.context || {}, null, 2);
  const serializedTools = JSON.stringify(trimContextForPrompt(toolContext, input), null, 2);

  const systemPrompt = [
    'You are TREK, a read-only trip assistant.',
    'Answer from the provided TREK trip data by default.',
    'When TREK provides live external place data or saved external enrichment through its tools, you may use it, but clearly identify it as external data rather than saved trip data.',
    'When assistant tools for live external place search, live external place details, or mixed place comparisons are available, use them only when they are necessary to answer the user accurately.',
    'Do not claim that you cannot look up live external place data if tool results are available in the conversation.',
    'Do not invent reservations, participants, dates, or costs.',
    'Do not invent external place details such as cuisine, hours, ratings, websites, or phone numbers.',
    'State when data is missing or incomplete.',
    'Keep answers concise and practical in plain text.',
    'Prefer short plain bullet lists or short paragraphs.',
    'Do not use Markdown emphasis, Markdown headings, or code formatting.',
    'Do not use markdown tables unless the user explicitly asks for a table.',
    'Do not add a title or heading unless it improves clarity.',
    'Use TREK terms exactly: days, places, reservations, packing, to-dos, budget.',
    'Do not turn factual status into advice unless the user explicitly asks what to do next.',
    'Do not suggest that you made any direct changes.',
    'If the provided data is only partial, say it is partial instead of fabricating placeholder rows or missing item details.',
  ].join(' ');

  const userPrompt = [
    `Planner context:\n${plannerContext}`,
    history ? `Conversation history:\n${history}` : 'Conversation history:\n(none)',
    `Tool data:\n${serializedTools}`,
    `Latest user message:\n${input.message}`,
  ].join('\n\n');

  return { systemPrompt, userPrompt };
}

async function completeAssistantWithToolLoop(
  input: AssistantQueryInput,
  toolContext: Record<string, unknown>,
): Promise<{
  provider: string;
  model: string;
  content: string;
  warnings: string[];
  citations: AssistantResponse['citations'];
  toolsUsed: string[];
}> {
  const prompt = buildPrompt(input, toolContext);
  const toolDefinitions = getAssistantExternalToolDefinitions();
  const warnings: string[] = [];
  const citations: AssistantResponse['citations'] = [];
  const toolsUsed: string[] = [];
  let messages: AssistantCompletionMessage[] = [
    { role: 'system', content: prompt.systemPrompt },
    { role: 'user', content: prompt.userPrompt },
  ];

  console.info('[assistant] system prompt preview:', {
    tripId: input.tripId,
    userId: input.userId,
    systemMessage: prompt.systemPrompt || null,
  });

  for (let round = 0; round < 3; round += 1) {
    const result = await completeWithLocalModel({
      messages,
      tools: toolDefinitions,
    });
    if (!result.toolCalls.length) {
      return {
        provider: result.provider,
        model: result.model,
        content: result.content,
        warnings,
        citations,
        toolsUsed,
      };
    }

    const roundToolCalls = result.toolCalls.slice(0, 2);
    if (result.toolCalls.length > roundToolCalls.length) {
      warnings.push('Assistant tool calls were capped for this request.');
    }

    messages = [
      ...messages,
      {
        role: 'assistant',
        content: result.content || '',
        tool_calls: roundToolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: 'function' as const,
          function: {
            name: toolCall.name,
            arguments: toolCall.argumentsText,
          },
        })),
      },
    ];

    for (const toolCall of roundToolCalls) {
      const execution = await executeAssistantToolCall(toolCall, {
        tripId: input.tripId,
        userId: input.userId,
        selectedPlaceId: input.context?.selected_place_id ?? null,
        history: input.history,
      });
      messages.push(execution.message);
      warnings.push(...execution.warnings);
      citations.push(...execution.citations);
      toolsUsed.push(...execution.toolsUsed);
    }
  }

  const finalResult = await completeWithLocalModel({ messages });
  return {
    provider: finalResult.provider,
    model: finalResult.model,
    content: finalResult.content,
    warnings,
    citations,
    toolsUsed,
  };
}

function buildCitations(toolContext: Record<string, unknown>, tools: ToolName[]) {
  const citations: AssistantResponse['citations'] = [];
  if (tools.includes('get_trip_overview')) {
    const overview = toolContext.get_trip_overview as any;
    if (overview?.trip?.id) {
      citations.push({ type: 'trip', id: overview.trip.id, label: overview.trip.title || 'Trip overview' });
    }
  }
  if (tools.includes('get_trip_days')) {
    const days = (toolContext.get_trip_days as any[]) || [];
    for (const day of days.slice(0, 5)) {
      citations.push({ type: 'day', id: day.id, label: `Day ${day.day_number}`, meta: { date: day.date || null } });
    }
  }
  if (tools.includes('get_reservations_summary')) {
    const reservations = (toolContext.get_reservations_summary as any)?.items || [];
    for (const reservation of reservations.slice(0, 3)) {
      citations.push({ type: 'reservation', id: reservation.id, label: reservation.title });
    }
  }
  if (tools.includes('get_trip_places')) {
    const places = (toolContext.get_trip_places as any)?.items || [];
    for (const place of places.slice(0, 4)) {
      citations.push({ type: 'place', id: place.id, label: place.name });
    }
  }
  if (tools.includes('get_budget_summary')) {
    const budget = toolContext.get_budget_summary as any;
    if (typeof budget?.total_amount === 'number') {
      citations.push({
        type: 'budget',
        label: `Budget total ${budget.total_amount}${budget.currency ? ` ${budget.currency}` : ''}`,
      });
    }
    for (const person of (budget?.per_person || []).slice(0, 2)) {
      citations.push({
        type: 'member',
        id: person.user_id,
        label: `${person.username}: assigned ${person.total_assigned}`,
      });
    }
  }
  if (tools.includes('get_day_plan')) {
    const dayPlan = toolContext.get_day_plan as any;
    if (dayPlan?.id) {
      citations.push({ type: 'day', id: dayPlan.id, label: `Day ${dayPlan.day_number}`, meta: { date: dayPlan.date || null } });
      for (const assignment of (dayPlan.assignments || []).slice(0, 3)) {
        citations.push({ type: 'place', id: assignment.place_id, label: assignment.place_name });
      }
    }
  }
  if (tools.includes('get_packing_summary')) {
    const packing = toolContext.get_packing_summary as any;
    for (const [owner, stats] of Object.entries(packing?.by_owner || {}).slice(0, 2)) {
      const typed = stats as { checked: number; total: number };
      citations.push({ type: 'packing_owner', label: `${owner}: ${typed.checked}/${typed.total} packed` });
    }
  }
  if (tools.includes('get_todo_summary')) {
    const todo = toolContext.get_todo_summary as any;
    for (const [category, stats] of Object.entries(todo?.by_category || {}).slice(0, 2)) {
      const typed = stats as { checked: number; total: number };
      citations.push({ type: 'todo_category', label: `${category}: ${typed.checked}/${typed.total} done` });
    }
  }
  return citations;
}

function buildSuggestedActions(message: string, toolContext: Record<string, unknown>): AssistantResponse['suggested_actions'] {
  const lower = message.toLowerCase();
  if (/\bpack\b|\bpacking\b/.test(lower)) {
    return [{ type: 'add_packing_item', label: 'Add a packing item', enabled: false, reason: 'Phase 1 is read-only' }];
  }
  if (/\bplace\b|\bplaces\b|\bactivity\b|\bactivities\b/.test(lower)) {
    return [{ type: 'add_place', label: 'Add a place or activity', enabled: false, reason: 'Phase 1 is read-only' }];
  }
  if (/\btodo\b|\btask\b|\bchecklist\b/.test(lower)) {
    return [{ type: 'create_todo_item', label: 'Create a to-do item', enabled: false, reason: 'Phase 1 is read-only' }];
  }
  const reservations = (toolContext.get_reservations_summary as any)?.total ?? 0;
  if (reservations === 0) {
    return [{ type: 'create_reservation', label: 'Add a reservation', enabled: false, reason: 'Phase 1 is read-only' }];
  }
  const budget = toolContext.get_budget_summary as any;
  if (typeof budget?.total_amount === 'number' && budget.total_amount > 0) {
    return [{ type: 'settle_budget', label: 'Settle trip costs', enabled: false, reason: 'Phase 1 is read-only' }];
  }
  return [{ type: 'create_departure_checklist', label: 'Create a departure checklist', enabled: false, reason: 'Phase 1 is read-only' }];
}

function buildFollowUpPrompts(toolContext: Record<string, unknown>, selectedDayId?: number | null): string[] {
  const prompts: string[] = [];
  if (selectedDayId && (toolContext.get_day_plan as any)?.id) {
    prompts.push('Is this day overloaded?');
    prompts.push('What is missing from this day?');
  }
  if ((toolContext.get_reservations_summary as any)?.total) {
    prompts.push('Which reservations still need confirmation?');
  }
  if ((toolContext.get_packing_summary as any)?.total) {
    prompts.push('Who still needs to pack?');
  }
  if ((toolContext.get_trip_places as any)?.total) {
    prompts.push('Which places are still unplanned?');
  }
  if (typeof (toolContext.get_budget_summary as any)?.total_amount === 'number') {
    prompts.push('Summarize our budget');
  }
  prompts.push('What still needs planning?');
  return Array.from(new Set(prompts)).slice(0, 4);
}

function extractMentionedPlaceName(input: AssistantQueryInput, toolContext: Record<string, unknown>): string | null {
  const conversationState = deriveAssistantConversationState(input);
  if (conversationState.activePlaceName) return conversationState.activePlaceName;
  const places = ((toolContext.get_trip_places as any)?.items || []) as Array<{ name?: string }>;
  const normalizedMessage = normalizeAssistantQuery(input.message);
  const matched = places.find((place) => place.name && normalizedMessage.includes(normalizeAssistantQuery(String(place.name))));
  return matched?.name || null;
}

function isPlaceKnowledgeQuestion(message: string): boolean {
  const lower = normalizeAssistantQuery(message);
  if (isSavedPlaceLiveDetailQuestion(lower)) return false;
  if (isOperationalPlaceQuestion(lower)) return false;
  return /\btell me about\b|\btell me more about\b|\bdescribe\b|\bwhat kind of place\b|\bwhat kind of attraction\b|\bwhat is this place\b|\bwhat's this place\b/.test(lower)
    || /^(what is|what's)\s+.+\??$/.test(lower);
}

function buildPlaceKnowledgeGuardrail(input: AssistantQueryInput, toolContext: Record<string, unknown>): AssistantResponse | null {
  if (!isPlaceKnowledgeQuestion(input.message)) return null;
  if (getMapsKey(input.userId)) return null;

  const placeName = extractMentionedPlaceName(input, toolContext);
  if (!placeName) return null;

  const places = ((toolContext.get_trip_places as any)?.items || []) as Array<{
    id?: number;
    name?: string;
    address?: string | null;
    category_name?: string | null;
  }>;
  const place = places.find((entry) => entry.name === placeName);

  const hasDescriptiveData = Boolean(place?.category_name || place?.address);
  if (hasDescriptiveData) return null;

  return {
    message: {
      role: 'assistant',
      content: `I can tell that ${placeName} is in your trip data, but I do not have trusted descriptive information about it in TREK right now. I can still help with itinerary details like which day it appears on, whether it is planned, or whether it has related notes or reservations.`,
    },
    citations: place ? [{ type: 'place', id: place.id ?? null, label: placeName }] : [],
    suggested_actions: [],
    warnings: ['This question needs descriptive place data that is not currently stored in TREK.'],
    missing_data: [`No trusted description is stored for ${placeName}.`],
    follow_up_prompts: [
      `Did we go to ${placeName}?`,
      `What day is ${placeName} on?`,
      `Is ${placeName} planned yet?`,
    ],
    meta: {
      provider: 'guardrail',
      model: 'none',
      tools_used: ['get_trip_places'],
    },
  };
}

function formatExternalTypeLabel(type: string): string {
  return String(type || '').replace(/_/g, ' ').trim().toLowerCase();
}

function filterUsefulExternalTypes(types: string[]): string[] {
  const ignored = new Set(['point of interest', 'establishment', 'food', 'store']);
  return types
    .map(formatExternalTypeLabel)
    .filter((type) => type.length > 0 && !ignored.has(type));
}

function buildSavedPlaceLiveDetailContent(
  detailKind: NonNullable<ResolvedIntent['placeDetailKind']>,
  data: {
    place: any;
    externalData: any;
    liveDetails: Record<string, unknown> | null;
    usedLiveLookup: boolean;
  },
): string {
  const placeName = data.place.name || 'This place';
  const externalTypes = filterUsefulExternalTypes([
    ...((data.liveDetails?.types as string[]) || []),
    ...((data.externalData?.external_types as string[]) || []),
  ]);
  const tripCategory = data.place.category_name || null;
  const liveLabel = data.usedLiveLookup ? 'live external lookup' : 'saved external details';

  if (detailKind === 'type') {
    const bestType = externalTypes[0] || (tripCategory ? String(tripCategory).toLowerCase() : null);
    const lines = [`Place details for ${placeName}`];
    if (tripCategory) lines.push(`- trip category: ${tripCategory}`);
    if (bestType) lines.push(`- ${liveLabel} type: ${bestType}`);
    if (!bestType) lines.push('- a more specific place type is not available right now');
    lines.push(`- source: ${liveLabel}`);
    return lines.join('\n');
  }

  if (detailKind === 'cuisine') {
    const cuisineLike = externalTypes.find((type) => /\brestaurant\b|\bcafe\b|\btea\b|\bcoffee\b|\bbakery\b|\bboba\b/.test(type) && type !== 'restaurant');
    const lines = [`Place details for ${placeName}`];
    if (tripCategory) lines.push(`- trip category: ${tripCategory}`);
    if (cuisineLike) lines.push(`- ${liveLabel} cuisine/type: ${cuisineLike}`);
    else if (tripCategory) {
      lines.push(`- trip data identifies it as: ${tripCategory}`);
      lines.push('- a more specific cuisine label is not available from external place data right now');
    } else lines.push('- a specific cuisine label is not available right now');
    lines.push(`- source: ${liveLabel}`);
    return lines.join('\n');
  }

  if (detailKind === 'rating') {
    const rating = data.liveDetails?.rating ?? data.externalData?.rating ?? null;
    const count = data.liveDetails?.rating_count ?? data.externalData?.rating_count ?? null;
    if (rating == null) return `I don't have a rating for ${placeName} right now.`;
    return [
      `Place details for ${placeName}`,
      `- rating: ${rating}${typeof count === 'number' ? ` (${count} reviews)` : ''}`,
      `- source: ${liveLabel}`,
    ].join('\n');
  }

  if (detailKind === 'website') {
    const website = (typeof data.liveDetails?.website === 'string' && data.liveDetails.website)
      || data.externalData?.website
      || data.place.website
      || null;
    if (!website) return `I don't have a website for ${placeName} right now.`;
    return [
      `Place details for ${placeName}`,
      `- website: ${website}`,
      `- source: ${data.liveDetails?.website ? liveLabel : (data.place.website ? 'trip data' : 'saved external details')}`,
    ].join('\n');
  }

  if (detailKind === 'phone') {
    const phone = (typeof data.liveDetails?.phone === 'string' && data.liveDetails.phone)
      || data.externalData?.phone
      || data.place.phone
      || null;
    if (!phone) return `I don't have a phone number for ${placeName} right now.`;
    return [
      `Place details for ${placeName}`,
      `- phone: ${phone}`,
      `- source: ${data.liveDetails?.phone ? liveLabel : (data.place.phone ? 'trip data' : 'saved external details')}`,
    ].join('\n');
  }

  if (detailKind === 'hours') {
    const hours = Array.isArray(data.liveDetails?.opening_hours) ? (data.liveDetails.opening_hours as string[]) : [];
    if (!hours.length) return `I don't have live opening hours for ${placeName} right now.`;
    return [
      `Live place details for ${placeName}`,
      ...hours.map((line) => `- ${line}`),
      '- source: live external lookup',
    ].join('\n');
  }

  if (detailKind === 'open_now') {
    const openNow = data.liveDetails?.open_now;
    if (typeof openNow !== 'boolean') return `I don't have live open-now status for ${placeName} right now.`;
    return [
      `Live place details for ${placeName}`,
      `- open now: ${openNow ? 'yes' : 'no'}`,
      '- source: live external lookup',
    ].join('\n');
  }

  return `I couldn't determine which place detail to answer for ${placeName}.`;
}

async function buildSavedPlaceLiveDetailResponse(
  input: AssistantQueryInput,
  resolvedIntent: ResolvedIntent,
): Promise<AssistantResponse> {
  const conversationState = deriveAssistantConversationState(input);
  const detailKind = resolvedIntent.placeDetailKind;
  if (!detailKind) {
    return makeDeterministicResponse('I could not determine which place detail you wanted.', {
      tools_used: ['get_trip_places'],
    });
  }

  const detail = await findSavedPlaceLiveDetails({
    tripId: input.tripId,
    userId: input.userId,
    message: input.message,
    selectedPlaceId: input.context?.selected_place_id ?? null,
    explicitPlaceName: conversationState.activePlaceName,
    history: input.history,
  });

  if (!detail.available || !detail.place) {
    return makeDeterministicResponse('I could not determine which saved place you meant. Try naming the place directly or selecting a place first.', {
      warnings: ['Saved-place detail lookup needs a clear saved place.'],
      follow_up_prompts: ['What kind of food is Four Kings?', 'What is the rating for this place?'],
      tools_used: ['get_trip_places'],
    });
  }

  const content = buildSavedPlaceLiveDetailContent(detailKind, {
    place: detail.place,
    externalData: detail.externalData,
    liveDetails: detail.liveDetails,
    usedLiveLookup: detail.usedLiveLookup,
  });

  const warnings: string[] = [];
  if (!detail.place.google_place_id) warnings.push('A confident Google place match was not saved for this place yet.');
  if ((detailKind === 'hours' || detailKind === 'open_now') && !detail.liveDetails) {
    warnings.push('Live operational details are unavailable right now.');
  }

  return makeDeterministicResponse(content, {
    citations: [{ type: 'place', id: detail.place.id ?? null, label: detail.place.name || 'Saved place' }],
    warnings,
    follow_up_prompts: ['What is the rating for this place?', 'Does this place have a website?', 'What are this place\'s hours?'],
    tools_used: ['get_trip_places'],
  });
}

function buildResultSetUnplannedResponse(input: AssistantQueryInput, toolContext: Record<string, unknown>): AssistantResponse {
  const conversationState = deriveAssistantConversationState(input);
  const places = (((toolContext.get_trip_places as any)?.items) || []) as Array<{
    id?: number;
    name?: string;
    has_assignment?: boolean;
    category_name?: string | null;
    address?: string | null;
  }>;
  const scopedPlaces = places.filter((place) => conversationState.activeResultSetPlaceIds.includes(Number(place.id)));
  const unplannedPlaces = scopedPlaces.filter((place) => !place.has_assignment);

  if (scopedPlaces.length === 0) {
    return makeDeterministicResponse('I could not determine which prior list you meant. Ask for the hotels, restaurants, attractions, or another place list again first.', {
      follow_up_prompts: ['What hotels are listed?', 'What restaurants are listed?', 'Show all places'],
      tools_used: ['get_trip_places'],
    });
  }

  if (unplannedPlaces.length === 0) {
    return makeDeterministicResponse('None of those places are still unplanned.', {
      follow_up_prompts: ['What still needs planning?', 'Show all places', 'Which day is the busiest?'],
      tools_used: ['get_trip_places'],
    });
  }

  const lines = unplannedPlaces.map((place, index) => {
    const details = place.category_name || place.address ? ` | ${place.category_name || place.address}` : '';
    return `${index + 1}. ${place.name || 'Unknown place'} | no day assigned${details}`;
  });

  return makeDeterministicResponse(`Unplanned places from that list (${unplannedPlaces.length})\n\n${lines.join('\n')}`, {
    follow_up_prompts: ['What still needs planning?', 'Show all places', 'Which day is the busiest?'],
    tools_used: ['get_trip_places'],
  });
}

function buildResultSetOthersResponse(input: AssistantQueryInput, toolContext: Record<string, unknown>): AssistantResponse {
  const conversationState = deriveAssistantConversationState(input);
  const places = (((toolContext.get_trip_places as any)?.items) || []) as Array<{
    id?: number;
    name?: string;
    has_assignment?: boolean;
    category_name?: string | null;
    address?: string | null;
  }>;
  const scopedPlaces = places.filter((place) => conversationState.activeResultSetPlaceIds.includes(Number(place.id)));
  const otherPlaces = scopedPlaces.filter((place) => Number(place.id) !== Number(conversationState.previousPlaceId));

  if (scopedPlaces.length === 0) {
    return makeDeterministicResponse('I could not determine which prior list you meant. Ask for the hotels, restaurants, attractions, or another place list again first.', {
      follow_up_prompts: ['What hotels are listed?', 'What restaurants are listed?', 'Show all places'],
      tools_used: ['get_trip_places'],
    });
  }

  if (otherPlaces.length === 0) {
    return makeDeterministicResponse('There are no other places left in that list.', {
      follow_up_prompts: ['Show all places', 'Which of those are still unplanned?', 'What still needs planning?'],
      tools_used: ['get_trip_places'],
    });
  }

  const lines = otherPlaces.map((place, index) => {
    const status = place.has_assignment ? 'assigned to a day' : 'no day assigned';
    const details = place.category_name || place.address ? ` | ${place.category_name || place.address}` : '';
    return `${index + 1}. ${place.name || 'Unknown place'} | ${status}${details}`;
  });

  return makeDeterministicResponse(`Other places from that list (${otherPlaces.length})\n\n${lines.join('\n')}`, {
    follow_up_prompts: ['Which of those are still unplanned?', 'Tell me more about the first one', 'Show all places'],
    tools_used: ['get_trip_places'],
  });
}

function buildLiveSearchMetaResponse(input: AssistantQueryInput): AssistantResponse {
  const hasMapsKey = !!getMapsKey(input.userId);
  const priorNearbyRequest = extractPriorNearbyRequest(input.history);
  const liveSearchDescription = priorNearbyRequest?.query
    ? `live external place results for queries like "${priorNearbyRequest.query}"`
    : 'live external place results';
  const lines = hasMapsKey
    ? [
      'Yes. For nearby-place questions, this assistant can use TREK\'s live Google Maps / Places integration.',
      `That is how it found ${liveSearchDescription} even when those places are not saved in your trip.`,
      'Those results are live external search results, not trip data.',
    ]
    : [
      'Not right now. This assistant only uses live external place lookup when a Google Maps / Places key is configured for TREK.',
      'Without that configuration, it can only answer from trip data.',
    ];

  return makeDeterministicResponse(lines.join('\n'), {
    warnings: hasMapsKey ? ['Live nearby-place results come from Google Maps / Places, not saved trip data.'] : [],
    follow_up_prompts: hasMapsKey
      ? ['Where did you source these external results?', 'What attractions are near this place?', 'Show me grocery stores near this place']
      : ['What still needs planning?', 'Which places are still unplanned?'],
    tools_used: hasMapsKey ? ['find_nearby_places'] : [],
  });
}

function buildUnplannedPlacesListResponse(toolContext: Record<string, unknown>): AssistantResponse {
  const places = (((toolContext.get_trip_places as any)?.items) || []) as Array<{
    id?: number;
    name?: string;
    has_assignment?: boolean;
    category_name?: string | null;
    address?: string | null;
  }>;
  const unplannedPlaces = places.filter((place) => !place.has_assignment);

  if (unplannedPlaces.length === 0) {
    return {
      message: {
        role: 'assistant',
        content: 'All places and activities in this trip are already assigned to a day.',
      },
      citations: [],
      suggested_actions: [{ type: 'add_place', label: 'Add a place or activity', enabled: false, reason: 'Phase 1 is read-only' }],
      warnings: [],
      missing_data: [],
      follow_up_prompts: [
        'Which day is the busiest?',
        'What still needs planning?',
        'Summarize this trip',
      ],
      meta: {
        provider: 'deterministic',
        model: 'none',
        tools_used: ['get_trip_places'],
      },
    };
  }

  const lines = unplannedPlaces.map((place, index) => {
    const details = place.category_name || place.address ? ` | ${place.category_name || place.address}` : '';
    return `${index + 1}. ${place.name || 'Unknown place'} | no day assigned${details}`;
  });

  return {
    message: {
      role: 'assistant',
      content: `Unplanned places and activities (${unplannedPlaces.length})\n\n${lines.join('\n')}`,
    },
    citations: [],
    suggested_actions: [{ type: 'add_place', label: 'Add a place or activity', enabled: false, reason: 'Phase 1 is read-only' }],
    warnings: [],
    missing_data: [],
    follow_up_prompts: [
      'Which day is the busiest?',
      'What still needs planning?',
      'Summarize this trip',
    ],
    meta: {
      provider: 'deterministic',
      model: 'none',
      tools_used: ['get_trip_places'],
    },
  };
}

function buildTripPlacesListResponse(toolContext: Record<string, unknown>): AssistantResponse {
  const places = (((toolContext.get_trip_places as any)?.items) || []) as Array<{
    id?: number;
    name?: string;
    has_assignment?: boolean;
    category_name?: string | null;
    address?: string | null;
  }>;

  if (places.length === 0) {
    return makeDeterministicResponse('No places are recorded for this trip yet.', {
      suggested_actions: [{ type: 'add_place', label: 'Add a place or activity', enabled: false, reason: 'Phase 1 is read-only' }],
      follow_up_prompts: ['What still needs planning?', 'Summarize this trip'],
      tools_used: ['get_trip_places'],
    });
  }

  const lines = places.map((place, index) => {
    const status = place.has_assignment ? 'assigned to a day' : 'no day assigned';
    const details = place.category_name || place.address ? ` | ${place.category_name || place.address}` : '';
    return `${index + 1}. ${place.name || 'Unknown place'} | ${status}${details}`;
  });

  return makeDeterministicResponse(`All places in this trip (${places.length})\n\n${lines.join('\n')}`, {
    suggested_actions: [{ type: 'add_place', label: 'Add a place or activity', enabled: false, reason: 'Phase 1 is read-only' }],
    follow_up_prompts: ['Which places are still unplanned?', 'What still needs planning?', 'Summarize this trip'],
    tools_used: ['get_trip_places'],
  });
}

function matchesPlaceCategoryScope(categoryName: string | null | undefined, scope: PlaceCategoryScope | null | undefined): boolean {
  const category = normalizeAssistantQuery(categoryName || '');
  if (!scope || !category) return false;
  if (scope === 'hotel') return /\bhotel\b|\baccommodation\b/.test(category);
  if (scope === 'restaurant') return /\brestaurant\b|\bfood\b/.test(category);
  if (scope === 'cafe') return /\bcafe\b|\bcoffee\b|\btea\b|\bbakery\b|\bbar\/cafe\b|\bbar cafe\b/.test(category);
  if (scope === 'attraction') return /\battraction\b|\bmuseum\b|\bpark\b|\bsight\b/.test(category);
  if (scope === 'shopping') return /\bshopping\b|\bshop\b|\bstore\b/.test(category);
  if (scope === 'activity') return /\bactivity\b|\bvenue\b/.test(category);
  return category.length > 0;
}

function formatScopeLabel(scope: PlaceCategoryScope | null | undefined): string {
  switch (scope) {
    case 'hotel': return 'Hotels';
    case 'restaurant': return 'Restaurants';
    case 'cafe': return 'Cafes';
    case 'attraction': return 'Attractions';
    case 'shopping': return 'Shopping places';
    case 'activity': return 'Activities';
    default: return 'Places';
  }
}

function buildFilteredTripPlacesResponse(toolContext: Record<string, unknown>, scope: PlaceCategoryScope | null | undefined): AssistantResponse {
  const places = (((toolContext.get_trip_places as any)?.items) || []) as Array<{
    id?: number;
    name?: string;
    has_assignment?: boolean;
    category_name?: string | null;
    address?: string | null;
  }>;

  const filteredPlaces = places.filter((place) => matchesPlaceCategoryScope(place.category_name, scope));
  if (filteredPlaces.length === 0) {
    return makeDeterministicResponse(`I couldn't find any ${formatScopeLabel(scope).toLowerCase()} in this trip.`, {
      follow_up_prompts: ['Show all places', 'Which places are still unplanned?', 'What still needs planning?'],
      tools_used: ['get_trip_places'],
    });
  }

  const lines = filteredPlaces.map((place, index) => {
    const status = place.has_assignment ? 'assigned to a day' : 'no day assigned';
    const details = place.category_name || place.address ? ` | ${place.category_name || place.address}` : '';
    return `${index + 1}. ${place.name || 'Unknown place'} | ${status}${details}`;
  });

  return makeDeterministicResponse(`${formatScopeLabel(scope)} listed in your trip:\n\n${lines.join('\n')}`, {
    follow_up_prompts: ['Which of those are still unplanned?', 'Show all places', 'What still needs planning?'],
    tools_used: ['get_trip_places'],
  });
}

function buildStayDetailResponse(input: AssistantQueryInput, toolContext: Record<string, unknown>): AssistantResponse {
  const conversationState = deriveAssistantConversationState(input);
  const reservations = (((toolContext.get_reservations_summary as any)?.items) || []) as Array<{
    id?: number;
    type?: string | null;
    place_id?: number | null;
    place_name?: string | null;
    day_number?: number | null;
    accommodation_place_id?: number | null;
    accommodation_name?: string | null;
    accommodation_check_in?: string | null;
    accommodation_check_out?: string | null;
    confirmation_number?: string | null;
    status?: string | null;
  }>;

  const hotelReservations = reservations.filter((reservation) => reservation.type === 'hotel');
  const activePlaceId = conversationState.activePlaceId;
  const activePlaceName = conversationState.activePlaceName ? normalizeAssistantQuery(conversationState.activePlaceName) : null;
  const matchedReservation = hotelReservations.find((reservation) =>
    (conversationState.activeStayReservationId != null && Number(reservation.id) === Number(conversationState.activeStayReservationId))
    || (conversationState.activeReservationId != null && Number(reservation.id) === Number(conversationState.activeReservationId))
    || (
      conversationState.activeDayNumber != null
      && Number(reservation.day_number ?? NaN) === Number(conversationState.activeDayNumber)
      && hotelReservations.length === 1
    )
    || (
    (activePlaceId != null && (Number(reservation.place_id) === activePlaceId || Number(reservation.accommodation_place_id) === activePlaceId))
    || (activePlaceName && normalizeAssistantQuery(reservation.place_name || reservation.accommodation_name || '').includes(activePlaceName))
  )) || (hotelReservations.length === 1 ? hotelReservations[0] : null);

  if (!matchedReservation) {
    return makeDeterministicResponse('I could not determine which hotel stay you meant. Name the hotel directly or ask about one hotel after selecting it.', {
      warnings: ['Stay details need a clear hotel subject.'],
      follow_up_prompts: ['What hotels are listed?', 'Where is the Club Quarters hotel?', 'What about the hotels?'],
      tools_used: ['get_reservations_summary', 'get_trip_places'],
    });
  }

  const placeName = matchedReservation.accommodation_name || matchedReservation.place_name || conversationState.activePlaceName || 'This hotel';
  const checkIn = matchedReservation.accommodation_check_in || null;
  const checkOut = matchedReservation.accommodation_check_out || null;
  const lines = [`Stay details for ${placeName}`];
  lines.push(`- check in: ${checkIn || 'not recorded'}`);
  lines.push(`- check out: ${checkOut || 'not recorded'}`);
  if (matchedReservation.status) lines.push(`- reservation status: ${matchedReservation.status}`);
  if (matchedReservation.confirmation_number) lines.push(`- confirmation: ${matchedReservation.confirmation_number}`);

  return makeDeterministicResponse(lines.join('\n'), {
    citations: [{ type: 'reservation', id: matchedReservation.id ?? null, label: placeName }],
    follow_up_prompts: ['Where is this hotel?', 'What is the rating for this place?', 'What hotels are listed?'],
    tools_used: ['get_reservations_summary', 'get_trip_places'],
  });
}

function resolveActiveReservationLike(input: AssistantQueryInput, toolContext: Record<string, unknown>) {
  const conversationState = deriveAssistantConversationState(input);
  const reservations = (((toolContext.get_reservations_summary as any)?.items) || []) as Array<{
    id?: number;
    type?: string | null;
    status?: string | null;
    place_id?: number | null;
    place_name?: string | null;
    accommodation_place_id?: number | null;
    accommodation_name?: string | null;
    accommodation_check_in?: string | null;
    accommodation_check_out?: string | null;
    reservation_time?: string | null;
    reservation_end_time?: string | null;
    confirmation_number?: string | null;
    day_number?: number | null;
  }>;
  const activePlaceId = conversationState.activePlaceId;
  const activePlaceName = conversationState.activePlaceName ? normalizeAssistantQuery(conversationState.activePlaceName) : null;
  const matchedReservation = reservations.find((reservation) =>
    (conversationState.activeReservationId != null && Number(reservation.id) === Number(conversationState.activeReservationId))
    || (
      conversationState.activeDayNumber != null
      && Number(reservation.day_number ?? NaN) === Number(conversationState.activeDayNumber)
      && reservations.filter((entry) => Number(entry.day_number ?? NaN) === Number(conversationState.activeDayNumber)).length === 1
    )
    || (
    (activePlaceId != null && (Number(reservation.place_id) === activePlaceId || Number(reservation.accommodation_place_id) === activePlaceId))
    || (activePlaceName && normalizeAssistantQuery(reservation.place_name || reservation.accommodation_name || '').includes(activePlaceName))
  )) || null;

  return {
    conversationState,
    matchedReservation,
  };
}

function buildSubjectLocationResponse(input: AssistantQueryInput, toolContext: Record<string, unknown>): AssistantResponse {
  const { conversationState } = resolveActiveReservationLike(input, toolContext);
  const places = (((toolContext.get_trip_places as any)?.items) || []) as Array<{
    id?: number;
    name?: string;
    address?: string | null;
    category_name?: string | null;
    has_assignment?: boolean;
  }>;
  const activePlace = places.find((place) => Number(place.id) === Number(conversationState.activePlaceId))
    || places.find((place) => conversationState.activePlaceName && normalizeAssistantQuery(place.name || '') === normalizeAssistantQuery(conversationState.activePlaceName));

  if (!activePlace) {
    const activeDay = conversationState.activeDayId != null
      ? (
        (toolContext.get_day_plan as any)?.id === conversationState.activeDayId
          ? (toolContext.get_day_plan as any)
          : (((toolContext.get_trip_days as any[]) || []) as Array<any>).find((day) => Number(day.id) === Number(conversationState.activeDayId))
      )
      : null;
    if (activeDay) {
      const lines = [`Day ${activeDay.day_number || conversationState.activeDayNumber || '?'}`];
      if (activeDay.date) lines.push(`- Date: ${activeDay.date}`);
      const placeNames = Array.isArray(activeDay.assignments)
        ? activeDay.assignments.map((assignment: any) => assignment.place_name).filter(Boolean)
        : Array.isArray(activeDay.place_names)
          ? activeDay.place_names.filter(Boolean)
          : [];
      if (placeNames.length) {
        lines.push(`- Places: ${placeNames.join(', ')}`);
      } else {
        lines.push('- No places are assigned to this day yet.');
      }
      return makeDeterministicResponse(lines.join('\n'), {
        follow_up_prompts: ['What is planned for this day?', 'What still needs planning?', 'Where is this place?'],
        tools_used: ['get_trip_days', ...(toolContext.get_day_plan ? ['get_day_plan'] : [])],
      });
    }
    return makeDeterministicResponse('I could not determine which place you meant. Name the place directly or refer to a specific result first.', {
      follow_up_prompts: ['What hotels are listed?', 'Show all places', 'What restaurants are listed?'],
      tools_used: ['get_trip_places'],
    });
  }

  const lines = [activePlace.name || 'This place'];
  lines.push(`- Address: ${activePlace.address || 'not recorded in the current trip data.'}`);
  if (activePlace.category_name) lines.push(`- Category: ${activePlace.category_name}`);
  lines.push(activePlace.has_assignment ? '- This place is assigned to a day in the itinerary.' : '- This place is not assigned to any day in the current itinerary.');

  return makeDeterministicResponse(lines.join('\n'), {
    citations: [{ type: 'place', id: activePlace.id ?? null, label: activePlace.name || 'Place' }],
    follow_up_prompts: ['What is the rating for this place?', 'Does this place have a website?', 'What are this place\'s hours?'],
    tools_used: ['get_trip_places'],
  });
}

function buildSubjectTimeResponse(input: AssistantQueryInput, toolContext: Record<string, unknown>): AssistantResponse {
  const { conversationState, matchedReservation } = resolveActiveReservationLike(input, toolContext);
  if (!matchedReservation) {
    const activeDayPlan = conversationState.activeDayId != null && (toolContext.get_day_plan as any)?.id === conversationState.activeDayId
      ? (toolContext.get_day_plan as any)
      : null;
    if (activeDayPlan) {
      const lines = [`Timing for Day ${activeDayPlan.day_number || conversationState.activeDayNumber || '?'}`];
      if (activeDayPlan.date) lines.push(`- date: ${activeDayPlan.date}`);
      const timedAssignments = (activeDayPlan.assignments || []).filter((assignment: any) => assignment.place_time || assignment.end_time);
      if (timedAssignments.length) {
        for (const assignment of timedAssignments.slice(0, 5)) {
          const start = assignment.place_time || 'unspecified';
          const end = assignment.end_time ? ` to ${assignment.end_time}` : '';
          lines.push(`- ${assignment.place_name || 'Activity'}: ${start}${end}`);
        }
      } else {
        lines.push('- No specific place times are recorded for this day.');
      }
      return makeDeterministicResponse(lines.join('\n'), {
        follow_up_prompts: ['What is planned for this day?', 'Where is it?', 'What still needs planning?'],
        tools_used: ['get_day_plan'],
      });
    }
    return makeDeterministicResponse('I could not determine which reservation or stay time you meant. Ask about a specific hotel, reservation, or place first.', {
      follow_up_prompts: ['Which reservations still need confirmation?', 'What hotels are listed?', 'What is planned for this day?'],
      tools_used: ['get_reservations_summary', 'get_trip_places', ...(toolContext.get_day_plan ? ['get_day_plan'] : [])],
    });
  }

  const subjectLabel = matchedReservation.accommodation_name || matchedReservation.place_name || conversationState.activePlaceName || 'This item';
  const lines = [`Timing for ${subjectLabel}`];
  if (matchedReservation.type === 'hotel') {
    lines.push(`- check in: ${matchedReservation.accommodation_check_in || 'not recorded'}`);
    lines.push(`- check out: ${matchedReservation.accommodation_check_out || 'not recorded'}`);
  } else {
    lines.push(`- starts: ${matchedReservation.reservation_time || 'not recorded'}`);
    lines.push(`- ends: ${matchedReservation.reservation_end_time || 'not recorded'}`);
  }
  if (matchedReservation.day_number != null) lines.push(`- day: Day ${matchedReservation.day_number}`);

  return makeDeterministicResponse(lines.join('\n'), {
    citations: [{ type: 'reservation', id: matchedReservation.id ?? null, label: subjectLabel }],
    follow_up_prompts: ['Is it confirmed?', 'Where is it?', 'What still needs planning?'],
    tools_used: ['get_reservations_summary', 'get_trip_places'],
  });
}

function buildSubjectConfirmationResponse(input: AssistantQueryInput, toolContext: Record<string, unknown>): AssistantResponse {
  const { conversationState, matchedReservation } = resolveActiveReservationLike(input, toolContext);
  if (!matchedReservation) {
    return makeDeterministicResponse('I could not determine which reservation you meant. Ask about a specific reservation, hotel, or place first.', {
      follow_up_prompts: ['Which reservations still need confirmation?', 'What hotels are listed?', 'What restaurants are listed?'],
      tools_used: ['get_reservations_summary', 'get_trip_places'],
    });
  }

  const subjectLabel = matchedReservation.accommodation_name || matchedReservation.place_name || conversationState.activePlaceName || 'This reservation';
  const lines = [`Reservation status for ${subjectLabel}`];
  lines.push(`- status: ${matchedReservation.status || 'unknown'}`);
  if (matchedReservation.confirmation_number) lines.push(`- confirmation: ${matchedReservation.confirmation_number}`);

  return makeDeterministicResponse(lines.join('\n'), {
    citations: [{ type: 'reservation', id: matchedReservation.id ?? null, label: subjectLabel }],
    follow_up_prompts: ['When is it?', 'Where is it?', 'Which reservations still need confirmation?'],
    tools_used: ['get_reservations_summary', 'get_trip_places'],
  });
}

function buildPlanningStatusResponse(toolContext: Record<string, unknown>): AssistantResponse {
  const places = (((toolContext.get_trip_places as any)?.items) || []) as Array<{ id?: number; name?: string; has_assignment?: boolean }>;
  const reservationSummary = (toolContext.get_reservations_summary as any) || {};
  const reservations = reservationSummary.total ?? 0;
  const unscheduledReservations = Number(reservationSummary.unscheduled_count || 0);
  const todoSummary = (toolContext.get_todo_summary as any) || {};
  const openTodos = Math.max(0, Number(todoSummary.total || 0) - Number(todoSummary.checked || 0));
  const budget = (toolContext.get_budget_summary as any) || {};
  const packing = (toolContext.get_packing_summary as any) || {};
  const unplannedPlaces = places.filter((place) => !place.has_assignment).length;
  const uncheckedPacking = Math.max(0, Number(packing.total || 0) - Number(packing.checked || 0));
  const budgetAmount = formatAmount(Number(budget.total_amount || 0), budget.currency || null);

  const lines = ['Still needing planning:'];
  if (unplannedPlaces > 0) lines.push(`- ${unplannedPlaces} places/activities still have no day assignment`);
  if (reservations === 0) lines.push('- no reservations have been added yet');
  else lines.push(`- ${reservations} reservations are already recorded`);
  if (unscheduledReservations > 0) lines.push(`- ${unscheduledReservations} reservations are linked to places but not scheduled to a day yet`);
  if (Number(todoSummary.total || 0) === 0) lines.push('- no to-dos have been added yet');
  else if (openTodos === 0) lines.push('- all to-dos are completed');
  else lines.push(`- ${openTodos} to-do items are still open`);
  lines.push(`- budget total is ${budgetAmount}`);
  if (uncheckedPacking > 0) lines.push(`- ${uncheckedPacking} packing items are still unchecked`);
  else if (Number(packing.total || 0) > 0) lines.push('- packing is fully checked off');

  return makeDeterministicResponse(lines.join('\n'), {
    citations: [],
    suggested_actions: buildSuggestedActions('plan', toolContext),
    follow_up_prompts: [
      'Which places are still unplanned?',
      'Who still needs to pack?',
      'Summarize our budget',
    ],
    tools_used: ['get_trip_places', 'get_reservations_summary', 'get_todo_summary', 'get_budget_summary', 'get_packing_summary'],
  });
}

function buildPackingStatusResponse(toolContext: Record<string, unknown>): AssistantResponse {
  const packing = (toolContext.get_packing_summary as any) || {};
  const owners = Object.entries(packing.by_owner || {}) as Array<[string, { total: number; checked: number }]>;
  const remaining = owners.filter(([, stats]) => Number(stats.total || 0) > Number(stats.checked || 0));

  if (Number(packing.total || 0) === 0 || owners.length === 0) {
    return makeDeterministicResponse('No packing items have been added for this trip yet.', {
      suggested_actions: buildSuggestedActions('packing', toolContext),
      follow_up_prompts: ['What still needs planning?', 'Summarize this trip'],
      tools_used: ['get_packing_summary'],
    });
  }

  if (remaining.length === 0) {
    return makeDeterministicResponse('Everyone is fully packed based on the current packing list.', {
      suggested_actions: buildSuggestedActions('packing', toolContext),
      follow_up_prompts: ['What still needs planning?', 'Summarize this trip'],
      tools_used: ['get_packing_summary'],
    });
  }

  const lines = ['Still needing to pack:'];
  for (const [owner, stats] of remaining) {
    lines.push(`- ${owner}: ${stats.total - stats.checked} unchecked of ${stats.total}`);
  }

  return makeDeterministicResponse(lines.join('\n'), {
    suggested_actions: buildSuggestedActions('packing', toolContext),
    follow_up_prompts: ['What still needs planning?', 'Which places are still unplanned?'],
    tools_used: ['get_packing_summary'],
  });
}

function buildBudgetSummaryResponse(toolContext: Record<string, unknown>): AssistantResponse {
  const budget = (toolContext.get_budget_summary as any) || {};
  const lines = ['Budget summary:'];
  lines.push(`- total: ${formatAmount(Number(budget.total_amount || 0), budget.currency || null)}`);
  lines.push(`- items: ${Number(budget.total_items || 0)}`);

  const categories = Object.entries(budget.by_category || {}) as Array<[string, { total: number; amount: number }]>;
  if (categories.length) {
    for (const [category, stats] of categories.slice(0, 6)) {
      lines.push(`- ${category}: ${formatAmount(Number(stats.amount || 0), budget.currency || null)} across ${Number(stats.total || 0)} items`);
    }
  } else {
    lines.push('- no budget items have been added yet');
  }

  const settlement = (budget.settlement || []) as Array<{ from?: string; to?: string; amount?: number }>;
  if (settlement.length) {
    for (const flow of settlement.slice(0, 4)) {
      lines.push(`- ${flow.from || 'Unknown'} owes ${flow.to || 'Unknown'} ${formatAmount(Number(flow.amount || 0), budget.currency || null)}`);
    }
  }

  return makeDeterministicResponse(lines.join('\n'), {
    suggested_actions: buildSuggestedActions('budget', toolContext),
    follow_up_prompts: ['What still needs planning?', 'Which reservations still need confirmation?'],
    tools_used: ['get_budget_summary'],
  });
}

function buildReservationsStatusResponse(toolContext: Record<string, unknown>): AssistantResponse {
  const reservations = (toolContext.get_reservations_summary as any) || {};
  const items = (reservations.items || []) as Array<any>;

  if (!Number(reservations.total || 0)) {
    return makeDeterministicResponse('No reservations are recorded for this trip yet.', {
      suggested_actions: buildSuggestedActions('reservation', toolContext),
      follow_up_prompts: ['What still needs planning?', 'Which places are still unplanned?'],
      tools_used: ['get_reservations_summary'],
    });
  }

  const lines = [`Reservations (${reservations.total}):`];
  for (const reservation of items) {
    const when = reservation.day_number ? ` | Day ${reservation.day_number}` : '';
    const status = reservation.status ? ` | ${reservation.status}` : '';
    const type = reservation.type ? ` | ${reservation.type}` : '';
    const unscheduled = reservation.is_unscheduled ? ' | unscheduled' : '';
    const place = reservation.place_name ? ` | ${reservation.place_name}` : '';
    lines.push(`- ${reservation.title || 'Untitled reservation'}${type}${status}${when}${unscheduled}${place}`);
  }

  return makeDeterministicResponse(lines.join('\n'), {
    suggested_actions: buildSuggestedActions('reservation', toolContext),
    follow_up_prompts: ['What still needs planning?', 'Summarize this trip'],
    tools_used: ['get_reservations_summary'],
  });
}

function buildOpenTodoStatusResponse(toolContext: Record<string, unknown>): AssistantResponse {
  const todo = (toolContext.get_todo_summary as any) || {};
  const items = ((todo.items || []) as Array<any>).filter((item) => !item.checked);

  if (!items.length) {
    return makeDeterministicResponse('No open to-do items are recorded for this trip.', {
      suggested_actions: buildSuggestedActions('todo', toolContext),
      follow_up_prompts: ['What still needs planning?', 'Who still needs to pack?'],
      tools_used: ['get_todo_summary'],
    });
  }

  const lines = [`Open to-dos (${items.length}):`];
  for (const item of items) {
    const category = item.category ? ` | ${item.category}` : '';
    const due = item.due_date ? ` | due ${item.due_date}` : '';
    lines.push(`- ${item.name || 'Untitled task'}${category}${due}`);
  }

  return makeDeterministicResponse(lines.join('\n'), {
    suggested_actions: buildSuggestedActions('todo', toolContext),
    follow_up_prompts: ['What still needs planning?', 'Which places are still unplanned?'],
    tools_used: ['get_todo_summary'],
  });
}

function buildBusiestDayResponse(toolContext: Record<string, unknown>): AssistantResponse {
  const days = ((toolContext.get_trip_days as any[]) || []) as Array<any>;
  if (!days.length) {
    return makeDeterministicResponse('No days are recorded for this trip yet.', {
      follow_up_prompts: ['What still needs planning?', 'Summarize this trip'],
      tools_used: ['get_trip_days'],
    });
  }

  const busiest = [...days].sort((a, b) => (Number(b.assignment_count || 0) - Number(a.assignment_count || 0)) || (Number(a.day_number || 0) - Number(b.day_number || 0)))[0];
  const lines = [
    `Busiest day: Day ${busiest.day_number}${busiest.date ? ` (${busiest.date})` : ''}`,
    `- assignments: ${Number(busiest.assignment_count || 0)}`,
    `- notes: ${Number(busiest.note_count || 0)}`,
  ];
  const placeNames = (busiest.place_names || []).filter(Boolean) as string[];
  if (placeNames.length) {
    lines.push(`- places: ${placeNames.join(', ')}`);
  }

  return makeDeterministicResponse(lines.join('\n'), {
    follow_up_prompts: ['What still needs planning?', 'Which places are still unplanned?'],
    tools_used: ['get_trip_days'],
  });
}

function buildDayPlanResponse(toolContext: Record<string, unknown>): AssistantResponse {
  const dayPlan = (toolContext.get_day_plan as any) || null;
  if (!dayPlan?.id) {
    return makeDeterministicResponse('That day does not have any plan data in TREK yet.', {
      follow_up_prompts: ['What still needs planning?', 'Which day is the busiest?'],
      tools_used: ['get_day_plan'],
    });
  }

  const assignments = (dayPlan.assignments || []) as Array<any>;
  const lines = [`Day ${dayPlan.day_number}${dayPlan.date ? ` (${dayPlan.date})` : ''}:`];
  if (!assignments.length) {
    lines.push('- no places are assigned yet');
  } else {
    for (const assignment of assignments) {
      const section = assignment.day_section ? ` | ${assignment.day_section}` : '';
      const time = assignment.place_time ? ` | ${assignment.place_time}${assignment.end_time ? `-${assignment.end_time}` : ''}` : '';
      lines.push(`- ${assignment.place_name || 'Unknown place'}${section}${time}`);
    }
  }
  if (Number(dayPlan.note_count || 0) > 0) {
    lines.push(`- notes: ${Number(dayPlan.note_count || 0)}`);
  }

  return makeDeterministicResponse(lines.join('\n'), {
    follow_up_prompts: ['Which day is the busiest?', 'What still needs planning?'],
    tools_used: ['get_day_plan'],
  });
}

function formatDistanceMiles(distanceMeters: number | null | undefined): string | null {
  if (distanceMeters == null || !Number.isFinite(distanceMeters)) return null;
  return `${roundTo(distanceMeters * 0.000621371, 1)} mi`;
}

function formatDistanceKm(distanceMeters: number | null | undefined): string | null {
  if (distanceMeters == null || !Number.isFinite(distanceMeters)) return null;
  return `${roundTo(distanceMeters / 1000, 1)} km`;
}

function formatTravelModeLabel(mode: 'walking' | 'driving' | 'transit'): string {
  if (mode === 'walking') return 'walking';
  if (mode === 'driving') return 'driving';
  return 'public transit';
}

async function buildPlaceComparisonResponse(input: AssistantQueryInput, _toolContext: Record<string, unknown>): Promise<AssistantResponse> {
  const conversationState = deriveAssistantConversationState(input);
  const comparisonType = conversationState.activeComparisonType
    || (conversationState.activeComparisonTravelMode ? 'travel_time' : 'distance');
  const result = await comparePlacesForAssistant({
    origin_place_id: conversationState.activeComparisonOriginPlaceId,
    destination_place_id: conversationState.activeComparisonDestinationPlaceId,
    origin_text: conversationState.activeComparisonOriginPlaceName,
    destination_text: conversationState.activeComparisonDestinationPlaceName,
    mode: conversationState.activeComparisonTravelMode,
    comparison_type: comparisonType,
  }, {
    tripId: input.tripId,
    userId: input.userId,
    selectedPlaceId: input.context?.selected_place_id ?? null,
    history: input.history,
  });

  if (!result.ok || !result.origin || !result.destination || result.distanceMeters == null) {
    return makeDeterministicResponse(result.error || 'I could not determine which two places to compare. Name both places directly or ask a comparison after a prior comparison is established.', {
      follow_up_prompts: ['How close is Club Quarters to Four Kings?', 'How far is Antithesis SF office from Four Kings?'],
      warnings: result.warnings,
      citations: result.citations,
      tools_used: result.toolsUsed.length ? result.toolsUsed : ['get_trip_places'],
    });
  }
  const distanceMeters = result.distanceMeters;
  const distanceKmText = formatDistanceKm(distanceMeters);
  const distanceMilesText = formatDistanceMiles(distanceMeters);
  const mode = result.mode;
  const lines = [`Comparison: ${result.origin.label} to ${result.destination.label}`];
  if (distanceKmText || distanceMilesText) {
    const combinedDistance = [distanceKmText, distanceMilesText].filter(Boolean).join(' / ');
    lines.push(`- distance: ${combinedDistance}`);
  }

  if (comparisonType === 'travel_time' || mode || result.routeMode) {
    const activeMode = (result.routeMode || mode || 'walking') as ComparisonTravelMode;
    const minutes = result.estimatedMinutes;
    if (minutes != null) {
      lines.push(`- estimated ${formatTravelModeLabel(activeMode)} time: ${minutes} minutes`);
    }
    if (mode == null && comparisonType === 'distance' && result.routeMode) {
      lines.push(`- route mode used: ${formatTravelModeLabel(result.routeMode)}`);
    }
  } else if (result.routeMode) {
    lines.push(`- route mode used: ${formatTravelModeLabel(result.routeMode)}`);
  } else {
    lines.push('- live route timing is not available right now.');
  }
  lines.push('- note: distance and time come from a live Google Maps route, not a coordinate estimate.');

  return makeDeterministicResponse(lines.join('\n'), {
    citations: result.citations,
    follow_up_prompts: ['How about driving?', 'And public transit?', 'How about to the Antithesis SF office?'],
    warnings: result.warnings,
    tools_used: result.toolsUsed.length ? result.toolsUsed : ['get_trip_places'],
  });
}

async function buildNearbyPlacesResponse(input: AssistantQueryInput, resolvedIntent: ResolvedIntent, resolvedDayId: number | null): Promise<AssistantResponse> {
  const search = resolvedIntent.nearbySource === 'saved_trip'
    ? await findSavedNearbyTripPlaces({
      tripId: input.tripId,
      userId: input.userId,
      query: resolvedIntent.nearbyQuery || 'places',
      anchorText: resolvedIntent.nearbyAnchor || null,
      selectedDayId: resolvedDayId,
      selectedPlaceId: input.context?.selected_place_id ?? null,
      limit: resolvedIntent.nearbyMode === 'show_more' ? 20 : 10,
    })
    : await findNearbyPlaces({
      tripId: input.tripId,
      userId: input.userId,
      query: resolvedIntent.nearbyQuery || 'places',
      anchorText: resolvedIntent.nearbyAnchor || null,
      selectedDayId: resolvedDayId,
      selectedPlaceId: input.context?.selected_place_id ?? null,
      limit: resolvedIntent.nearbyMode === 'show_more' ? 10 : 5,
    });

  if (!search.available) {
    if (search.reason === 'maps_key_missing') {
      return makeDeterministicResponse('Live nearby place search is not available because no Google Maps API key is configured for this account or server.', {
        warnings: ['Google Places lookup is unavailable.'],
        missing_data: ['No Google Maps API key is configured.'],
        follow_up_prompts: ['What is planned for this day?', 'Which places are still unplanned?'],
        tools_used: ['find_nearby_places'],
      });
    }

    if (search.reason === 'anchor_not_found') {
      return makeDeterministicResponse('I could not determine which place or day to search around. Try naming a saved place, asking about a specific day, or selecting a place first.', {
        warnings: ['Nearby search needs a clear anchor place or day.'],
        follow_up_prompts: ['What restaurants are near day 3?', 'What cafes are near this place?'],
        tools_used: ['find_nearby_places'],
      });
    }

    return makeDeterministicResponse('I could not run the live nearby search right now.', {
      warnings: ['Live place search failed.'],
      follow_up_prompts: ['What restaurants are near day 3?', 'What cafes are near this place?'],
      tools_used: ['find_nearby_places'],
    });
  }

  const anchorName = String((search.anchor as any)?.name || 'the selected area');
  const anchorAddress = (search.anchor as any)?.address ? `\nAnchor: ${(search.anchor as any).address}` : '';
  const results = (search.results || []) as Array<any>;

  if (!results.length) {
    return makeDeterministicResponse(`I didn't find any ${resolvedIntent.nearbySource === 'saved_trip' ? 'saved trip places' : 'live results'} for "${search.query}" near ${anchorName}.${anchorAddress}`, {
      warnings: resolvedIntent.nearbySource === 'saved_trip' ? [] : ['These results come from a live external maps lookup, not saved trip data.'],
      follow_up_prompts: ['Show me restaurants near this place', 'What is planned for this day?'],
      tools_used: ['find_nearby_places'],
    });
  }

  if (resolvedIntent.nearbyMode === 'closest') {
    const closest = results[0];
    const distance = formatDistanceMiles(closest.distance_meters);
    const rating = closest.rating != null ? ` | rating ${roundTo(Number(closest.rating), 1)}` : '';
    const address = closest.address ? ` | ${closest.address}` : '';
    const distanceText = distance ? ` | ${distance}` : '';
    return makeDeterministicResponse(
      `Closest ${resolvedIntent.nearbySource === 'saved_trip' ? 'saved trip place' : 'live result'} near ${anchorName} for "${search.query}":\n- ${closest.name || 'Unknown place'}${distanceText}${rating}${address}\n\n${resolvedIntent.nearbySource === 'saved_trip' ? 'This result is already saved in this trip.' : 'This is a live external search result, not a place already saved in this trip.'}`,
      {
        citations: [{
          type: resolvedIntent.nearbySource === 'saved_trip' ? 'place' : 'live_place',
          id: resolvedIntent.nearbySource === 'saved_trip' ? closest.id || null : closest.google_place_id || null,
          label: closest.name || 'Unknown place',
          meta: {
            address: closest.address || null,
            lat: closest.lat ?? null,
            lng: closest.lng ?? null,
            rating: closest.rating ?? null,
            distance_meters: closest.distance_meters ?? null,
          },
        }],
        warnings: resolvedIntent.nearbySource === 'saved_trip' ? [] : ['This result comes from a live external maps lookup, not saved trip data.'],
        follow_up_prompts: ['Show more', 'Show me grocery stores near this place', 'What attractions are near this place?'],
        tools_used: ['find_nearby_places'],
      },
    );
  }

  if (resolvedIntent.nearbyMode === 'closest_list') {
    const topResults = results.slice(0, 3);
    const lines = [
      `Closest ${resolvedIntent.nearbySource === 'saved_trip' ? 'saved trip places' : 'results'} near ${anchorName} for "${search.query}":`,
      ...topResults.map((place, index) => {
        const distance = formatDistanceMiles(place.distance_meters);
        const rating = place.rating != null ? ` | rating ${roundTo(Number(place.rating), 1)}` : '';
        const address = place.address ? ` | ${place.address}` : '';
        const distanceText = distance ? ` | ${distance}` : '';
        return `${index + 1}. ${place.name || 'Unknown place'}${distanceText}${rating}${address}`;
      }),
      '',
      resolvedIntent.nearbySource === 'saved_trip'
        ? 'These are already saved in this trip.'
        : 'These are live external search results, not places already saved in this trip.',
    ];

    return makeDeterministicResponse(lines.join('\n'), {
      citations: topResults.map((place) => ({
        type: resolvedIntent.nearbySource === 'saved_trip' ? 'place' : 'live_place',
        id: resolvedIntent.nearbySource === 'saved_trip' ? place.id || null : place.google_place_id || null,
        label: place.name || 'Unknown place',
        meta: {
          address: place.address || null,
          lat: place.lat ?? null,
          lng: place.lng ?? null,
          rating: place.rating ?? null,
          distance_meters: place.distance_meters ?? null,
        },
      })),
      warnings: resolvedIntent.nearbySource === 'saved_trip' ? [] : ['These results come from a live external maps lookup, not saved trip data.'],
      follow_up_prompts: ['Show more', 'Which one is closest?', 'Show me grocery stores near this place'],
      tools_used: ['find_nearby_places'],
    });
  }

  const lines = [
    `${resolvedIntent.nearbySource === 'saved_trip' ? 'Saved trip places' : 'Live places'} near ${anchorName} for "${search.query}":`,
    ...results.map((place, index) => {
      const distance = formatDistanceMiles(place.distance_meters);
      const rating = place.rating != null ? ` | rating ${roundTo(Number(place.rating), 1)}` : '';
      const category = place.category_name ? ` | ${place.category_name}` : '';
      const address = place.address ? ` | ${place.address}` : '';
      const distanceText = distance ? ` | ${distance}` : '';
      return `${index + 1}. ${place.name || 'Unknown place'}${distanceText}${category}${rating}${address}`;
    }),
    '',
    resolvedIntent.nearbySource === 'saved_trip'
      ? 'These are places already saved in this trip.'
      : 'These are live external search results, not places already saved in this trip.',
  ];

  return makeDeterministicResponse(lines.join('\n'), {
    citations: results.map((place) => ({
      type: resolvedIntent.nearbySource === 'saved_trip' ? 'place' : 'live_place',
      id: resolvedIntent.nearbySource === 'saved_trip' ? place.id || null : place.google_place_id || null,
      label: place.name || 'Unknown place',
      meta: {
        address: place.address || null,
        lat: place.lat ?? null,
        lng: place.lng ?? null,
        category_name: place.category_name ?? null,
        rating: place.rating ?? null,
        distance_meters: place.distance_meters ?? null,
      },
    })),
    warnings: resolvedIntent.nearbySource === 'saved_trip' ? [] : ['These results come from a live external maps lookup, not saved trip data.'],
    follow_up_prompts: [
      ...(resolvedIntent.nearbyMode === 'show_more' ? [] : ['Show more']),
      'Which one is closest?',
      'Show me grocery stores near this place',
      'What attractions are near this place?',
    ],
    tools_used: ['find_nearby_places'],
  });
}

async function buildDayWeatherResponse(tripId: number, dayId: number | null, userId: number): Promise<AssistantResponse> {
  if (!dayId) {
    return makeDeterministicResponse('Pick a day or ask for a specific day number to get weather for that day.', {
      follow_up_prompts: ['What is the weather on day 1?', 'Which day is the busiest?'],
      tools_used: ['get_day_weather_context'],
    });
  }

  const dayWeatherContext = getDayWeatherContext(tripId, dayId);
  if (!dayWeatherContext) {
    return makeDeterministicResponse('That day does not exist in this trip.', {
      follow_up_prompts: ['What still needs planning?', 'Summarize this trip'],
      tools_used: ['get_day_weather_context'],
    });
  }

  if (!dayWeatherContext.date) {
    return makeDeterministicResponse(`I don't have a date set for Day ${dayWeatherContext.day_number}, so I can't look up weather yet.`, {
      missing_data: [`Day ${dayWeatherContext.day_number} has no date.`],
      follow_up_prompts: ['What is planned for this day?', 'What still needs planning?'],
      tools_used: ['get_day_weather_context'],
    });
  }

  if (dayWeatherContext.lat == null || dayWeatherContext.lng == null) {
    return makeDeterministicResponse(`I don't have coordinates for Day ${dayWeatherContext.day_number}, so I can't look up weather yet.`, {
      missing_data: [`No mapped place with coordinates was found for Day ${dayWeatherContext.day_number}.`],
      follow_up_prompts: ['What is planned for this day?', 'Which places are still unplanned?'],
      tools_used: ['get_day_weather_context'],
    });
  }

  try {
    const userSettings = getUserSettings(userId);
    const temperatureUnit = userSettings.temperature_unit === 'celsius' ? 'celsius' : 'fahrenheit';
    const weather = await getDetailedWeather(String(dayWeatherContext.lat), String(dayWeatherContext.lng), dayWeatherContext.date, 'en');
    if (weather.error) {
      return makeDeterministicResponse(`I don't have weather information available for Day ${dayWeatherContext.day_number} right now.`, {
        warnings: ['Weather data is unavailable for that day.'],
        tools_used: ['get_day_weather_context'],
      });
    }

    const lines = [`Weather for Day ${dayWeatherContext.day_number}${dayWeatherContext.date ? ` (${dayWeatherContext.date})` : ''}:`];
    if (dayWeatherContext.place_name) {
      lines.push(`- location: ${dayWeatherContext.place_name}`);
    } else if (dayWeatherContext.coordinate_source === 'trip_fallback') {
      lines.push('- location: trip-level fallback coordinates (no place is assigned to this day yet)');
    }
    lines.push(`- conditions: ${weather.description || weather.main || 'Unavailable'}`);
    lines.push(`- temperature: ${formatTemperature(weather.temp, temperatureUnit)}${weather.temp_min != null && weather.temp_max != null ? ` (${formatTemperature(weather.temp_min, temperatureUnit)} to ${formatTemperature(weather.temp_max, temperatureUnit)})` : ''}`);
    if (weather.precipitation_probability_max != null) {
      lines.push(`- precipitation chance: ${weather.precipitation_probability_max}%`);
    }
    if (weather.precipitation_sum != null) {
      lines.push(`- precipitation: ${formatPrecipitationMm(weather.precipitation_sum, temperatureUnit)}`);
    }
    if (weather.wind_max != null) {
      lines.push(`- wind: ${formatWindKmh(weather.wind_max, temperatureUnit)}`);
    }

    return makeDeterministicResponse(lines.join('\n'), {
      follow_up_prompts: ['What is planned for this day?', 'Which day is the busiest?'],
      tools_used: ['get_day_weather_context'],
    });
  } catch {
    return makeDeterministicResponse(`I couldn't fetch weather for Day ${dayWeatherContext.day_number} right now.`, {
      warnings: ['Weather lookup failed.'],
      tools_used: ['get_day_weather_context'],
    });
  }
}

export async function runAssistantQuery(input: AssistantQueryInput): Promise<AssistantResponse> {
  const resolvedIntent = resolveAssistantIntent(input);
  const conversationState = deriveAssistantConversationState(input);
  const tools = new Set<ToolName>(selectTools(input.message, input.context?.selected_day_id));
  if (resolvedIntent.kind === 'place_live_detail') {
    tools.add('get_trip_places');
  }
  if (resolvedIntent.kind === 'place_comparison') {
    tools.add('get_trip_places');
  }
  if (resolvedIntent.kind === 'stay_detail') {
    tools.add('get_trip_places');
    tools.add('get_reservations_summary');
  }
  if (resolvedIntent.kind === 'subject_location') {
    tools.add('get_trip_places');
    if (conversationState.activeDayId != null) {
      tools.add('get_trip_days');
      tools.add('get_day_plan');
    }
  }
  if (resolvedIntent.kind === 'subject_time' || resolvedIntent.kind === 'subject_confirmation') {
    tools.add('get_trip_places');
    tools.add('get_reservations_summary');
    if (conversationState.activeDayId != null) {
      tools.add('get_trip_days');
      tools.add('get_day_plan');
    }
  }
  if (resolvedIntent.kind === 'place_knowledge') {
    tools.add('get_trip_places');
  }
  if (resolvedIntent.kind === 'unplanned_places_full') {
    tools.add('get_trip_places');
  }
  if (resolvedIntent.kind === 'trip_places_full') {
    tools.add('get_trip_places');
  }
  if (resolvedIntent.kind === 'trip_places_filtered') {
    tools.add('get_trip_places');
  }
  if (resolvedIntent.kind === 'result_set_unplanned') {
    tools.add('get_trip_places');
  }
  if (resolvedIntent.kind === 'result_set_others') {
    tools.add('get_trip_places');
  }
  if (resolvedIntent.kind === 'planning_status') {
    tools.add('get_trip_places');
    tools.add('get_reservations_summary');
    tools.add('get_todo_summary');
    tools.add('get_budget_summary');
    tools.add('get_packing_summary');
  }
  if (resolvedIntent.kind === 'packing_status') {
    tools.add('get_packing_summary');
  }
  if (resolvedIntent.kind === 'budget_summary') {
    tools.add('get_budget_summary');
  }
  if (resolvedIntent.kind === 'reservations_status') {
    tools.add('get_reservations_summary');
  }
  if (resolvedIntent.kind === 'open_todo_status') {
    tools.add('get_todo_summary');
  }
  if (resolvedIntent.kind === 'busiest_day') {
    tools.add('get_trip_days');
  }
  if (resolvedIntent.kind === 'day_weather') {
    tools.add('get_trip_days');
  }
  if (resolvedIntent.kind === 'day_plan') {
    tools.add('get_trip_days');
  }
  if (resolvedIntent.kind === 'live_search_meta') {
    tools.add('get_trip_places');
  }

  const explicitDayNumber = resolvedIntent.dayNumber;
  let selectedDayId = input.context?.selected_day_id ?? null;
  if (explicitDayNumber) {
    const tripDays = getTripDays(input.tripId) as Array<{ id: number; day_number: number }>;
    const matchedDay = tripDays.find((day) => Number(day.day_number) === Number(explicitDayNumber));
    if (matchedDay?.id) {
      selectedDayId = matchedDay.id;
      if (resolvedIntent.kind === 'day_plan') tools.add('get_day_plan');
      if (resolvedIntent.kind === 'day_weather') tools.add('get_day_weather_context');
      if (resolvedIntent.kind === 'nearby_places') tools.add('get_trip_days');
    } else {
      selectedDayId = null;
    }
  } else if (selectedDayId) {
    if (resolvedIntent.kind === 'day_plan') {
      tools.add('get_day_plan');
    }
    if (resolvedIntent.kind === 'day_weather') {
      tools.add('get_day_weather_context');
    }
  } else if (conversationState.activeDayId != null) {
    selectedDayId = conversationState.activeDayId;
    if (resolvedIntent.kind === 'day_plan' || resolvedIntent.kind === 'subject_location' || resolvedIntent.kind === 'subject_time' || resolvedIntent.kind === 'subject_confirmation') {
      tools.add('get_day_plan');
    }
  }
  const toolContext = addSelectedDayContext(buildContext(input.tripId, Array.from(tools)), input.tripId, selectedDayId);
  if (resolvedIntent.kind === 'unplanned_places_full') {
    return buildUnplannedPlacesListResponse(toolContext);
  }
  if (resolvedIntent.kind === 'trip_places_full') {
    return buildTripPlacesListResponse(toolContext);
  }
  if (resolvedIntent.kind === 'trip_places_filtered') {
    return buildFilteredTripPlacesResponse(toolContext, resolvedIntent.placeCategoryScope);
  }
  if (resolvedIntent.kind === 'result_set_unplanned') {
    return buildResultSetUnplannedResponse(input, toolContext);
  }
  if (resolvedIntent.kind === 'result_set_others') {
    return buildResultSetOthersResponse(input, toolContext);
  }
  if (resolvedIntent.kind === 'planning_status') {
    return buildPlanningStatusResponse(toolContext);
  }
  if (resolvedIntent.kind === 'packing_status') {
    return buildPackingStatusResponse(toolContext);
  }
  if (resolvedIntent.kind === 'budget_summary') {
    return buildBudgetSummaryResponse(toolContext);
  }
  if (resolvedIntent.kind === 'reservations_status') {
    return buildReservationsStatusResponse(toolContext);
  }
  if (resolvedIntent.kind === 'open_todo_status') {
    return buildOpenTodoStatusResponse(toolContext);
  }
  if (resolvedIntent.kind === 'busiest_day') {
    return buildBusiestDayResponse(toolContext);
  }
  if (resolvedIntent.kind === 'day_weather') {
    return await buildDayWeatherResponse(input.tripId, selectedDayId, input.userId);
  }
  if (resolvedIntent.kind === 'day_plan') {
    return buildDayPlanResponse(toolContext);
  }
  if (resolvedIntent.kind === 'live_search_meta') {
    return buildLiveSearchMetaResponse(input);
  }
  if (resolvedIntent.kind === 'nearby_places') {
    return await buildNearbyPlacesResponse(input, resolvedIntent, selectedDayId);
  }
  if (resolvedIntent.kind === 'place_comparison') {
    return await buildPlaceComparisonResponse(input, toolContext);
  }
  if (resolvedIntent.kind === 'place_live_detail') {
    return await buildSavedPlaceLiveDetailResponse(input, resolvedIntent);
  }
  if (resolvedIntent.kind === 'stay_detail') {
    return buildStayDetailResponse(input, toolContext);
  }
  if (resolvedIntent.kind === 'subject_location') {
    return buildSubjectLocationResponse(input, toolContext);
  }
  if (resolvedIntent.kind === 'subject_time') {
    return buildSubjectTimeResponse(input, toolContext);
  }
  if (resolvedIntent.kind === 'subject_confirmation') {
    return buildSubjectConfirmationResponse(input, toolContext);
  }
  const guardedResponse = buildPlaceKnowledgeGuardrail(input, toolContext);
  if (guardedResponse) return guardedResponse;
  const result = await completeAssistantWithToolLoop(input, toolContext);

  const warnings: string[] = [...result.warnings];
  const missingData: string[] = [];
  const overview = toolContext.get_trip_overview as any;
  if (!overview?.trip?.start_date || !overview?.trip?.end_date) {
    missingData.push('Trip dates are incomplete.');
  }
  if (tools.has('get_trip_places') && typeof (toolContext.get_trip_places as any)?.total === 'number' && (toolContext.get_trip_places as any).total === 0) {
    warnings.push('No places were found for this trip.');
  }
  if (tools.has('get_reservations_summary') && !(toolContext.get_reservations_summary as any)?.total) {
    warnings.push('No reservations were found for this trip.');
  }

  return {
    message: {
      role: 'assistant',
      content: sanitizeAssistantPlainText(result.content),
    },
    citations: [
      ...buildCitations(toolContext, Array.from(tools)),
      ...result.citations,
    ],
    suggested_actions: buildSuggestedActions(input.message, toolContext),
    warnings,
    missing_data: missingData,
    follow_up_prompts: buildFollowUpPrompts(toolContext, input.context?.selected_day_id),
    meta: {
      provider: result.provider,
      model: result.model,
      tools_used: Array.from(new Set([
        ...Array.from(tools),
        ...result.toolsUsed,
        ...(toolContext.get_trip_places ? ['get_trip_places'] : []),
        ...(toolContext.get_day_plan ? ['get_day_plan'] : []),
      ])),
    },
  };
}
