const express = require('express');
const { db, canAccessTrip } = require('../db/database');
const { authenticate } = require('../middleware/auth');
const { broadcast } = require('../websocket');

const router = express.Router({ mergeParams: true });

function verifyTripAccess(tripId, userId) {
  return canAccessTrip(tripId, userId);
}

// ─── NOTES ───────────────────────────────────────────────────────────────────

// GET /notes - list all notes for trip
router.get('/notes', authenticate, (req, res) => {
  const { tripId } = req.params;

  const trip = verifyTripAccess(tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const notes = db.prepare(`
    SELECT n.*, u.username, u.avatar
    FROM collab_notes n
    JOIN users u ON n.user_id = u.id
    WHERE n.trip_id = ?
    ORDER BY n.pinned DESC, n.updated_at DESC
  `).all(tripId);

  res.json({ notes });
});

// POST /notes - create note
router.post('/notes', authenticate, (req, res) => {
  const { tripId } = req.params;
  const { title, content, category, color } = req.body;

  const trip = verifyTripAccess(tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  if (!title) return res.status(400).json({ error: 'Title is required' });

  const result = db.prepare(`
    INSERT INTO collab_notes (trip_id, user_id, title, content, category, color)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(tripId, req.user.id, title, content || null, category || 'General', color || '#6366f1');

  const note = db.prepare(`
    SELECT n.*, u.username, u.avatar
    FROM collab_notes n
    JOIN users u ON n.user_id = u.id
    WHERE n.id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json({ note });
  broadcast(tripId, 'collab:note:created', { note }, req.headers['x-socket-id']);
});

// PUT /notes/:id - update note
router.put('/notes/:id', authenticate, (req, res) => {
  const { tripId, id } = req.params;
  const { title, content, category, color, pinned } = req.body;

  const trip = verifyTripAccess(tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const existing = db.prepare('SELECT * FROM collab_notes WHERE id = ? AND trip_id = ?').get(id, tripId);
  if (!existing) return res.status(404).json({ error: 'Note not found' });

  db.prepare(`
    UPDATE collab_notes SET
      title = COALESCE(?, title),
      content = CASE WHEN ? THEN ? ELSE content END,
      category = COALESCE(?, category),
      color = COALESCE(?, color),
      pinned = CASE WHEN ? IS NOT NULL THEN ? ELSE pinned END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    title || null,
    content !== undefined ? 1 : 0, content !== undefined ? content : null,
    category || null,
    color || null,
    pinned !== undefined ? 1 : null, pinned ? 1 : 0,
    id
  );

  const note = db.prepare(`
    SELECT n.*, u.username, u.avatar
    FROM collab_notes n
    JOIN users u ON n.user_id = u.id
    WHERE n.id = ?
  `).get(id);

  res.json({ note });
  broadcast(tripId, 'collab:note:updated', { note }, req.headers['x-socket-id']);
});

// DELETE /notes/:id - delete note
router.delete('/notes/:id', authenticate, (req, res) => {
  const { tripId, id } = req.params;

  const trip = verifyTripAccess(tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const existing = db.prepare('SELECT id FROM collab_notes WHERE id = ? AND trip_id = ?').get(id, tripId);
  if (!existing) return res.status(404).json({ error: 'Note not found' });

  db.prepare('DELETE FROM collab_notes WHERE id = ?').run(id);
  res.json({ success: true });
  broadcast(tripId, 'collab:note:deleted', { noteId: Number(id) }, req.headers['x-socket-id']);
});

// ─── POLLS ───────────────────────────────────────────────────────────────────

// Helper: fetch a poll with aggregated votes
function getPollWithVotes(pollId) {
  const poll = db.prepare(`
    SELECT p.*, u.username, u.avatar
    FROM collab_polls p
    JOIN users u ON p.user_id = u.id
    WHERE p.id = ?
  `).get(pollId);

  if (!poll) return null;

  poll.options = JSON.parse(poll.options);

  const votes = db.prepare(`
    SELECT v.option_index, v.user_id, u.username, u.avatar
    FROM collab_poll_votes v
    JOIN users u ON v.user_id = u.id
    WHERE v.poll_id = ?
  `).all(pollId);

  poll.votes = votes;
  return poll;
}

// GET /polls - list all polls with votes
router.get('/polls', authenticate, (req, res) => {
  const { tripId } = req.params;

  const trip = verifyTripAccess(tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const rows = db.prepare(`
    SELECT p.*, u.username, u.avatar
    FROM collab_polls p
    JOIN users u ON p.user_id = u.id
    WHERE p.trip_id = ?
    ORDER BY p.created_at DESC
  `).all(tripId);

  const polls = rows.map(poll => {
    poll.options = JSON.parse(poll.options);

    const votes = db.prepare(`
      SELECT v.option_index, v.user_id, u.username, u.avatar
      FROM collab_poll_votes v
      JOIN users u ON v.user_id = u.id
      WHERE v.poll_id = ?
    `).all(poll.id);

    poll.votes = votes;
    return poll;
  });

  res.json({ polls });
});

// POST /polls - create poll
router.post('/polls', authenticate, (req, res) => {
  const { tripId } = req.params;
  const { question, options, multiple, deadline } = req.body;

  const trip = verifyTripAccess(tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  if (!question) return res.status(400).json({ error: 'Question is required' });
  if (!Array.isArray(options) || options.length < 2) {
    return res.status(400).json({ error: 'At least 2 options are required' });
  }

  const result = db.prepare(`
    INSERT INTO collab_polls (trip_id, user_id, question, options, multiple, deadline)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(tripId, req.user.id, question, JSON.stringify(options), multiple ? 1 : 0, deadline || null);

  const poll = getPollWithVotes(result.lastInsertRowid);

  res.status(201).json({ poll });
  broadcast(tripId, 'collab:poll:created', { poll }, req.headers['x-socket-id']);
});

// POST /polls/:id/vote - toggle vote on poll
router.post('/polls/:id/vote', authenticate, (req, res) => {
  const { tripId, id } = req.params;
  const { option_index } = req.body;

  const trip = verifyTripAccess(tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const poll = db.prepare('SELECT * FROM collab_polls WHERE id = ? AND trip_id = ?').get(id, tripId);
  if (!poll) return res.status(404).json({ error: 'Poll not found' });
  if (poll.closed) return res.status(400).json({ error: 'Poll is closed' });

  const options = JSON.parse(poll.options);
  if (option_index < 0 || option_index >= options.length) {
    return res.status(400).json({ error: 'Invalid option index' });
  }

  // Toggle: if vote exists, remove it; otherwise add it
  const existingVote = db.prepare(
    'SELECT id FROM collab_poll_votes WHERE poll_id = ? AND user_id = ? AND option_index = ?'
  ).get(id, req.user.id, option_index);

  if (existingVote) {
    db.prepare('DELETE FROM collab_poll_votes WHERE id = ?').run(existingVote.id);
  } else {
    // If not multiple choice, remove any existing votes by this user first
    if (!poll.multiple) {
      db.prepare('DELETE FROM collab_poll_votes WHERE poll_id = ? AND user_id = ?').run(id, req.user.id);
    }
    db.prepare(
      'INSERT INTO collab_poll_votes (poll_id, user_id, option_index) VALUES (?, ?, ?)'
    ).run(id, req.user.id, option_index);
  }

  const updatedPoll = getPollWithVotes(id);

  res.json({ poll: updatedPoll });
  broadcast(tripId, 'collab:poll:voted', { poll: updatedPoll }, req.headers['x-socket-id']);
});

// PUT /polls/:id/close - close poll
router.put('/polls/:id/close', authenticate, (req, res) => {
  const { tripId, id } = req.params;

  const trip = verifyTripAccess(tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const poll = db.prepare('SELECT * FROM collab_polls WHERE id = ? AND trip_id = ?').get(id, tripId);
  if (!poll) return res.status(404).json({ error: 'Poll not found' });

  db.prepare('UPDATE collab_polls SET closed = 1 WHERE id = ?').run(id);

  const updatedPoll = getPollWithVotes(id);

  res.json({ poll: updatedPoll });
  broadcast(tripId, 'collab:poll:closed', { poll: updatedPoll }, req.headers['x-socket-id']);
});

// DELETE /polls/:id - delete poll
router.delete('/polls/:id', authenticate, (req, res) => {
  const { tripId, id } = req.params;

  const trip = verifyTripAccess(tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const poll = db.prepare('SELECT id FROM collab_polls WHERE id = ? AND trip_id = ?').get(id, tripId);
  if (!poll) return res.status(404).json({ error: 'Poll not found' });

  db.prepare('DELETE FROM collab_polls WHERE id = ?').run(id);
  res.json({ success: true });
  broadcast(tripId, 'collab:poll:deleted', { pollId: Number(id) }, req.headers['x-socket-id']);
});

// ─── MESSAGES (CHAT) ────────────────────────────────────────────────────────

// GET /messages - list messages (last 100, with pagination via ?before=id)
router.get('/messages', authenticate, (req, res) => {
  const { tripId } = req.params;
  const { before } = req.query;

  const trip = verifyTripAccess(tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  let messages;
  if (before) {
    messages = db.prepare(`
      SELECT m.*, u.username, u.avatar,
        rm.text AS reply_text, ru.username AS reply_username
      FROM collab_messages m
      JOIN users u ON m.user_id = u.id
      LEFT JOIN collab_messages rm ON m.reply_to = rm.id
      LEFT JOIN users ru ON rm.user_id = ru.id
      WHERE m.trip_id = ? AND m.id < ?
      ORDER BY m.id DESC
      LIMIT 100
    `).all(tripId, before);
  } else {
    messages = db.prepare(`
      SELECT m.*, u.username, u.avatar,
        rm.text AS reply_text, ru.username AS reply_username
      FROM collab_messages m
      JOIN users u ON m.user_id = u.id
      LEFT JOIN collab_messages rm ON m.reply_to = rm.id
      LEFT JOIN users ru ON rm.user_id = ru.id
      WHERE m.trip_id = ?
      ORDER BY m.id DESC
      LIMIT 100
    `).all(tripId);
  }

  // Return in chronological order (oldest first)
  messages.reverse();

  res.json({ messages });
});

// POST /messages - send message
router.post('/messages', authenticate, (req, res) => {
  const { tripId } = req.params;
  const { text, reply_to } = req.body;

  const trip = verifyTripAccess(tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  if (!text || !text.trim()) return res.status(400).json({ error: 'Message text is required' });

  // Validate reply_to if provided
  if (reply_to) {
    const replyMsg = db.prepare('SELECT id FROM collab_messages WHERE id = ? AND trip_id = ?').get(reply_to, tripId);
    if (!replyMsg) return res.status(400).json({ error: 'Reply target message not found' });
  }

  const result = db.prepare(`
    INSERT INTO collab_messages (trip_id, user_id, text, reply_to)
    VALUES (?, ?, ?, ?)
  `).run(tripId, req.user.id, text.trim(), reply_to || null);

  const message = db.prepare(`
    SELECT m.*, u.username, u.avatar,
      rm.text AS reply_text, ru.username AS reply_username
    FROM collab_messages m
    JOIN users u ON m.user_id = u.id
    LEFT JOIN collab_messages rm ON m.reply_to = rm.id
    LEFT JOIN users ru ON rm.user_id = ru.id
    WHERE m.id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json({ message });
  broadcast(tripId, 'collab:message:created', { message }, req.headers['x-socket-id']);
});

// DELETE /messages/:id - delete own message
router.delete('/messages/:id', authenticate, (req, res) => {
  const { tripId, id } = req.params;

  const trip = verifyTripAccess(tripId, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const message = db.prepare('SELECT * FROM collab_messages WHERE id = ? AND trip_id = ?').get(id, tripId);
  if (!message) return res.status(404).json({ error: 'Message not found' });

  if (message.user_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only delete your own messages' });
  }

  db.prepare('DELETE FROM collab_messages WHERE id = ?').run(id);
  res.json({ success: true });
  broadcast(tripId, 'collab:message:deleted', { messageId: Number(id) }, req.headers['x-socket-id']);
});

module.exports = router;
