import { listPlaces } from '../placeService';
import { getPlaceDetails, searchPlaces } from '../mapsService';
import { resolveSavedTripPlace } from './tools';
import type { AssistantHistoryMessage, AssistantCitation } from './types';
import type { AssistantCompletionMessage, AssistantToolCall, AssistantToolDefinition } from './provider';
import type { ComparisonTravelMode, ComparisonType } from './conversationState';

interface ToolRuntimeContext {
  tripId: number;
  userId: number;
  selectedPlaceId?: number | null;
  history?: AssistantHistoryMessage[];
}

interface ToolExecutionResult {
  message: AssistantCompletionMessage;
  warnings: string[];
  citations: AssistantCitation[];
  toolsUsed: string[];
}

interface ComparisonEndpointInput {
  placeId?: number | null;
  placeRef?: string | null;
  text?: string | null;
}

interface ResolvedComparisonEndpoint {
  source: 'saved_trip' | 'live_external';
  label: string;
  placeId: number | null;
  placeRef: string | null;
  address: string | null;
  lat: number;
  lng: number;
  externalSource: string | null;
}

export interface AssistantComparePlacesResult {
  ok: boolean;
  error?: string;
  origin?: ResolvedComparisonEndpoint;
  destination?: ResolvedComparisonEndpoint;
  mode: ComparisonTravelMode | null;
  comparisonType: ComparisonType | null;
  distanceMeters?: number;
  distanceKm?: number;
  distanceMiles?: number;
  estimatedMinutes?: number;
  warnings: string[];
  citations: AssistantCitation[];
  toolsUsed: string[];
}

const MAX_SEARCH_LIMIT = 5;

export function getAssistantExternalToolDefinitions(): AssistantToolDefinition[] {
  return [
    {
      type: 'function',
      function: {
        name: 'search_external_place',
        description: 'Search for a live external place by name or query. Use this when a user asks you to look up a place on Google Maps or needs a place that is not already saved in the trip.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string', description: 'The place name or search query to look up.' },
            near_text: { type: 'string', description: 'Optional nearby anchor text to include in the search query, such as a city name.' },
            limit: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_LIMIT, description: 'Maximum number of candidate places to return.' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_external_place_details',
        description: 'Fetch live external place details for a previously found place reference. Use this after search_external_place when the user needs hours, website, phone, ratings, cuisine/type, or address details.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            place_ref: { type: 'string', description: 'A place reference returned by search_external_place. This can be a Google place id or an OSM place reference.' },
          },
          required: ['place_ref'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'compare_places',
        description: 'Compare two places by distance or rough travel time. Each endpoint can be a saved trip place or a live external place name. Use this for questions like how close, how far, or how long it takes between places.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            origin: { type: 'string', description: 'The starting place name or query.' },
            destination: { type: 'string', description: 'The destination place name or query.' },
            mode: { type: 'string', enum: ['walking', 'driving', 'transit'], description: 'Optional travel mode when the user asks about walking, driving, or public transit time.' },
            comparison_type: { type: 'string', enum: ['distance', 'travel_time'], description: 'Whether the user is primarily asking for distance or travel time.' },
          },
          required: ['origin', 'destination'],
        },
      },
    },
  ];
}

function parseToolArguments(toolCall: AssistantToolCall): Record<string, unknown> {
  try {
    const parsed = JSON.parse(toolCall.argumentsText || '{}');
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function haversineDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadiusMeters = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
}

function estimateTravelMinutes(distanceKm: number, mode: ComparisonTravelMode): number {
  if (mode === 'walking') return Math.max(3, Math.round((distanceKm / 4.8) * 60));
  if (mode === 'driving') return Math.max(2, Math.round((distanceKm / 22) * 60 + 1));
  return Math.max(8, Math.round((distanceKm / 16) * 60 + 8));
}

function normalizeSearchCandidates(places: Record<string, unknown>[]): Array<Record<string, unknown>> {
  return places.slice(0, MAX_SEARCH_LIMIT).map((place) => ({
    place_ref: place.google_place_id || place.osm_id || null,
    name: place.name || null,
    address: place.address || null,
    lat: place.lat ?? null,
    lng: place.lng ?? null,
    rating: place.rating ?? null,
    website: place.website ?? null,
    phone: place.phone ?? null,
    source: place.source || null,
  }));
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];
}

