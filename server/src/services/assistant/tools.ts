import { getTripSummary, listMembers } from '../tripService';
import { getAssignmentsForDay, listDays } from '../dayService';
import { listReservations } from '../reservationService';
import { listItems as listPackingItems } from '../packingService';
import { listItems as listTodoItems } from '../todoService';
import { calculateSettlement, getPerPersonSummary, listBudgetItems } from '../budgetService';
import { listPlaces } from '../placeService';
import { db } from '../../db/database';

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

  return {
    total: reservations.length,
    by_status: byStatus,
    by_type: byType,
    items: reservations.map((reservation) => ({
      id: reservation.id,
      title: reservation.title,
      status: reservation.status,
      type: reservation.type,
      day_number: reservation.day_number ?? null,
      reservation_time: reservation.reservation_time ?? null,
      reservation_end_time: reservation.reservation_end_time ?? null,
      place_name: reservation.place_name || reservation.accommodation_name || null,
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
