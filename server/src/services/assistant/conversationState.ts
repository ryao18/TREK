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

export interface AssistantConversationState {
  activePlaceId: number | null;
  activePlaceName: string | null;
  activePlaceCategory: string | null;
  activePlaceCategoryScope: PlaceCategoryScope | null;
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
    if (!entry || typeof entry.content !== 'string') continue;
    const scope = extractPlaceCategoryScope(entry.content);
    if (scope) return scope;
  }
  return null;
}

export function deriveAssistantConversationState(
  input: AssistantQueryInput,
): AssistantConversationState {
  const resolvedPlace = resolveSavedTripPlace({
    tripId: input.tripId,
    message: input.message,
    selectedPlaceId: input.context?.selected_place_id ?? null,
    history: input.history,
  }) as any;

  const categoryFromResolvedPlace = mapPlaceCategoryToScope(resolvedPlace?.category?.name || resolvedPlace?.category_name || null);
  const categoryFromMessage = extractPlaceCategoryScope(input.message);
  const categoryFromHistory = inferCategoryScopeFromHistory(input.history);

  return {
    activePlaceId: resolvedPlace?.id != null ? Number(resolvedPlace.id) : null,
    activePlaceName: resolvedPlace?.name ? String(resolvedPlace.name) : null,
    activePlaceCategory: resolvedPlace?.category?.name || resolvedPlace?.category_name || null,
    activePlaceCategoryScope: categoryFromResolvedPlace || categoryFromMessage || categoryFromHistory,
  };
}