function makeSavedPlaceCitation(place: any): AssistantCitation {
  return {
    type: 'place',
    id: place.id ?? null,
    label: String(place.name || 'Saved place'),
    meta: {
      address: place.address || null,
      lat: place.lat ?? null,
      lng: place.lng ?? null,
    },
  };
}

function makeLivePlaceCitation(place: ResolvedComparisonEndpoint): AssistantCitation {
  return {
    type: 'live_place',
    id: place.placeRef,
    label: place.label,
    meta: {
      address: place.address || null,
      lat: place.lat,
      lng: place.lng,
      source: place.externalSource || null,
    },
  };
}

async function resolveComparisonEndpoint(
  endpoint: ComparisonEndpointInput,
  context: ToolRuntimeContext,
): Promise<{ endpoint: ResolvedComparisonEndpoint | null; warnings: string[]; citations: AssistantCitation[]; toolsUsed: string[] }> {
  const warnings: string[] = [];
  const citations: AssistantCitation[] = [];
  const toolsUsed: string[] = [];

  const allPlaces = listPlaces(String(context.tripId), {}) as any[];

  if (endpoint.placeId != null) {
    const savedById = allPlaces.find((place) => Number(place.id) === Number(endpoint.placeId)) || null;
    if (savedById) {
      if (savedById.lat != null && savedById.lng != null) {
        citations.push(makeSavedPlaceCitation(savedById));
        toolsUsed.push('get_trip_places');
        return {
          endpoint: {
            source: 'saved_trip',
            label: String(savedById.name || 'Saved place'),
            placeId: Number(savedById.id),
            placeRef: savedById.google_place_id || null,
            address: savedById.address || null,
            lat: Number(savedById.lat),
            lng: Number(savedById.lng),
            externalSource: null,
          },
          warnings,
          citations,
          toolsUsed,
        };
      }
      if (savedById.google_place_id) {
        const details = await getPlaceDetails(context.userId, String(savedById.google_place_id), 'en');
        const place = details.place || {};
        if ((place as any).lat != null && (place as any).lng != null) {
          citations.push(makeSavedPlaceCitation(savedById));
          citations.push({
            type: 'live_place',
            id: String(savedById.google_place_id),
            label: String((place as any).name || savedById.name || 'External place'),
            meta: {
              address: (place as any).address || savedById.address || null,
              lat: (place as any).lat ?? null,
              lng: (place as any).lng ?? null,
              source: (place as any).source || null,
            },
          });
          toolsUsed.push('get_trip_places', 'get_external_place_details');
          return {
            endpoint: {
              source: 'live_external',
              label: String(savedById.name || (place as any).name || 'Place'),
              placeId: Number(savedById.id),
              placeRef: String(savedById.google_place_id),
              address: (place as any).address || savedById.address || null,
              lat: Number((place as any).lat),
              lng: Number((place as any).lng),
              externalSource: (place as any).source || null,
            },
            warnings,
            citations,
            toolsUsed,
          };
        }
      }
    }
  }

  const placeRef = typeof endpoint.placeRef === 'string' && endpoint.placeRef.trim() ? endpoint.placeRef.trim() : null;
  if (placeRef) {
    const details = await getPlaceDetails(context.userId, placeRef, 'en');
    const place = details.place || {};
    if ((place as any).lat != null && (place as any).lng != null) {
      const resolved: ResolvedComparisonEndpoint = {
        source: 'live_external',
        label: String((place as any).name || endpoint.text || 'External place'),
        placeId: null,
        placeRef,
        address: (place as any).address || null,
        lat: Number((place as any).lat),
        lng: Number((place as any).lng),
        externalSource: (place as any).source || null,
      };
      citations.push(makeLivePlaceCitation(resolved));
      toolsUsed.push('get_external_place_details');
      return { endpoint: resolved, warnings, citations, toolsUsed };
    }
  }

  const text = typeof endpoint.text === 'string' ? endpoint.text.trim() : '';
  if (!text) {
    return { endpoint: null, warnings, citations, toolsUsed };
  }

  const savedPlace = resolveSavedTripPlace({
    tripId: context.tripId,
    message: null,
    selectedPlaceId: context.selectedPlaceId ?? null,
    explicitPlaceName: text,
    history: context.history,
  }) as any;
  if (savedPlace) {
    if (savedPlace.lat != null && savedPlace.lng != null) {
      citations.push(makeSavedPlaceCitation(savedPlace));
      toolsUsed.push('get_trip_places');
      return {
        endpoint: {
          source: 'saved_trip',
          label: String(savedPlace.name || text),
          placeId: Number(savedPlace.id),
          placeRef: savedPlace.google_place_id || null,
          address: savedPlace.address || null,
          lat: Number(savedPlace.lat),
          lng: Number(savedPlace.lng),
          externalSource: null,
        },
        warnings,
        citations,
        toolsUsed,
      };
    }
    if (savedPlace.google_place_id) {
      const details = await getPlaceDetails(context.userId, String(savedPlace.google_place_id), 'en');
      const place = details.place || {};
      if ((place as any).lat != null && (place as any).lng != null) {
        citations.push(makeSavedPlaceCitation(savedPlace));
        citations.push({
          type: 'live_place',
          id: String(savedPlace.google_place_id),
          label: String((place as any).name || savedPlace.name || text),
          meta: {
            address: (place as any).address || savedPlace.address || null,
            lat: (place as any).lat ?? null,
            lng: (place as any).lng ?? null,
            source: (place as any).source || null,
          },
        });
        toolsUsed.push('get_trip_places', 'get_external_place_details');
        return {
          endpoint: {
            source: 'live_external',
            label: String(savedPlace.name || (place as any).name || text),
            placeId: Number(savedPlace.id),
            placeRef: String(savedPlace.google_place_id),
            address: (place as any).address || savedPlace.address || null,
            lat: Number((place as any).lat),
            lng: Number((place as any).lng),
            externalSource: (place as any).source || null,
          },
          warnings,
          citations,
          toolsUsed,
        };
      }
    }
  }

  const searched = await searchPlaces(context.userId, text, 'en');
  const candidates = normalizeSearchCandidates((searched.places || []).slice(0, 1));
  const best = candidates[0] || null;
  if (!best || best.lat == null || best.lng == null) {
    warnings.push(`I couldn't resolve "${text}" to a place with coordinates.`);
    toolsUsed.push('search_external_place');
    return { endpoint: null, warnings, citations, toolsUsed };
  }

  const resolved: ResolvedComparisonEndpoint = {
    source: 'live_external',
    label: String(best.name || text),
    placeId: null,
    placeRef: typeof best.place_ref === 'string' ? best.place_ref : null,
    address: typeof best.address === 'string' ? best.address : null,
    lat: Number(best.lat),
    lng: Number(best.lng),
    externalSource: typeof best.source === 'string' ? best.source : null,
  };
  citations.push(makeLivePlaceCitation(resolved));
  if (searched.source === 'openstreetmap') {
    warnings.push(`External place resolution for "${text}" is using OpenStreetMap fallback instead of Google Places.`);
  }
  toolsUsed.push('search_external_place');
  return { endpoint: resolved, warnings, citations, toolsUsed };
}

