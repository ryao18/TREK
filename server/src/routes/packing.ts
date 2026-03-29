import express, { Request, Response } from 'express';
import { db, canAccessTrip } from '../db/database';
import { authenticate } from '../middleware/auth';
import { broadcast } from '../websocket';
import { AuthRequest } from '../types';

const router = express.Router({ mergeParams: true });

function verifyTripOwnership(tripId: string | number, userId: number) {
  return canAccessTrip(tripId, userId);
}

router.get('/', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { tripId } = req.params;

  const trip = verifyTripOwnership(tripId, authReq.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const items = db.prepare(
    'SELECT * FROM packing_items WHERE trip_id = ? ORDER BY sort_order ASC, created_at ASC'
  ).all(tripId);

  res.json({ items });
});

router.post('/', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { tripId } = req.params;
  const { name, category, checked } = req.body;

  const trip = verifyTripOwnership(tripId, authReq.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  if (!name) return res.status(400).json({ error: 'Item name is required' });

  const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM packing_items WHERE trip_id = ?').get(tripId) as { max: number | null };
  const sortOrder = (maxOrder.max !== null ? maxOrder.max : -1) + 1;

  const result = db.prepare(
    'INSERT INTO packing_items (trip_id, name, checked, category, sort_order) VALUES (?, ?, ?, ?, ?)'
  ).run(tripId, name, checked ? 1 : 0, category || 'Allgemein', sortOrder);

  const item = db.prepare('SELECT * FROM packing_items WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ item });
  broadcast(tripId, 'packing:created', { item }, req.headers['x-socket-id'] as string);
});

router.put('/:id', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { tripId, id } = req.params;
  const { name, checked, category } = req.body;

  const trip = verifyTripOwnership(tripId, authReq.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const item = db.prepare('SELECT * FROM packing_items WHERE id = ? AND trip_id = ?').get(id, tripId);
  if (!item) return res.status(404).json({ error: 'Item not found' });

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
  broadcast(tripId, 'packing:updated', { item: updated }, req.headers['x-socket-id'] as string);
});

router.delete('/:id', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { tripId, id } = req.params;

  const trip = verifyTripOwnership(tripId, authReq.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const item = db.prepare('SELECT id FROM packing_items WHERE id = ? AND trip_id = ?').get(id, tripId);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  db.prepare('DELETE FROM packing_items WHERE id = ?').run(id);
  res.json({ success: true });
  broadcast(tripId, 'packing:deleted', { itemId: Number(id) }, req.headers['x-socket-id'] as string);
});

// ── Category assignees ──────────────────────────────────────────────────────

router.get('/category-assignees', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { tripId } = req.params;
  const trip = verifyTripOwnership(tripId, authReq.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const rows = db.prepare(`
    SELECT pca.category_name, pca.user_id, u.username, u.avatar
    FROM packing_category_assignees pca
    JOIN users u ON pca.user_id = u.id
    WHERE pca.trip_id = ?
  `).all(tripId);

  // Group by category
  const assignees: Record<string, { user_id: number; username: string; avatar: string | null }[]> = {};
  for (const row of rows as any[]) {
    if (!assignees[row.category_name]) assignees[row.category_name] = [];
    assignees[row.category_name].push({ user_id: row.user_id, username: row.username, avatar: row.avatar });
  }

  res.json({ assignees });
});

router.put('/category-assignees/:categoryName', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { tripId, categoryName } = req.params;
  const { user_ids } = req.body;

  const trip = verifyTripOwnership(tripId, authReq.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const cat = decodeURIComponent(categoryName);
  db.prepare('DELETE FROM packing_category_assignees WHERE trip_id = ? AND category_name = ?').run(tripId, cat);

  if (Array.isArray(user_ids) && user_ids.length > 0) {
    const insert = db.prepare('INSERT OR IGNORE INTO packing_category_assignees (trip_id, category_name, user_id) VALUES (?, ?, ?)');
    for (const uid of user_ids) insert.run(tripId, cat, uid);
  }

  const rows = db.prepare(`
    SELECT pca.user_id, u.username, u.avatar
    FROM packing_category_assignees pca
    JOIN users u ON pca.user_id = u.id
    WHERE pca.trip_id = ? AND pca.category_name = ?
  `).all(tripId, cat);

  res.json({ assignees: rows });
  broadcast(tripId, 'packing:assignees', { category: cat, assignees: rows }, req.headers['x-socket-id'] as string);
});

router.put('/reorder', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { tripId } = req.params;
  const { orderedIds } = req.body;

  const trip = verifyTripOwnership(tripId, authReq.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const update = db.prepare('UPDATE packing_items SET sort_order = ? WHERE id = ? AND trip_id = ?');
  const updateMany = db.transaction((ids: number[]) => {
    ids.forEach((id, index) => {
      update.run(index, id, tripId);
    });
  });

  updateMany(orderedIds);
  res.json({ success: true });
});

export default router;
