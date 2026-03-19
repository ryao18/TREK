const express = require('express');
const { db, canAccessTrip } = require('../db/database');
const { authenticate } = require('../middleware/auth');
const { broadcast } = require('../websocket');

const router = express.Router({ mergeParams: true });

function verifyAccess(tripId, userId) {
  return canAccessTrip(tripId, userId);
}

// GET /api/trips/:tripId/days/:dayId/notes
router.get('/', authenticate, (req, res) => {
  const { tripId, dayId } = req.params;
  if (!verifyAccess(tripId, req.user.id)) return res.status(404).json({ error: 'Reise nicht gefunden' });

  const notes = db.prepare(
    'SELECT * FROM day_notes WHERE day_id = ? AND trip_id = ? ORDER BY sort_order ASC, created_at ASC'
  ).all(dayId, tripId);

  res.json({ notes });
});

// POST /api/trips/:tripId/days/:dayId/notes
router.post('/', authenticate, (req, res) => {
  const { tripId, dayId } = req.params;
  if (!verifyAccess(tripId, req.user.id)) return res.status(404).json({ error: 'Reise nicht gefunden' });

  const day = db.prepare('SELECT id FROM days WHERE id = ? AND trip_id = ?').get(dayId, tripId);
  if (!day) return res.status(404).json({ error: 'Tag nicht gefunden' });

  const { text, time, icon, sort_order } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Text erforderlich' });

  const result = db.prepare(
    'INSERT INTO day_notes (day_id, trip_id, text, time, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(dayId, tripId, text.trim(), time || null, icon || '📝', sort_order ?? 9999);

  const note = db.prepare('SELECT * FROM day_notes WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ note });
  broadcast(tripId, 'dayNote:created', { dayId: Number(dayId), note }, req.headers['x-socket-id']);
});

// PUT /api/trips/:tripId/days/:dayId/notes/:id
router.put('/:id', authenticate, (req, res) => {
  const { tripId, dayId, id } = req.params;
  if (!verifyAccess(tripId, req.user.id)) return res.status(404).json({ error: 'Reise nicht gefunden' });

  const note = db.prepare('SELECT * FROM day_notes WHERE id = ? AND day_id = ? AND trip_id = ?').get(id, dayId, tripId);
  if (!note) return res.status(404).json({ error: 'Notiz nicht gefunden' });

  const { text, time, icon, sort_order } = req.body;
  db.prepare(
    'UPDATE day_notes SET text = ?, time = ?, icon = ?, sort_order = ? WHERE id = ?'
  ).run(
    text !== undefined ? text.trim() : note.text,
    time !== undefined ? time : note.time,
    icon !== undefined ? icon : note.icon,
    sort_order !== undefined ? sort_order : note.sort_order,
    id
  );

  const updated = db.prepare('SELECT * FROM day_notes WHERE id = ?').get(id);
  res.json({ note: updated });
  broadcast(tripId, 'dayNote:updated', { dayId: Number(dayId), note: updated }, req.headers['x-socket-id']);
});

// DELETE /api/trips/:tripId/days/:dayId/notes/:id
router.delete('/:id', authenticate, (req, res) => {
  const { tripId, dayId, id } = req.params;
  if (!verifyAccess(tripId, req.user.id)) return res.status(404).json({ error: 'Reise nicht gefunden' });

  const note = db.prepare('SELECT id FROM day_notes WHERE id = ? AND day_id = ? AND trip_id = ?').get(id, dayId, tripId);
  if (!note) return res.status(404).json({ error: 'Notiz nicht gefunden' });

  db.prepare('DELETE FROM day_notes WHERE id = ?').run(id);
  res.json({ success: true });
  broadcast(tripId, 'dayNote:deleted', { noteId: Number(id), dayId: Number(dayId) }, req.headers['x-socket-id']);
});

module.exports = router;
