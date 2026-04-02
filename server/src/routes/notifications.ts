import express, { Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { testSmtp, testWebhook } from '../services/notifications';
import * as prefsService from '../services/notificationPreferencesService';

const router = express.Router();

router.get('/preferences', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  res.json({ preferences: prefsService.getPreferences(authReq.user.id) });
});

router.put('/preferences', authenticate, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { notify_trip_invite, notify_booking_change, notify_trip_reminder, notify_webhook } = req.body;
  const preferences = prefsService.updatePreferences(authReq.user.id, {
    notify_trip_invite, notify_booking_change, notify_trip_reminder, notify_webhook
  });
  res.json({ preferences });
});

router.post('/test-smtp', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  if (authReq.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { email } = req.body;
  res.json(await testSmtp(email || authReq.user.email));
});

router.post('/test-webhook', authenticate, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  if (authReq.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  res.json(await testWebhook());
});

export default router;
