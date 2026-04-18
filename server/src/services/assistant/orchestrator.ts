import { AssistantQueryInput, AssistantResponse } from './types';
import {
  getBudgetSummary,
  getDayPlan,
  getPackingSummary,
  getReservationsSummary,
  getTodoSummary,
  getTripDays,
  getTripMembersSummary,
  getTripOverview,
  getTripPlaces,
} from './tools';
import { completeWithLocalModel } from './provider';

type ToolName =
  | 'get_trip_overview'
  | 'get_trip_days'
  | 'get_trip_places'
  | 'get_day_plan'
  | 'get_reservations_summary'
  | 'get_budget_summary'
  | 'get_packing_summary'
  | 'get_todo_summary'
  | 'get_trip_members';

function selectTools(message: string, selectedDayId?: number | null): ToolName[] {
  const lower = message.toLowerCase();
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
    if (tool === 'get_reservations_summary') context.get_reservations_summary = getReservationsSummary(tripId);
    if (tool === 'get_budget_summary') context.get_budget_summary = getBudgetSummary(tripId);
    if (tool === 'get_packing_summary') context.get_packing_summary = getPackingSummary(tripId);
    if (tool === 'get_todo_summary') context.get_todo_summary = getTodoSummary(tripId);
    if (tool === 'get_trip_members') context.get_trip_members = getTripMembersSummary(tripId);
  }
  return context;
}

function isOperationalPlaceQuestion(message: string): boolean {
  const lower = message.toLowerCase();
  return /\bon our itinerary\b|\bitinerary\b|\bday\b|\bplanned\b|\bunplanned\b|\bplan\b|\breservation\b|\bbooking\b|\bnotes\b|\baddress\b|\bcoordinates\b|\bwhere\b|\bwhen\b|\bdid we\b|\bdo we\b/.test(lower);
}

function isFullListRequest(message: string): boolean {
  const lower = message.toLowerCase();
  return /\bfull list\b|\ball\b|\blist everything\b|\bshow all\b|\bevery\b/.test(lower);
}

function shouldIncludeFullPlaceList(message: string): boolean {
  const lower = message.toLowerCase();
  return isFullListRequest(lower) && /\bplace\b|\bplaces\b|\blocation\b|\blocations\b|\bactivity\b|\bactivities\b/.test(lower);
}

function shouldIncludeFullReservationList(message: string): boolean {
  const lower = message.toLowerCase();
  return isFullListRequest(lower) && /\breservation\b|\breservations\b|\bbooking\b|\bbookings\b|\bhotel\b|\bflight\b|\btrain\b/.test(lower);
}

function shouldIncludeFullPackingList(message: string): boolean {
  const lower = message.toLowerCase();
  return isFullListRequest(lower) && /\bpacking\b|\bpack\b|\bluggage\b|\bbag\b|\bitems\b/.test(lower);
}

function shouldIncludeFullTodoList(message: string): boolean {
  const lower = message.toLowerCase();
  return isFullListRequest(lower) && /\btodo\b|\bto-do\b|\btask\b|\btasks\b|\bchecklist\b/.test(lower);
}

function shouldIncludeFullBudgetList(message: string): boolean {
  const lower = message.toLowerCase();
  return isFullListRequest(lower) && /\bbudget\b|\bexpense\b|\bexpenses\b|\bcost\b|\bcosts\b|\bspend\b|\bspent\b/.test(lower);
}

function isPlanningStatusRequest(message: string): boolean {
  const lower = message.toLowerCase();
  return /\bwhat still needs planning\b|\bwhat needs planning\b|\bwhat remains to plan\b|\bwhat is left to plan\b/.test(lower);
}

function isExplicitUnplannedPlaceListRequest(message: string): boolean {
  const lower = message.toLowerCase();
  return isFullListRequest(lower)
    && /\bplace\b|\bplaces\b|\blocation\b|\blocations\b|\bactivity\b|\bactivities\b/.test(lower)
    && /\bunplanned\b|\bnot planned\b|\bunassigned\b|\bnot assigned\b|\bwithout a day\b|\bno day assigned\b/.test(lower);
}

function isPackingStatusRequest(message: string): boolean {
  const lower = message.toLowerCase();
  return /\bwho still needs to pack\b|\bwho has not packed\b|\bwho hasn't packed\b|\bwho needs to pack\b/.test(lower);
}