export async function comparePlacesForAssistant(
  args: {
    origin_place_id?: number | null;
    destination_place_id?: number | null;
    origin_place_ref?: string | null;
    destination_place_ref?: string | null;
    origin_text?: string | null;
    destination_text?: string | null;
    mode?: ComparisonTravelMode | null;
    comparison_type?: ComparisonType | null;
  },
  context: ToolRuntimeContext,
): Promise<AssistantComparePlacesResult> {
  const mode = args.mode || null;
  const comparisonType = args.comparison_type || (mode ? 'travel_time' : 'distance');
  const originResolved = await resolveComparisonEndpoint({
    placeId: args.origin_place_id ?? null,
    placeRef: args.origin_place_ref ?? null,
    text: args.origin_text ?? null,
  }, context);
  const destinationResolved = await resolveComparisonEndpoint({
    placeId: args.destination_place_id ?? null,
    placeRef: args.destination_place_ref ?? null,
    text: args.destination_text ?? null,
  }, context);

  const warnings = [...originResolved.warnings, ...destinationResolved.warnings];
  const citations = [...originResolved.citations, ...destinationResolved.citations];
  const toolsUsed = uniqueStrings([...originResolved.toolsUsed, ...destinationResolved.toolsUsed]);
  const origin = originResolved.endpoint;
  const destination = destinationResolved.endpoint;

  if (!origin || !destination) {
    return {
      ok: false,
      error: !origin && !destination
        ? 'I could not determine which two places to compare.'
        : (!origin
          ? `I could not determine the origin place${args.origin_text ? `: ${args.origin_text}` : ''}.`
          : `I could not determine the destination place${args.destination_text ? `: ${args.destination_text}` : ''}.`),
      mode,
      comparisonType,
      warnings,
      citations,
      toolsUsed,
    };
  }

  const distanceMeters = haversineDistanceMeters(origin.lat, origin.lng, destination.lat, destination.lng);
  const distanceKm = distanceMeters / 1000;
  const distanceMiles = distanceKm * 0.621371;
  const activeMode = mode || (comparisonType === 'travel_time' ? 'walking' : null);
  const estimatedMinutes = activeMode ? estimateTravelMinutes(distanceKm, activeMode) : undefined;

  return {
    ok: true,
    origin,
    destination,
    mode,
    comparisonType,
    distanceMeters,
    distanceKm,
    distanceMiles,
    estimatedMinutes,
    warnings,
    citations,
    toolsUsed,
  };
}

