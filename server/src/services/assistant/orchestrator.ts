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
} from './tools';
import { completeWithLocalModel } from './provider';

type ToolName =
  | 'get_trip_overview'
  | 'get_trip_days'
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
    if (tool === 'get_reservations_summary') context.get_reservations_summary = getReservationsSummary(tripId);
    if (tool === 'get_budget_summary') context.get_budget_summary = getBudgetSummary(tripId);
    if (tool === 'get_packing_summary') context.get_packing_summary = getPackingSummary(tripId);
    if (tool === 'get_todo_summary') context.get_todo_summary = getTodoSummary(tripId);
    if (tool === 'get_trip_members') context.get_trip_members = getTripMembersSummary(tripId);
  }
  return context;
}

function trimContextForPrompt(context: Record<string, unknown>) {
  const next = { ...context } as any;
  if (Array.isArray(next.get_trip_days)) {
    next.get_trip_days = next.get_trip_days.slice(0, 14);
  }
  if (next.get_reservations_summary?.items) {
    next.get_reservations_summary = {
      ...next.get_reservations_summary,
      items: next.get_reservations_summary.items.slice(0, 8),
    };
  }
  if (next.get_packing_summary?.sample_items) {
    next.get_packing_summary = {
      ...next.get_packing_summary,
      sample_items: next.get_packing_summary.sample_items.slice(0, 6),
    };
  }
  if (next.get_todo_summary?.items) {
    next.get_todo_summary = {
      ...next.get_todo_summary,
      items: next.get_todo_summary.items.slice(0, 8),
    };
  }
  if (next.get_budget_summary?.items) {
    next.get_budget_summary = {
      ...next.get_budget_summary,
      items: next.get_budget_summary.items.slice(0, 6),
      per_person: (next.get_budget_summary.per_person || []).slice(0, 6),
      settlement: (next.get_budget_summary.settlement || []).slice(0, 6),
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
  const serializedTools = JSON.stringify(trimContextForPrompt(toolContext), null, 2);

  const systemPrompt = [
    'You are TREK, a read-only trip assistant.',
    'Answer only from the provided TREK trip data.',
    'Do not invent reservations, participants, dates, or costs.',
    'State when data is missing or incomplete.',
    'Keep answers concise and practical.',
    'Do not suggest that you made any direct changes.',
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
  if (typeof (toolContext.get_budget_summary as any)?.total_amount === 'number') {
    prompts.push('Summarize our budget');
  }
  prompts.push('What still needs planning?');
  return Array.from(new Set(prompts)).slice(0, 4);
}

export async function runAssistantQuery(input: AssistantQueryInput): Promise<AssistantResponse> {
  const tools = selectTools(input.message, input.context?.selected_day_id);
  const toolContext = addSelectedDayContext(buildContext(input.tripId, tools), input.tripId, input.context?.selected_day_id);
  const prompt = buildPrompt(input, toolContext);
  const result = await completeWithLocalModel(prompt);

  const warnings: string[] = [];
  const missingData: string[] = [];
  const overview = toolContext.get_trip_overview as any;
  if (!overview?.trip?.start_date || !overview?.trip?.end_date) {
    missingData.push('Trip dates are incomplete.');
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
        ...(toolContext.get_day_plan ? ['get_day_plan'] : []),
      ])),
    },
  };
}