function isBudgetSummaryRequest(message: string): boolean {
  const lower = message.toLowerCase();
  return /\bsummarize our budget\b|\bbudget summary\b|\bwhat is our budget\b|\bhow much have we spent\b|\bhow much is assigned\b/.test(lower);
}

function isReservationsStatusRequest(message: string): boolean {
  const lower = message.toLowerCase();
  return /\bwhat reservations do we have\b|\blist reservations\b|\bshow reservations\b|\bwhich reservations are missing\b|\bwhat reservations are missing\b/.test(lower);
}

function isOpenTodoStatusRequest(message: string): boolean {
  const lower = message.toLowerCase();
  return /\bwhat todos are still open\b|\bwhat to-?dos are still open\b|\bwhat tasks are still open\b|\bopen todos\b|\bopen tasks\b/.test(lower);
}

function isBusiestDayRequest(message: string): boolean {
  const lower = message.toLowerCase();
  return /\bwhich day is the busiest\b|\bwhat day is the busiest\b|\bbusiest day\b/.test(lower);
}

function extractRequestedDayNumber(message: string): number | null {
  const match = message.toLowerCase().match(/\bday\s+(\d{1,2})\b/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function isDayPlanRequest(message: string, selectedDayId?: number | null): boolean {
  const lower = message.toLowerCase();
  if (selectedDayId && /\bthis day\b|\btoday\b|\bselected day\b|\bwhat'?s planned\b|\bwhat is planned\b|\bwhat do we have\b/.test(lower)) {
    return true;
  }
  return /\bwhat'?s planned for day\b|\bwhat is planned for day\b|\bwhat'?s on day\b|\bwhat is on day\b/.test(lower);
}

function formatAmount(value: number, currency?: string | null): string {
  const amount = Number.isFinite(value) ? value : 0;
  return currency ? `${amount} ${currency}` : String(amount);
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
      content,
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
  const history = (input.history || []).slice(-6).map(message => `${message.role.toUpperCase()}: ${message.content}`).join('\n');
  const plannerContext = JSON.stringify(input.context || {}, null, 2);
  const serializedTools = JSON.stringify(trimContextForPrompt(toolContext, input), null, 2);

  const systemPrompt = [
    'You are TREK, a read-only trip assistant.',
    'Answer only from the provided TREK trip data.',
    'Do not invent reservations, participants, dates, or costs.',
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

function extractMentionedPlaceName(message: string, toolContext: Record<string, unknown>): string | null {
  const places = ((toolContext.get_trip_places as any)?.items || []) as Array<{ name?: string }>;
  const lower = message.toLowerCase();
  const matched = places.find((place) => place.name && lower.includes(String(place.name).toLowerCase()));
  return matched?.name || null;
}

function isPlaceKnowledgeQuestion(message: string): boolean {
  const lower = message.toLowerCase();
  if (isOperationalPlaceQuestion(lower)) return false;
  return /\btell me about\b|\bdescribe\b|\bwhat kind of place\b|\bwhat kind of attraction\b|\bwhat is this place\b|\bwhat's this place\b/.test(lower)
    || /^(what is|what's)\s+.+\??$/.test(lower);
}

function buildPlaceKnowledgeGuardrail(input: AssistantQueryInput, toolContext: Record<string, unknown>): AssistantResponse | null {
  if (!isPlaceKnowledgeQuestion(input.message)) return null;

  const placeName = extractMentionedPlaceName(input.message, toolContext);
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

function buildPlanningStatusResponse(toolContext: Record<string, unknown>): AssistantResponse {
  const places = (((toolContext.get_trip_places as any)?.items) || []) as Array<{ id?: number; name?: string; has_assignment?: boolean }>;
  const reservations = (toolContext.get_reservations_summary as any)?.total ?? 0;
  const todos = (toolContext.get_todo_summary as any)?.total ?? 0;
  const budget = (toolContext.get_budget_summary as any) || {};
  const packing = (toolContext.get_packing_summary as any) || {};
  const unplannedPlaces = places.filter((place) => !place.has_assignment).length;
  const uncheckedPacking = Math.max(0, Number(packing.total || 0) - Number(packing.checked || 0));
  const budgetAmount = formatAmount(Number(budget.total_amount || 0), budget.currency || null);

  const lines = ['Still needing planning:'];
  if (unplannedPlaces > 0) lines.push(`- ${unplannedPlaces} places/activities still have no day assignment`);
  if (reservations === 0) lines.push('- no reservations have been added yet');
  else lines.push(`- ${reservations} reservations are already recorded`);
  if (todos === 0) lines.push('- no to-dos have been added yet');
  else lines.push(`- ${todos} to-do items are still open`);
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
    lines.push(`- ${reservation.title || 'Untitled reservation'}${type}${status}${when}`);
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

export async function runAssistantQuery(input: AssistantQueryInput): Promise<AssistantResponse> {
  const tools = new Set<ToolName>(selectTools(input.message, input.context?.selected_day_id));
  if (isPlaceKnowledgeQuestion(input.message)) {
    tools.add('get_trip_places');
  }
  if (isExplicitUnplannedPlaceListRequest(input.message)) {
    tools.add('get_trip_places');
  }
  if (isPlanningStatusRequest(input.message)) {
    tools.add('get_trip_places');
    tools.add('get_reservations_summary');
    tools.add('get_todo_summary');
    tools.add('get_budget_summary');
    tools.add('get_packing_summary');
  }
  if (isPackingStatusRequest(input.message)) {
    tools.add('get_packing_summary');
  }
  if (isBudgetSummaryRequest(input.message)) {
    tools.add('get_budget_summary');
  }
  if (isReservationsStatusRequest(input.message)) {
    tools.add('get_reservations_summary');
  }
  if (isOpenTodoStatusRequest(input.message)) {
    tools.add('get_todo_summary');
  }
  if (isBusiestDayRequest(input.message)) {
    tools.add('get_trip_days');
  }
  if (isDayPlanRequest(input.message, input.context?.selected_day_id)) {
    tools.add('get_trip_days');
  }

  const explicitDayNumber = extractRequestedDayNumber(input.message);
  let selectedDayId = input.context?.selected_day_id ?? null;
  if (!selectedDayId && explicitDayNumber) {
    const tripDays = getTripDays(input.tripId) as Array<{ id: number; day_number: number }>;
    const matchedDay = tripDays.find((day) => Number(day.day_number) === Number(explicitDayNumber));
    if (matchedDay?.id) {
      selectedDayId = matchedDay.id;
      tools.add('get_day_plan');
    }
  } else if (selectedDayId && isDayPlanRequest(input.message, input.context?.selected_day_id)) {
    tools.add('get_day_plan');
  }
  const toolContext = addSelectedDayContext(buildContext(input.tripId, Array.from(tools)), input.tripId, selectedDayId);
  if (isExplicitUnplannedPlaceListRequest(input.message)) {
    return buildUnplannedPlacesListResponse(toolContext);
  }
  if (isPlanningStatusRequest(input.message)) {
    return buildPlanningStatusResponse(toolContext);
  }
  if (isPackingStatusRequest(input.message)) {
    return buildPackingStatusResponse(toolContext);
  }
  if (isBudgetSummaryRequest(input.message)) {
    return buildBudgetSummaryResponse(toolContext);
  }
  if (isReservationsStatusRequest(input.message)) {
    return buildReservationsStatusResponse(toolContext);
  }
  if (isOpenTodoStatusRequest(input.message)) {
    return buildOpenTodoStatusResponse(toolContext);
  }
  if (isBusiestDayRequest(input.message)) {
    return buildBusiestDayResponse(toolContext);
  }
  if (isDayPlanRequest(input.message, selectedDayId)) {
    return buildDayPlanResponse(toolContext);
  }
  const guardedResponse = buildPlaceKnowledgeGuardrail(input, toolContext);
  if (guardedResponse) return guardedResponse;
  const prompt = buildPrompt(input, toolContext);
  const result = await completeWithLocalModel(prompt);

  const warnings: string[] = [];
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
      content: result.content,
    },
    citations: buildCitations(toolContext, Array.from(tools)),
    suggested_actions: buildSuggestedActions(input.message, toolContext),
    warnings,
    missing_data: missingData,
    follow_up_prompts: buildFollowUpPrompts(toolContext, input.context?.selected_day_id),
    meta: {
      provider: result.provider,
      model: result.model,
      tools_used: Array.from(new Set([
        ...Array.from(tools),
        ...(toolContext.get_trip_places ? ['get_trip_places'] : []),
        ...(toolContext.get_day_plan ? ['get_day_plan'] : []),
      ])),
    },
  };
}