async function executeSearchExternalPlace(
  args: Record<string, unknown>,
  context: ToolRuntimeContext,
): Promise<ToolExecutionResult> {
  const query = String(args.query || '').trim();
  const nearText = String(args.near_text || '').trim();
  const limitValue = Math.min(Math.max(Number(args.limit) || 3, 1), MAX_SEARCH_LIMIT);
  if (!query) {
    return {
      message: {
        role: 'tool',
        content: JSON.stringify({ ok: false, error: 'query_missing' }),
      },
      warnings: ['External place search needs a query.'],
      citations: [],
      toolsUsed: ['search_external_place'],
    };
  }

  const combinedQuery = nearText ? `${query} ${nearText}` : query;
  const searched = await searchPlaces(context.userId, combinedQuery, 'en');
  const candidates = normalizeSearchCandidates((searched.places || []).slice(0, limitValue));

  return {
    message: {
      role: 'tool',
      content: JSON.stringify({
        ok: true,
        query,
        near_text: nearText || null,
        source: searched.source,
        candidates,
      }),
    },
    warnings: searched.source === 'openstreetmap' ? ['External place search is using OpenStreetMap fallback instead of Google Places.'] : [],
    citations: candidates.map((candidate) => ({
      type: 'live_place',
      id: (candidate.place_ref as string | null) || null,
      label: String(candidate.name || 'External place'),
      meta: {
        address: candidate.address || null,
        lat: candidate.lat ?? null,
        lng: candidate.lng ?? null,
        rating: candidate.rating ?? null,
        source: candidate.source || null,
      },
    })),
    toolsUsed: ['search_external_place'],
  };
}

