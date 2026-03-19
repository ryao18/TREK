const express = require('express');
const { db, canAccessTrip } = require('../db/database');
const { authenticate } = require('../middleware/auth');
const { broadcast } = require('../websocket');

const router = express.Router({ mergeParams: true });

function verifyTripOwnership(tripId, userId) {
  return canAccessTrip(tripId, userId);
}

function getAssignmentsForDay(dayId) {
  const assignments = db.prepare(`
    SELECT da.*, p.id as place_id, p.name as place_name, p.description as place_description,
      p.lat, p.lng, p.address, p.category_id, p.price, p.currency as place_currency,
      p.reservation_status, p.reservation_notes, p.reservation_datetime, p.place_time, p.duration_minutes, p.notes as place_notes,
      p.image_url, p.transport_mode, p.google_place_id, p.website, p.phone,
      c.name as category_name, c.color as category_color, c.icon as category_icon
    FROM day_assignments da
    JOIN places p ON da.place_id = p.id
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE da.day_id = ?
    ORDER BY da.order_index ASC, da.created_at ASC
  `).all(dayId);

  return assignments.map(a => {
    const tags = db.prepare(`
      SELECT t.* FROM tags t
      JOIN place_tags pt ON t.id = pt.tag_id
      WHERE pt.place_id = ?
    `).all(a.place_id);

    return {
      id: a.id,
      day_id: a.day_id,
      order_index: a.order_index,
      notes: a.notes,
      created_at: a.created_at,
      place: {
        id: a.place_id,
        name: a.place_name,
        description: a.place_description,
        lat: a.lat,
        lng: a.lng,
        address: a.address,
        category_id: a.category_id,
        price: a.price,
        currency: a.place_currency,
        reservation_status: a.reservation_status,
        reservation_notes: a.reservation_notes,
        reservation_datetime: a.reservation_datetime,
        place_time: a.place_time,
        duration_minutes: a.duration_minutes,
        notes: a.place_notes,
        image_url: a.image_url,
        transport_mode: a.transport_mode,
        google_place_id: a.google_place_id,
        website: a.website,
        phone: a.phone,
        category: a.category_id ? {
          id: a.category_id,
          name: a.category_name,
          color: a.category_color,
          icon: a.category_icon,
        } : null,
        tags,
      }
    };
  });
}

// GET /api/trips/:tripId/days
router.get('/', authenticate, (req, res) => {
  const { tripId } = req.params;

  const trip = verifyTripOwnership(tripId, req.user.id);
  if (!trip) {
    return res.status(404).json({ error: 'Reise nicht gefunden' });
  }

  const days = db.prepare('SELECT * FROM days WHERE trip_id = ? ORDER BY day_number ASC').all(tripId);

  if (days.length === 0) {
    return res.json({ days: [] });
  }

  const dayIds = days.map(d => d.id);
  const dayPlaceholders = dayIds.map(() => '?').join(',');

  // Load ALL assignments for all days in one query
  const allAssignments = db.prepare(`
    SELECT da.*, p.id as place_id, p.name as place_name, p.description as place_description,
      p.lat, p.lng, p.address, p.category_id, p.price, p.currency as place_currency,
      p.reservation_status, p.reservation_notes, p.reservation_datetime, p.place_time, p.duration_minutes, p.notes as place_notes,
      p.image_url, p.transport_mode, p.google_place_id, p.website, p.phone,
      c.name as category_name, c.color as category_color, c.icon as category_icon
    FROM day_assignments da
    JOIN places p ON da.place_id = p.id
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE da.day_id IN (${dayPlaceholders})
    ORDER BY da.order_index ASC, da.created_at ASC
  `).all(...dayIds);

  // Batch-load ALL tags for all places across all assignments
  const placeIds = [...new Set(allAssignments.map(a => a.place_id))];
  const tagsByPlaceId = {};
  if (placeIds.length > 0) {
    const placePlaceholders = placeIds.map(() => '?').join(',');
    const allTags = db.prepare(`
      SELECT t.*, pt.place_id FROM tags t
      JOIN place_tags pt ON t.id = pt.tag_id
      WHERE pt.place_id IN (${placePlaceholders})
    `).all(...placeIds);
    for (const tag of allTags) {
      if (!tagsByPlaceId[tag.place_id]) tagsByPlaceId[tag.place_id] = [];
      tagsByPlaceId[tag.place_id].push({ id: tag.id, name: tag.name, color: tag.color, created_at: tag.created_at });
    }
  }

  // Group assignments by day_id
  const assignmentsByDayId = {};
  for (const a of allAssignments) {
    if (!assignmentsByDayId[a.day_id]) assignmentsByDayId[a.day_id] = [];
    assignmentsByDayId[a.day_id].push({
      id: a.id,
      day_id: a.day_id,
      order_index: a.order_index,
      notes: a.notes,
      created_at: a.created_at,
      place: {
        id: a.place_id,
        name: a.place_name,
        description: a.place_description,
        lat: a.lat,
        lng: a.lng,
        address: a.address,
        category_id: a.category_id,
        price: a.price,
        currency: a.place_currency,
        reservation_status: a.reservation_status,
        reservation_notes: a.reservation_notes,
        reservation_datetime: a.reservation_datetime,
        place_time: a.place_time,
        duration_minutes: a.duration_minutes,
        notes: a.place_notes,
        image_url: a.image_url,
        transport_mode: a.transport_mode,
        google_place_id: a.google_place_id,
        website: a.website,
        phone: a.phone,
        category: a.category_id ? {
          id: a.category_id,
          name: a.category_name,
          color: a.category_color,
          icon: a.category_icon,
        } : null,
        tags: tagsByPlaceId[a.place_id] || [],
      }
    });
  }

  // Load ALL day_notes for all days in one query
  const allNotes = db.prepare(
    `SELECT * FROM day_notes WHERE day_id IN (${dayPlaceholders}) ORDER BY sort_order ASC, created_at ASC`
  ).all(...dayIds);
  const notesByDayId = {};
  for (const note of allNotes) {
    if (!notesByDayId[note.day_id]) notesByDayId[note.day_id] = [];
    notesByDayId[note.day_id].push(note);
  }

  const daysWithAssignments = days.map(day => ({
    ...day,
    assignments: assignmentsByDayId[day.id] || [],
    notes_items: notesByDayId[day.id] || [],
  }));

  res.json({ days: daysWithAssignments });
});

