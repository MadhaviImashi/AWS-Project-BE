import express from 'express';
import serverless from 'serverless-http';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { getDb } from '../../shared/db';
import { getUserSub, getUserEmail, getClaims } from '../../shared/auth';
import type { EmailPayload } from '../email-handler/handler';

const app = express();
app.use(express.json());

const lambda = new LambdaClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

const invokeEmailHandler = (payload: EmailPayload): void => {
  // InvocationType 'Event' = async fire-and-forget, registrations-handler doesn't wait
  lambda.send(
    new InvokeCommand({
      FunctionName: process.env.EMAIL_HANDLER_FUNCTION_NAME!,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify(payload)),
    }),
  ).catch((err) => console.error('Failed to invoke email-handler:', err));
};

const router = express.Router();

// POST /api/v1/registrations/:eventId  — register for an event
router.post('/registrations/:eventId', async (req, res) => {
  const db = await getDb();
  const userSub = getUserSub(req);
  const userEmail = getUserEmail(req);
  const claims = getClaims(req);
  const userName = claims.name ?? claims['cognito:username'] ?? userEmail;

  try {
    const eventResult = await db.query('SELECT * FROM events WHERE id = $1', [req.params.eventId]);
    if (!eventResult.rows.length) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const event = eventResult.rows[0];

    const { rows } = await db.query(`
      INSERT INTO event_registrations (event_id, user_sub, user_email, user_name)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [req.params.eventId, userSub, userEmail, userName]);

    // Async invoke email-handler — registration response is not delayed by email sending
    invokeEmailHandler({
      type: 'REGISTRATION_CONFIRMATION',
      to: userEmail,
      data: {
        userName,
        eventTitle: event.title,
        eventDate: event.date,
        eventTime: event.time,
        eventDescription: event.description,
      },
    });

    res.status(201).json(rows[0]);
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Already registered for this event' });
    }
    console.error('POST /registrations/:eventId error:', err);
    res.status(500).json({ error: 'Failed to register for event' });
  }
});

// DELETE /api/v1/registrations/:eventId  — cancel registration
router.delete('/registrations/:eventId', async (req, res) => {
  try {
    const db = await getDb();
    const { rowCount } = await db.query(
      'DELETE FROM event_registrations WHERE event_id = $1 AND user_sub = $2',
      [req.params.eventId, getUserSub(req)],
    );
    if (!rowCount) return res.status(404).json({ error: 'Registration not found' });
    res.status(204).send();
  } catch (err) {
    console.error('DELETE /registrations/:eventId error:', err);
    res.status(500).json({ error: 'Failed to cancel registration' });
  }
});

// GET /api/v1/registrations/me  — list current user's registrations
router.get('/registrations/me', async (req, res) => {
  try {
    const db = await getDb();
    const { rows } = await db.query(`
      SELECT r.*, e.title, e.date, e.time, e.description
      FROM event_registrations r
      JOIN events e ON r.event_id = e.id
      WHERE r.user_sub = $1
      ORDER BY r.registered_at DESC
    `, [getUserSub(req)]);
    res.json(rows);
  } catch (err) {
    console.error('GET /registrations/me error:', err);
    res.status(500).json({ error: 'Failed to fetch registrations' });
  }
});

app.use('/api/v1', router);

export const handler = serverless(app);
