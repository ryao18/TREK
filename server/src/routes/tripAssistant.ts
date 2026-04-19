import express, { Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { verifyTripAccess } from '../services/tripService';
import { runAssistantQuery } from '../services/assistant/orchestrator';

const router = express.Router({ mergeParams: true });

router.post('/query', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const tripId = Number(req.params.tripId);
  const message = String(req.body?.message || '').trim();
  const history = Array.isArray(req.body?.history) ? req.body.history : [];
  const context = req.body?.context && typeof req.body.context === 'object' ? req.body.context : {};

  if (!Number.isFinite(tripId) || tripId <= 0) {
    return res.status(400).json({ error: 'Invalid trip ID' });
  }
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }
  if (!verifyTripAccess(tripId, authReq.user.id)) {
    return res.status(404).json({ error: 'Trip not found' });
  }

  try {
    const result = await runAssistantQuery({
      tripId,
      userId: authReq.user.id,
      message,
      history: history
        .filter((item: any) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
        .slice(-10),
      context,
    });
    res.json(result);
  } catch (err: any) {
    const messageText = err instanceof Error ? err.message : 'Assistant query failed';
    console.error('[assistant] route error', {
      tripId,
      userId: authReq.user.id,
      error: messageText,
      stack: err instanceof Error ? err.stack : undefined,
    });
    const status = /not configured/i.test(messageText) ? 503 : 502;
    res.status(status).json({ error: messageText });
  }
});

export default router;
