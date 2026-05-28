import { Pool } from 'pg';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

let initPromise: Promise<Pool> | null = null;

const createPool = async (): Promise<Pool> => {
  const host = process.env.DB_HOST!;
  const database = process.env.DB_NAME!;
  const port = parseInt(process.env.DB_PORT ?? '5432');

  let user: string;
  let password: string;

  if (process.env.DB_SECRET_ARN) {
    const response = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_ARN }),
    );
    const secret = JSON.parse(response.SecretString!);
    user = secret.username;
    password = secret.password;
  } else {
    user = process.env.DB_USER!;
    password = process.env.DB_PASSWORD!;
  }

  return new Pool({
    host,
    database,
    user,
    password,
    port,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
};

export const getDb = (): Promise<Pool> => {
  if (!initPromise) {
    initPromise = createPool();
  }
  return initPromise;
};
