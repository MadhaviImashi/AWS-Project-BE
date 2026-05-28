import { Pool } from 'pg';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

let initPromise: Promise<Pool> | null = null;

const createPool = async (): Promise<Pool> => {
  let host: string, database: string, user: string, password: string, port: number;

  if (process.env.DB_SECRET_ARN) {
    const response = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_ARN }),
    );
    const secret = JSON.parse(response.SecretString!);
    host = secret.host;
    database = secret.dbname;
    user = secret.username;
    password = secret.password;
    port = secret.port ?? 5432;
  } else {
    host = process.env.DB_HOST!;
    database = process.env.DB_NAME!;
    user = process.env.DB_USER!;
    password = process.env.DB_PASSWORD!;
    port = parseInt(process.env.DB_PORT ?? '5432');
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