// POST /api/trips/:tripId/days
router.post('/', authenticate, (req, res) => {
  const { tripId } = req.params;

  const trip = verifyTripOwnership(tripId, req.user.id);
  if (!trip) {
    return res.status(404).json({ error: 'Reise nicht gefunden' });
  }

  const { date, notes } = req.body;

  const maxDay = db.prepare('SELECT MAX(day_number) as max FROM days WHERE trip_id = ?').get(tripId);
  const dayNumber = (maxDay.max || 0) + 1;

  const result = db.prepare(
    'INSERT INTO days (trip_id, day_number, date, notes) VALUES (?, ?, ?, ?)'
  ).run(tripId, dayNumber, date || null, notes || null);

  const day = db.prepare('SELECT * FROM days WHERE id = ?').get(result.lastInsertRowid);

  const dayResult = { ...day, assignments: [] };
  res.status(201).json({ day: dayResult });
  broadcast(tripId, 'day:created', { day: dayResult }, req.headers['x-socket-id']);
});

// PUT /api/trips/:tripId/days/:id
router.put('/:id', authenticate, (req, res) => {
  const { tripId, id } = req.params;

  const trip = verifyTripOwnership(tripId, req.user.id);
  if (!trip) {
    return res.status(404).json({ error: 'Reise nicht gefunden' });
  }

  const day = db.prepare('SELECT * FROM days WHERE id = ? AND trip_id = ?').get(id, tripId);
  if (!day) {
    return res.status(404).json({ error: 'Tag nicht gefunden' });
  }

  const { notes, title } = req.body;
  db.prepare('UPDATE days SET notes = ?, title = ? WHERE id = ?').run(notes || null, title !== undefined ? title : day.title, id);

  const updatedDay = db.prepare('SELECT * FROM days WHERE id = ?').get(id);
  const dayWithAssignments = { ...updatedDay, assignments: getAssignmentsForDay(id) };
  res.json({ day: dayWithAssignments });
  broadcast(tripId, 'day:updated', { day: dayWithAssignments }, req.headers['x-socket-id']);
});

// DELETE /api/trips/:tripId/days/:id
router.delete('/:id', authenticate, (req, res) => {
  const { tripId, id } = req.params;

  const trip = verifyTripOwnership(tripId, req.user.id);
  if (!trip) {
    return res.status(404).json({ error: 'Reise nicht gefunden' });
  }

  const day = db.prepare('SELECT * FROM days WHERE id = ? AND trip_id = ?').get(id, tripId);
  if (!day) {
    return res.status(404).json({ error: 'Tag nicht gefunden' });
  }

  db.prepare('DELETE FROM days WHERE id = ?').run(id);
  res.json({ success: true });
  broadcast(tripId, 'day:deleted', { dayId: Number(id) }, req.headers['x-socket-id']);
});

module.exports = router;