async function executeGetExternalPlaceDetails(
  args: Record<string, unknown>,
  context: ToolRuntimeContext,
): Promise<ToolExecutionResult> {
  const placeRef = String(args.place_ref || '').trim();
  if (!placeRef) {
    return {
      message: {
        role: 'tool',
        content: JSON.stringify({ ok: false, error: 'place_ref_missing' }),
      },
      warnings: ['External place details need a place reference.'],
      citations: [],
      toolsUsed: ['get_external_place_details'],
    };
  }

  const details = await getPlaceDetails(context.userId, placeRef, 'en');
  const place = details.place || {};
  return {
    message: {
      role: 'tool',
      content: JSON.stringify({
        ok: true,
        place: {
          place_ref: String((place as any).google_place_id || placeRef),
          name: (place as any).name || null,
          address: (place as any).address || null,
          lat: (place as any).lat ?? null,
          lng: (place as any).lng ?? null,
          rating: (place as any).rating ?? null,
          rating_count: (place as any).rating_count ?? null,
          website: (place as any).website ?? null,
          phone: (place as any).phone ?? null,
          types: (place as any).types ?? [],
          opening_hours: (place as any).opening_hours ?? null,
          open_now: (place as any).open_now ?? null,
          summary: (place as any).summary ?? null,
          source: (place as any).source || null,
        },
      }),
    },
    warnings: [],
    citations: [{
      type: 'live_place',
      id: String((place as any).google_place_id || placeRef),
      label: String((place as any).name || 'External place'),
      meta: {
        address: (place as any).address || null,
        lat: (place as any).lat ?? null,
        lng: (place as any).lng ?? null,
        rating: (place as any).rating ?? null,
        source: (place as any).source || null,
      },
    }],
    toolsUsed: ['get_external_place_details'],
  };
}

async function executeComparePlaces(
  args: Record<string, unknown>,
  context: ToolRuntimeContext,
): Promise<ToolExecutionResult> {
  const origin = String(args.origin || '').trim();
  const destination = String(args.destination || '').trim();
  const modeRaw = String(args.mode || '').trim().toLowerCase();
  const comparisonTypeRaw = String(args.comparison_type || '').trim().toLowerCase();
  const mode = (modeRaw === 'walking' || modeRaw === 'driving' || modeRaw === 'transit') ? modeRaw as ComparisonTravelMode : null;
  const comparisonType = (comparisonTypeRaw === 'distance' || comparisonTypeRaw === 'travel_time')
    ? comparisonTypeRaw as ComparisonType
    : null;

  if (!origin || !destination) {
    return {
      message: {
        role: 'tool',
        content: JSON.stringify({ ok: false, error: 'origin_or_destination_missing' }),
      },
      warnings: ['Place comparison needs both an origin and a destination.'],
      citations: [],
      toolsUsed: ['compare_places'],
    };
  }

  const result = await comparePlacesForAssistant({
    origin_text: origin,
    destination_text: destination,
    mode,
    comparison_type: comparisonType,
  }, context);

  return {
    message: {
      role: 'tool',
      content: JSON.stringify({
        ok: result.ok,
        error: result.error || null,
        origin: result.origin || null,
        destination: result.destination || null,
        mode: result.mode,
        comparison_type: result.comparisonType,
        distance_meters: result.distanceMeters ?? null,
        distance_km: result.distanceKm ?? null,
        distance_miles: result.distanceMiles ?? null,
        estimated_minutes: result.estimatedMinutes ?? null,
        note: 'Travel times are rough estimates from coordinates, not live routing.',
      }),
    },
    warnings: result.warnings,
    citations: result.citations,
    toolsUsed: uniqueStrings(['compare_places', ...result.toolsUsed]),
  };
}

export async function executeAssistantToolCall(
  toolCall: AssistantToolCall,
  context: ToolRuntimeContext,
): Promise<ToolExecutionResult> {
  const args = parseToolArguments(toolCall);
  if (toolCall.name === 'search_external_place') {
    const result = await executeSearchExternalPlace(args, context);
    return {
      ...result,
      message: {
        ...result.message,
        tool_call_id: toolCall.id,
      },
    };
  }
  if (toolCall.name === 'get_external_place_details') {
    const result = await executeGetExternalPlaceDetails(args, context);
    return {
      ...result,
      message: {
        ...result.message,
        tool_call_id: toolCall.id,
      },
    };
  }
  if (toolCall.name === 'compare_places') {
    const result = await executeComparePlaces(args, context);
    return {
      ...result,
      message: {
        ...result.message,
        tool_call_id: toolCall.id,
      },
    };
  }

  return {
    message: {
      role: 'tool',
      tool_call_id: toolCall.id,
      content: JSON.stringify({ ok: false, error: 'unsupported_tool', tool: toolCall.name }),
    },
    warnings: [`Unsupported assistant tool call: ${toolCall.name}`],
    citations: [],
    toolsUsed: [],
  };
}
