const express = require('express');
const { db } = require('../db/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/tags
router.get('/', authenticate, (req, res) => {
  const tags = db.prepare(
    'SELECT * FROM tags WHERE user_id = ? ORDER BY name ASC'
  ).all(req.user.id);
  res.json({ tags });
});

// POST /api/tags
router.post('/', authenticate, (req, res) => {
  const { name, color } = req.body;

  if (!name) return res.status(400).json({ error: 'Tag name is required' });

  const result = db.prepare(
    'INSERT INTO tags (user_id, name, color) VALUES (?, ?, ?)'
  ).run(req.user.id, name, color || '#10b981');

  const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ tag });
});

// PUT /api/tags/:id
router.put('/:id', authenticate, (req, res) => {
  const { name, color } = req.body;
  const tag = db.prepare('SELECT * FROM tags WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);

  if (!tag) return res.status(404).json({ error: 'Tag not found' });

  db.prepare('UPDATE tags SET name = COALESCE(?, name), color = COALESCE(?, color) WHERE id = ?')
    .run(name || null, color || null, req.params.id);

  const updated = db.prepare('SELECT * FROM tags WHERE id = ?').get(req.params.id);
  res.json({ tag: updated });
});

// DELETE /api/tags/:id
router.delete('/:id', authenticate, (req, res) => {
  const tag = db.prepare('SELECT * FROM tags WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!tag) return res.status(404).json({ error: 'Tag not found' });

  db.prepare('DELETE FROM tags WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
