import express from 'express';
import serverless from 'serverless-http';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const app = express();
app.use(express.json());

const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });
const BUCKET = process.env.S3_BUCKET_NAME!;
const URL_EXPIRY_SECONDS = 300; // 5 minutes to complete upload

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

const router = express.Router();

// POST /api/v1/files/upload-url  [admin]
// Body: { eventId: string, fileName: string, contentType: string }
// Returns: { uploadUrl: string, s3Key: string }
router.post('/files/upload-url', async (req, res) => {
  const { eventId, fileName, contentType } = req.body;

  if (!eventId || !fileName || !contentType) {
    return res.status(400).json({ error: 'eventId, fileName, and contentType are required' });
  }

  if (!ALLOWED_TYPES[contentType]) {
    return res.status(400).json({ error: 'Unsupported file type', allowed: Object.keys(ALLOWED_TYPES) });
  }

  const ext = ALLOWED_TYPES[contentType];
  const s3Key = `events/${eventId}/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}.${ext}`;

  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: s3Key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: URL_EXPIRY_SECONDS });

    res.json({ uploadUrl, s3Key });
  } catch (err) {
    console.error('POST /files/upload-url error:', err);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

app.use('/api/v1', router);

export const handler = serverless(app);
