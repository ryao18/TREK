const express = require('express');
const { db, canAccessTrip } = require('../db/database');
const { authenticate } = require('../middleware/auth');
const { broadcast } = require('../websocket');

const router = express.Router({ mergeParams: true });

function verifyTripOwnership(tripId, userId) {
  return canAccessTrip(tripId, userId);
}

// GET /api/trips/:tripId/budget
router.get('/', authenticate, (req, res) => {
  const { tripId } = req.params;

  const trip = verifyTripOwnership(tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Reise nicht gefunden' });

  const items = db.prepare(
    'SELECT * FROM budget_items WHERE trip_id = ? ORDER BY category ASC, created_at ASC'
  ).all(tripId);

  res.json({ items });
});

// POST /api/trips/:tripId/budget
router.post('/', authenticate, (req, res) => {
  const { tripId } = req.params;
  const { category, name, total_price, persons, days, note } = req.body;

  const trip = verifyTripOwnership(tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Reise nicht gefunden' });

  if (!name) return res.status(400).json({ error: 'Name ist erforderlich' });

  const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM budget_items WHERE trip_id = ?').get(tripId);
  const sortOrder = (maxOrder.max !== null ? maxOrder.max : -1) + 1;

  const result = db.prepare(
    'INSERT INTO budget_items (trip_id, category, name, total_price, persons, days, note, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    tripId,
    category || 'Sonstiges',
    name,
    total_price || 0,
    persons != null ? persons : null,
    days !== undefined && days !== null ? days : null,
    note || null,
    sortOrder
  );

  const item = db.prepare('SELECT * FROM budget_items WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ item });
  broadcast(tripId, 'budget:created', { item }, req.headers['x-socket-id']);
});

// PUT /api/trips/:tripId/budget/:id
router.put('/:id', authenticate, (req, res) => {
  const { tripId, id } = req.params;
  const { category, name, total_price, persons, days, note, sort_order } = req.body;

  const trip = verifyTripOwnership(tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Reise nicht gefunden' });

  const item = db.prepare('SELECT * FROM budget_items WHERE id = ? AND trip_id = ?').get(id, tripId);
  if (!item) return res.status(404).json({ error: 'Budget-Eintrag nicht gefunden' });

  db.prepare(`
    UPDATE budget_items SET
      category = COALESCE(?, category),
      name = COALESCE(?, name),
      total_price = CASE WHEN ? IS NOT NULL THEN ? ELSE total_price END,
      persons = CASE WHEN ? IS NOT NULL THEN ? ELSE persons END,
      days = CASE WHEN ? THEN ? ELSE days END,
      note = CASE WHEN ? THEN ? ELSE note END,
      sort_order = CASE WHEN ? IS NOT NULL THEN ? ELSE sort_order END
    WHERE id = ?
  `).run(
    category || null,
    name || null,
    total_price !== undefined ? 1 : null, total_price !== undefined ? total_price : 0,
    persons !== undefined ? 1 : null, persons !== undefined ? persons : null,
    days !== undefined ? 1 : 0, days !== undefined ? days : null,
    note !== undefined ? 1 : 0, note !== undefined ? note : null,
    sort_order !== undefined ? 1 : null, sort_order !== undefined ? sort_order : 0,
    id
  );

  const updated = db.prepare('SELECT * FROM budget_items WHERE id = ?').get(id);
  res.json({ item: updated });
  broadcast(tripId, 'budget:updated', { item: updated }, req.headers['x-socket-id']);
});

// DELETE /api/trips/:tripId/budget/:id
router.delete('/:id', authenticate, (req, res) => {
  const { tripId, id } = req.params;

  const trip = verifyTripOwnership(tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Reise nicht gefunden' });

  const item = db.prepare('SELECT id FROM budget_items WHERE id = ? AND trip_id = ?').get(id, tripId);
  if (!item) return res.status(404).json({ error: 'Budget-Eintrag nicht gefunden' });

  db.prepare('DELETE FROM budget_items WHERE id = ?').run(id);
  res.json({ success: true });
  broadcast(tripId, 'budget:deleted', { itemId: Number(id) }, req.headers['x-socket-id']);
});

module.exports = router;
