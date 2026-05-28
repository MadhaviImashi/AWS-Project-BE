# CW Events — Backend

Serverless backend for the CW Events platform. Each feature is an independent AWS Lambda function built with Express and bundled with esbuild.

## Tech Stack

- **Runtime**: Node.js 22
- **Language**: TypeScript
- **HTTP Layer**: Express + `serverless-http` (adapts Express to Lambda)
- **Bundler**: esbuild (bundles each Lambda into a single `index.js` + zip)
- **Database Client**: `pg` (node-postgres)
- **Package Manager**: pnpm

## AWS Resources

| Resource | Purpose |
|----------|---------|
| **AWS Lambda** | Runs each handler as an independent serverless function |
| **API Gateway (HTTP API)** | Routes HTTP requests to Lambda functions; handles CORS and JWT authorization |
| **Amazon RDS (PostgreSQL)** | Stores users, events, event files, and registrations |
| **AWS Secrets Manager** | Stores RDS credentials (auto-rotated); Lambdas fetch username/password at runtime |
| **Amazon S3** | Stores uploaded event files; accessed via pre-signed URLs |
| **Amazon Cognito** | User Pool for authentication; issues JWTs validated by API Gateway |
| **Amazon SES** | Sends registration confirmation emails |
| **AWS IAM** | Grants each Lambda the minimum permissions it needs |

## Lambda Functions

### `cw-events-handler`
Handles all event CRUD and related admin operations.

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/v1/events` | None | List all events with files |
| GET | `/api/v1/events/:id` | None | Get single event with files |
| POST | `/api/v1/events` | Admin | Create event |
| PUT | `/api/v1/events/:id` | Admin | Update event |
| DELETE | `/api/v1/events/:id` | Admin | Delete event (cascades to files and registrations) |
| POST | `/api/v1/events/:id/files` | Admin | Record a file after S3 upload |
| DELETE | `/api/v1/events/:id/files/:fileId` | Admin | Remove file from DB and S3 |
| GET | `/api/v1/events/:id/registrations` | Admin | List registrations for an event |

**Environment variables:** `DB_SECRET_ARN`, `DB_HOST`, `DB_NAME`, `DB_SSL`, `S3_BUCKET_NAME`, `AWS_REGION`

---

### `cw-registration-handler`
Handles user event registrations.

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/v1/registrations/:eventId` | User | Register for an event; fires confirmation email async |
| DELETE | `/api/v1/registrations/:eventId` | User | Cancel registration |
| GET | `/api/v1/registrations/me` | User | List current user's registrations |

**Environment variables:** `DB_SECRET_ARN`, `DB_HOST`, `DB_NAME`, `DB_SSL`, `EMAIL_HANDLER_FUNCTION_NAME`, `AWS_REGION`

---

### `cw-file-handler`
Generates S3 pre-signed URLs for browser-direct uploads and views.

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/v1/files/upload-url` | Admin | Returns a pre-signed PUT URL (5 min expiry) and the S3 key |
| GET | `/api/v1/files/view-url` | User | Returns a pre-signed GET URL (1 hr expiry) for a given S3 key |

**Environment variables:** `S3_BUCKET_NAME`, `AWS_REGION`

---

### `cw-email-handler`
Invoked asynchronously (fire-and-forget) by `cw-registration-handler` to send emails via SES. Does not expose HTTP routes.

**Environment variables:** `SES_FROM_EMAIL`, `AWS_REGION`

---

### `cw-auth-postConfirmation`
Cognito post-confirmation trigger — fires automatically when a user confirms their email.

- Adds the user to the `Users` Cognito group
- Creates a record in the `users` DB table (`cognito_sub`, `email`, `name`)

**Environment variables:** `DB_SECRET_ARN`, `DB_HOST`, `DB_NAME`, `DB_SSL`, `AWS_REGION`

---

## Shared Modules

| File | Purpose |
|------|---------|
| `src/shared/db.ts` | Lazy-initialized PostgreSQL connection pool; fetches credentials from Secrets Manager if `DB_SECRET_ARN` is set, otherwise falls back to `DB_USER`/`DB_PASSWORD` env vars |
| `src/shared/auth.ts` | JWT claim helpers (`getUserSub`, `getUserEmail`, `getClaims`, `requireAdmin`) — reads from API Gateway's `requestContext.authorizer.jwt.claims` |

## Database Schema

```
users               — cognito_sub, email, name (created on sign-up via Cognito trigger)
events              — title, date, time, description, created_by
event_files         — event_id, s3_key, file_name, file_type
event_registrations — event_id, user_sub, user_email, user_name
```

Full schema: [`src/shared/db/schema.sql`](src/shared/db/schema.sql)

## Build

Each Lambda is bundled independently with esbuild into a single `index.js` then zipped:

```bash
# Build all Lambdas
pnpm build:lambdas

# Build a single Lambda
pnpm build:lambdas events-handler
```

Output: `dist/<lambda-name>.zip` — ready to upload to AWS Lambda.

## Deployment

CI/CD is handled by GitHub Actions (`.github/workflows/deploy.yml`). On every push to `main`:

1. Installs dependencies
2. Runs `pnpm build:lambdas`
3. Deploys each zip via `aws lambda update-function-code`

> Note: the workflow only updates function **code**, not environment variables. Env vars are managed manually in the AWS Lambda console.

## Local Development

Since handlers use Express + `serverless-http`, they can be run as plain Express servers locally. Create a `.env` file with direct DB credentials (skipping Secrets Manager):

```env
DB_HOST=localhost
DB_NAME=codewave
DB_USER=postgres
DB_PASSWORD=your_password
DB_PORT=5432
DB_SSL=false
S3_BUCKET_NAME=your-bucket-name
AWS_REGION=ap-southeast-1
```

Then create a local entry point that imports the Express `app` from the handler and calls `app.listen(3001)`.

For full Lambda emulation (including the event/context format), use [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) with a `template.yaml`.
