const express = require('express');
const { db } = require('../db/database');
const { authenticate, adminOnly } = require('../middleware/auth');

const router = express.Router();

// GET /api/categories - public to all authenticated users
router.get('/', authenticate, (req, res) => {
  const categories = db.prepare(
    'SELECT * FROM categories ORDER BY name ASC'
  ).all();
  res.json({ categories });
});

// POST /api/categories - admin only
router.post('/', authenticate, adminOnly, (req, res) => {
  const { name, color, icon } = req.body;

  if (!name) return res.status(400).json({ error: 'Category name is required' });

  const result = db.prepare(
    'INSERT INTO categories (name, color, icon, user_id) VALUES (?, ?, ?, ?)'
  ).run(name, color || '#6366f1', icon || '📍', req.user.id);

  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ category });
});

// PUT /api/categories/:id - admin only
router.put('/:id', authenticate, adminOnly, (req, res) => {
  const { name, color, icon } = req.body;
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);

  if (!category) return res.status(404).json({ error: 'Category not found' });

  db.prepare(`
    UPDATE categories SET
      name = COALESCE(?, name),
      color = COALESCE(?, color),
      icon = COALESCE(?, icon)
    WHERE id = ?
  `).run(name || null, color || null, icon || null, req.params.id);

  const updated = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  res.json({ category: updated });
});

// DELETE /api/categories/:id - admin only
router.delete('/:id', authenticate, adminOnly, (req, res) => {
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);

  if (!category) return res.status(404).json({ error: 'Category not found' });

  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
