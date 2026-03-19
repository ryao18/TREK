const express = require('express');
const { db, canAccessTrip } = require('../db/database');
const { authenticate } = require('../middleware/auth');
const { broadcast } = require('../websocket');

const router = express.Router({ mergeParams: true });

function verifyTripOwnership(tripId, userId) {
  return canAccessTrip(tripId, userId);
}

// GET /api/trips/:tripId/packing
router.get('/', authenticate, (req, res) => {
  const { tripId } = req.params;

  const trip = verifyTripOwnership(tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Reise nicht gefunden' });

  const items = db.prepare(
    'SELECT * FROM packing_items WHERE trip_id = ? ORDER BY sort_order ASC, created_at ASC'
  ).all(tripId);

  res.json({ items });
});

// POST /api/trips/:tripId/packing
router.post('/', authenticate, (req, res) => {
  const { tripId } = req.params;
  const { name, category, checked } = req.body;

  const trip = verifyTripOwnership(tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Reise nicht gefunden' });

  if (!name) return res.status(400).json({ error: 'Artikelname ist erforderlich' });

  const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM packing_items WHERE trip_id = ?').get(tripId);
  const sortOrder = (maxOrder.max !== null ? maxOrder.max : -1) + 1;

  const result = db.prepare(
    'INSERT INTO packing_items (trip_id, name, checked, category, sort_order) VALUES (?, ?, ?, ?, ?)'
  ).run(tripId, name, checked ? 1 : 0, category || 'Allgemein', sortOrder);

  const item = db.prepare('SELECT * FROM packing_items WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ item });
  broadcast(tripId, 'packing:created', { item }, req.headers['x-socket-id']);
});

// PUT /api/trips/:tripId/packing/:id
router.put('/:id', authenticate, (req, res) => {
  const { tripId, id } = req.params;
  const { name, checked, category } = req.body;

  const trip = verifyTripOwnership(tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Reise nicht gefunden' });

  const item = db.prepare('SELECT * FROM packing_items WHERE id = ? AND trip_id = ?').get(id, tripId);
  if (!item) return res.status(404).json({ error: 'Artikel nicht gefunden' });

  db.prepare(`
    UPDATE packing_items SET
      name = COALESCE(?, name),
      checked = CASE WHEN ? IS NOT NULL THEN ? ELSE checked END,
      category = COALESCE(?, category)
    WHERE id = ?
  `).run(
    name || null,
    checked !== undefined ? 1 : null,
    checked ? 1 : 0,
    category || null,
    id
  );

  const updated = db.prepare('SELECT * FROM packing_items WHERE id = ?').get(id);
  res.json({ item: updated });
  broadcast(tripId, 'packing:updated', { item: updated }, req.headers['x-socket-id']);
});

// DELETE /api/trips/:tripId/packing/:id
router.delete('/:id', authenticate, (req, res) => {
  const { tripId, id } = req.params;

  const trip = verifyTripOwnership(tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Reise nicht gefunden' });

  const item = db.prepare('SELECT id FROM packing_items WHERE id = ? AND trip_id = ?').get(id, tripId);
  if (!item) return res.status(404).json({ error: 'Artikel nicht gefunden' });

  db.prepare('DELETE FROM packing_items WHERE id = ?').run(id);
  res.json({ success: true });
  broadcast(tripId, 'packing:deleted', { itemId: Number(id) }, req.headers['x-socket-id']);
});

// PUT /api/trips/:tripId/packing/reorder
router.put('/reorder', authenticate, (req, res) => {
  const { tripId } = req.params;
  const { orderedIds } = req.body;

  const trip = verifyTripOwnership(tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Reise nicht gefunden' });

  const update = db.prepare('UPDATE packing_items SET sort_order = ? WHERE id = ? AND trip_id = ?');
  const updateMany = db.transaction((ids) => {
    ids.forEach((id, index) => {
      update.run(index, id, tripId);
    });
  });

  updateMany(orderedIds);
  res.json({ success: true });
});

module.exports = router;
