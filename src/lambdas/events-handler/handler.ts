import express from 'express';
import serverless from 'serverless-http';
import { getDb } from '../../shared/db';
import { requireAdmin, getUserSub } from '../../shared/auth';
import { corsMiddleware } from '../../shared/cors';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

const app = express();
app.use(corsMiddleware);
app.use(express.json());

const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });
const BUCKET = process.env.S3_BUCKET_NAME!;

const router = express.Router();

// GET /api/v1/events
router.get('/events', async (req, res) => {
  try {
    const db = getDb();
    const result = await db.query(`
      SELECT e.*,
        COALESCE(json_agg(ef.*) FILTER (WHERE ef.id IS NOT NULL), '[]') AS files
      FROM events e
      LEFT JOIN event_files ef ON e.id = ef.event_id
      GROUP BY e.id
      ORDER BY e.date DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /events error:', err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// GET /api/v1/events/:id
router.get('/events/:id', async (req, res) => {
  try {
    const db = getDb();
    const { rows } = await db.query(`
      SELECT e.*,
        COALESCE(json_agg(ef.*) FILTER (WHERE ef.id IS NOT NULL), '[]') AS files
      FROM events e
      LEFT JOIN event_files ef ON e.id = ef.event_id
      WHERE e.id = $1
      GROUP BY e.id
    `, [req.params.id]);

    if (!rows.length) return res.status(404).json({ error: 'Event not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('GET /events/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

// POST /api/v1/events  [admin]
router.post('/events', requireAdmin, async (req, res) => {
  const { title, date, time, description } = req.body;
  if (!title || !date || !time) {
    return res.status(400).json({ error: 'title, date, and time are required' });
  }
  try {
    const db = getDb();
    const { rows } = await db.query(`
      INSERT INTO events (title, date, time, description, created_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [title, date, time, description ?? null, getUserSub(req)]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST /events error:', err);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// PUT /api/v1/events/:id  [admin]
router.put('/events/:id', requireAdmin, async (req, res) => {
  const { title, date, time, description } = req.body;
  try {
    const db = getDb();
    const { rows } = await db.query(`
      UPDATE events
      SET title = COALESCE($1, title),
          date = COALESCE($2, date),
          time = COALESCE($3, time),
          description = COALESCE($4, description),
          updated_at = now()
      WHERE id = $5
      RETURNING *
    `, [title, date, time, description, req.params.id]);

    if (!rows.length) return res.status(404).json({ error: 'Event not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('PUT /events/:id error:', err);
    res.status(500).json({ error: 'Failed to update event' });
  }
});

// DELETE /api/v1/events/:id  [admin]
router.delete('/events/:id', requireAdmin, async (req, res) => {
  try {
    const db = getDb();

    // Fetch files to delete from S3
    const filesResult = await db.query(
      'SELECT s3_key FROM event_files WHERE event_id = $1',
      [req.params.id],
    );

    // Delete files from S3
    await Promise.all(
      filesResult.rows.map((f) =>
        s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: f.s3_key })),
      ),
    );

    // Delete event (cascades to event_files and event_registrations)
    const { rowCount } = await db.query('DELETE FROM events WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Event not found' });

    res.status(204).send();
  } catch (err) {
    console.error('DELETE /events/:id error:', err);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

// POST /api/v1/events/:id/files  [admin] — records a file after it's been uploaded to S3
router.post('/events/:id/files', requireAdmin, async (req, res) => {
  const { s3Key, fileName, fileType } = req.body;
  if (!s3Key || !fileName || !fileType) {
    return res.status(400).json({ error: 's3Key, fileName, and fileType are required' });
  }
  try {
    const db = getDb();

    // Verify event exists
    const event = await db.query('SELECT id FROM events WHERE id = $1', [req.params.id]);
    if (!event.rows.length) return res.status(404).json({ error: 'Event not found' });

    const { rows } = await db.query(`
      INSERT INTO event_files (event_id, s3_key, file_name, file_type)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [req.params.id, s3Key, fileName, fileType]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST /events/:id/files error:', err);
    res.status(500).json({ error: 'Failed to attach file' });
  }
});

// DELETE /api/v1/events/:id/files/:fileId  [admin]
router.delete('/events/:id/files/:fileId', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const { rows } = await db.query(
      'DELETE FROM event_files WHERE id = $1 AND event_id = $2 RETURNING s3_key',
      [req.params.fileId, req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'File not found' });

    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: rows[0].s3_key }));
    res.status(204).send();
  } catch (err) {
    console.error('DELETE /events/:id/files/:fileId error:', err);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// GET /api/v1/events/:id/registrations  [admin]
router.get('/events/:id/registrations', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const { rows } = await db.query(
      'SELECT * FROM event_registrations WHERE event_id = $1 ORDER BY registered_at DESC',
      [req.params.id],
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /events/:id/registrations error:', err);
    res.status(500).json({ error: 'Failed to fetch registrations' });
  }
});

app.use('/api/v1', router);

export const handler = serverless(app);
