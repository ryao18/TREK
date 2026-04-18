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
    'Keep answers concise and practical.',
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
  return /\bwhat is\b|\btell me about\b|\bwhat kind of place\b|\bwhat kind of attraction\b|\bwhat is this place\b/.test(lower);
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

export async function runAssistantQuery(input: AssistantQueryInput): Promise<AssistantResponse> {
  const tools = selectTools(input.message, input.context?.selected_day_id);
  const toolContext = addSelectedDayContext(buildContext(input.tripId, tools), input.tripId, input.context?.selected_day_id);
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
  if (tools.includes('get_trip_places') && typeof (toolContext.get_trip_places as any)?.total === 'number' && (toolContext.get_trip_places as any).total === 0) {
    warnings.push('No places were found for this trip.');
  }
  if (tools.includes('get_reservations_summary') && !(toolContext.get_reservations_summary as any)?.total) {
    warnings.push('No reservations were found for this trip.');
  }

  return {
    message: {
      role: 'assistant',
      content: result.content,
    },
    citations: buildCitations(toolContext, tools),
    suggested_actions: buildSuggestedActions(input.message, toolContext),
    warnings,
    missing_data: missingData,
    follow_up_prompts: buildFollowUpPrompts(toolContext, input.context?.selected_day_id),
    meta: {
      provider: result.provider,
      model: result.model,
      tools_used: Array.from(new Set([
        ...tools,
        ...(toolContext.get_trip_places ? ['get_trip_places'] : []),
        ...(toolContext.get_day_plan ? ['get_day_plan'] : []),
      ])),
    },
  };
}
