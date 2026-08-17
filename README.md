# LinkPlease

A backend system that automates Instagram comment-to-DM workflows.

A creator can configure a keyword such as `PRICE`. When someone comments something containing that keyword, LinkPlease receives the event through a webhook, matches it against the creator's rules, queues the work, and sends a DM through the PseudoGram API.

The main focus of this project is reliable asynchronous processing, duplicate prevention, retries, rate limiting, and handling failures from an unreliable external API.

---

## Features

- Create keyword-based DM automation rules
- Receive Instagram-style comment events through a webhook
- Case-insensitive keyword matching
- Keyword matching anywhere in the comment
- Asynchronous event processing using Redis/BullMQ
- PostgreSQL persistence for events, rules, and deliveries
- Duplicate delivery protection
- Retry handling for transient PseudoGram failures
- Redis-based rate limiting
- Delivery attempt tracking
- Basic live statistics endpoint
- Dockerized API and worker
- PostgreSQL and Redis support through Docker Compose
- Production deployment on Render

---

# Architecture

```text
                         ┌──────────────────────┐
                         │      PseudoGram      │
                         │     Mock Instagram   │
                         └──────────┬───────────┘
                                    │
                              POST /webhook
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │    LinkPlease API    │
                         │      Express.js      │
                         └──────────┬───────────┘
                                    │
                      ┌─────────────┴─────────────┐
                      │                           │
                      ▼                           ▼
              ┌───────────────┐           ┌───────────────┐
              │  PostgreSQL   │           │     Redis     │
              │               │           │               │
              │ events        │           │ BullMQ Queue  │
              │ rules         │           │ Rate Limiter  │
              │ deliveries    │           │               │
              └───────────────┘           └───────┬───────┘
                                                  │
                                                  ▼
                                         ┌──────────────────┐
                                         │  Comment Worker  │
                                         │     BullMQ       │
                                         └────────┬─────────┘
                                                  │
                                                  ▼
                                         ┌──────────────────┐
                                         │ PseudoGram API   │
                                         │    DM /send      │
                                         └──────────────────┘
```

---

# Request Flow

## 1. Rule creation

The creator creates a rule:

```http
POST /rules
```

Example:

```json
{
  "keyword": "PRICE",
  "dm_message": "Here is the price list!"
}
```

The API stores the rule in PostgreSQL and returns a unique `rule_id`.

---

## 2. Comment webhook

PseudoGram sends a comment event:

```http
POST /webhook
```

The API immediately acknowledges the webhook instead of waiting for the DM to be sent. This keeps the webhook response fast and moves the actual processing to the background worker.

---

## 3. Event persistence

The incoming event is stored in PostgreSQL.

The database stores:

- event ID
- event type
- comment ID
- post ID
- user ID
- username
- comment text
- event timestamps
- processing timestamp

`event_id` is unique, allowing repeated webhook events to be detected.

---

## 4. Queueing

After the event is persisted, the API adds a job to the BullMQ queue.

```text
Queue: comment-processing
```

Redis is used as the backing store for BullMQ.

---

## 5. Worker processing

A separate worker consumes jobs from the queue.

The worker:

1. Loads the event
2. Finds matching rules
3. Checks whether the user has already received a DM for that rule
4. Creates a delivery record
5. Applies rate limiting
6. Calls PseudoGram
7. Stores the returned `dm_id`
8. Retries transient failures

This keeps slow external API operations out of the webhook request.

---

# Duplicate Protection

Duplicate protection is implemented using both event-level and database-level safeguards.

Incoming `event_id` values are unique:

```sql
event_id VARCHAR(255) NOT NULL UNIQUE
```

The `deliveries` table also contains:

```sql
CONSTRAINT unique_rule_user UNIQUE (rule_id, user_id)
```

This means the same user cannot have multiple delivery records for the same rule.

For example:

```text
Rule: PRICE
User: usr_123
```

Once that rule has generated a delivery for that user, another matching event for the same rule will not create another delivery record.

---

# Retry Handling

PseudoGram can return temporary HTTP `500` errors.

These failures are treated as retryable.

Example:

```text
Attempt 1
    ↓
HTTP 500
    ↓
Wait 1 second
    ↓
Attempt 2
    ↓
HTTP 202
    ↓
Delivery accepted
```

The worker tracks:

- `attempts`
- `next_retry_at`
- `status`
- `dm_id`

Invalid requests such as HTTP `400` are not treated as transient failures.

---

# Rate Limiting

PseudoGram allows:

```text
10 requests per rolling 60 seconds
```

The application uses Redis for rate limiting.

Because Redis is shared by the worker processes, the rate-limit state is centralized rather than maintained independently inside each process.

---

# Database Schema

## `rules`

Stores creator automation rules.

```text
id
keyword
dm_message
created_at
```

## `events`

Stores incoming webhook events.

```text
id
event_id
event_type
comment_id
post_id
user_id
username
text
created_at
received_at
processed_at
```

`event_id` is unique.

## `deliveries`

Tracks DM delivery attempts.

```text
id
rule_id
user_id
comment_id
dm_id
status
attempts
next_retry_at
created_at
updated_at
```

The important duplicate-prevention constraint is:

```text
(rule_id, user_id)
```

## `duplicate_blocks`

Stores duplicate blocks for statistics.

```text
id
delivery_id
rule_id
user_id
event_id
created_at
```

---

# API

## POST `/rules`

Creates a new automation rule.

### Request

```json
{
  "keyword": "PRICE",
  "dm_message": "Here is the price list!"
}
```

### Response

```json
{
  "rule_id": "any-string-you-like",
  "keyword": "PRICE",
  "dm_message": "Here is the price list!"
}
```

---

## POST `/webhook`

Receives comment events.

### Response

```json
{
  "received": true
}
```

The API acknowledges the event without waiting for the worker to finish processing it.

---

## GET `/stats`

Returns current delivery statistics.

Example:

```json
{
  "sent": 0,
  "failed": 0,
  "queued": 8,
  "duplicates_blocked": 2
}
```

The values are calculated from PostgreSQL delivery state and duplicate-block records.

---

# Technology Stack

### Backend

- Node.js
- Express.js

### Database

- PostgreSQL 16

### Queue

- BullMQ
- Redis 7

### External API

- PseudoGram Mock Instagram API

### Infrastructure

- Docker
- Docker Compose
- Render

### Development

- Git
- GitHub
- curl
- PostgreSQL CLI

---

# Project Structure

```text
LinkPlease/
│
├── migrations/
│   ├── 001_initial.sql
│   └── 002_stats.sql
│
├── src/
│   ├── db.js
│   ├── migrate.js
│   ├── pseudogram.js
│   ├── queue.js
│   ├── rateLimiter.js
│   ├── redis.js
│   ├── routes.js
│   ├── server.js
│   ├── worker.js
│   └── rate-test.js
│
├── .env.example
├── .gitignore
├── Dockerfile
├── docker-compose.yml
├── FAILURES.md
├── package.json
├── package-lock.json
└── README.md
```

---

# Running Locally

## Requirements

- Docker
- Docker Compose
- Node.js 20+
- Git

## 1. Clone the repository

```bash
git clone https://github.com/uzueer/Linkplease.git
cd Linkplease
```

## 2. Configure environment variables

Create `.env`:

```env
PORT=5000
DATABASE_URL=postgresql://linkplease:linkplease@localhost:5432/linkplease
REDIS_URL=redis://localhost:6379
PSEUDOGRAM_BASE_URL=https://pseudogram-api.onrender.com
PSEUDOGRAM_API_KEY=your_pseudogram_api_key
```

Never commit `.env`.

## 3. Start the application

```bash
docker compose up --build -d
```

Check the containers:

```bash
docker compose ps
```

Expected services:

```text
linkplease-postgres
linkplease-redis
linkplease-api
linkplease-worker
```

## 4. Check the API

```bash
curl http://localhost:5000/
```

Expected:

```json
{
  "message": "LinkPlease API is running"
}
```

---

# Testing

## Create a rule

```bash
curl -X POST http://localhost:5000/rules \
  -H "Content-Type: application/json" \
  -d '{
    "keyword": "PRICE",
    "dm_message": "Here is the price list!"
  }'
```

## Send a webhook

```bash
curl -X POST http://localhost:5000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "evt_test_001",
    "event_type": "comment.created",
    "data": {
      "comment_id": "cmt_test_001",
      "post_id": "post_test_001",
      "text": "PRICE please!",
      "created_at": "2026-08-17T12:00:00.000Z",
      "from": {
        "user_id": "usr_test_001",
        "username": "testuser"
      }
    }
  }'
```

## Check worker logs

```bash
docker compose logs worker --tail=50
```

A successful flow should look similar to:

```text
Processing event database ID: ...
Comment: PRICE please!
User: usr_test_001
Rule matched: "PRICE"
Processing delivery: ...
Sending DM, attempt 1/3
DM API response: { dm_id: "...", status: "queued" }
DM accepted by PseudoGram: ...
Job evt_test_001 completed
```

## Test statistics

```bash
curl http://localhost:5000/stats
```

---

# Failure Testing

The worker was tested against transient PseudoGram failures.

For example:

```text
DM attempt 1 failed: Request failed with status code 500
Retrying in 1000ms...
Sending DM, attempt 2/3
DM API response: { dm_id: "...", status: "queued" }
DM accepted by PseudoGram
```

This demonstrates that a temporary external API failure does not immediately result in a lost delivery.

---

# Docker Architecture

The local Docker Compose environment contains four services:

```text
┌─────────────────────────────┐
│             API             │
│        Node / Express       │
│           :5000             │
└──────────────┬──────────────┘
               │
       ┌───────┴────────┐
       │                │
       ▼                ▼
┌─────────────┐  ┌─────────────┐
│ PostgreSQL  │  │    Redis    │
│    :5432    │  │    :6379    │
└─────────────┘  └──────┬──────┘
                        │
                        ▼
                ┌─────────────┐
                │   Worker    │
                │   BullMQ    │
                └─────────────┘
```

The API and worker share the same PostgreSQL and Redis services.

---

# Production Deployment

The API is deployed using Docker on Render.

Production architecture:

```text
Internet
   │
   ▼
Render Web Service
   │
   ▼
LinkPlease API
   │
   ├──────────────► Render PostgreSQL
   │
   └──────────────► Render Redis
                         │
                         ▼
                   LinkPlease Worker
```

The deployed API URL is:

```text
https://linkplease-ioif.onrender.com
```

The worker must run as a separate background process/service using the same `DATABASE_URL` and `REDIS_URL`.

---

# Environment Variables

Required variables:

```text
PORT
DATABASE_URL
REDIS_URL
PSEUDOGRAM_BASE_URL
PSEUDOGRAM_API_KEY
```

Secrets are stored through environment configuration and are not committed to Git.

---

# Database Migrations

Database initialization is handled through:

```text
migrations/001_initial.sql
migrations/002_stats.sql
```

`001_initial.sql` creates:

```text
rules
events
deliveries
```

`002_stats.sql` creates:

```text
duplicate_blocks
```

The application runs the migrations during startup so a fresh production database can be initialized automatically.

The `pgcrypto` extension is enabled before creating the `rules` table because `gen_random_uuid()` is used for rule IDs.

---

# Design Decisions

## Why PostgreSQL?

PostgreSQL provides durable storage for events, rules, and deliveries.

It also provides database constraints that are useful for reliability, especially the unique constraint on:

```sql
(rule_id, user_id)
```

## Why Redis/BullMQ?

Sending a DM is an external network operation and can fail or take time.

Doing it directly inside the webhook request would make the webhook slower and more vulnerable to failures.

Instead:

```text
Webhook
   ↓
Store event
   ↓
Queue job
   ↓
Return 200
   ↓
Worker processes job
```

## Why a separate worker?

The worker handles external API communication separately from the API server.

This prevents slow PseudoGram requests from blocking incoming webhooks and allows the API and worker to be scaled independently.

## Why retry?

PseudoGram can return temporary HTTP 500 errors.

Retrying transient failures gives the delivery a chance to succeed without immediately marking it as failed.

---

# Reliability Approach

```text
Incoming Event
      │
      ▼
Unique event_id
      │
      ▼
PostgreSQL
      │
      ▼
BullMQ Queue
      │
      ▼
Duplicate Check
      │
      ▼
Delivery Record
      │
      ▼
Redis Rate Limit
      │
      ▼
PseudoGram API
      │
   ┌──┴──┐
   │     │
  202   500
   │     │
   ▼     ▼
Accept  Retry
```

---

# Known Limitations

See [`FAILURES.md`](FAILURES.md) for the full list of known failure cases and limitations.

The main limitations are:

- Final PseudoGram delivery reconciliation is not implemented.
- Webhook HMAC signature verification is not implemented.
- Worker recovery for stale queued deliveries could be improved.
- Full official 500-event production validation has not been completed.
- `/stats` has limitations around distinguishing an accepted DM from a DM confirmed as delivered.

These limitations are documented rather than hidden.

---

# What I Would Improve With More Time

With another week, I would focus on:

1. Implementing PseudoGram DM status reconciliation.
2. Adding HMAC-SHA256 webhook signature verification.
3. Adding persistent recovery for stale queued deliveries.
4. Improving transaction-level idempotency for concurrent events.
5. Running repeated 500-event load tests.
6. Comparing `/stats` against PseudoGram's truth endpoint.
7. Adding automated integration tests for duplicate events, retries, rate limits, and worker restarts.

---

# Assignment Coverage

| Requirement | Status |
|---|---|
| Create keyword rules | ✅ |
| `POST /rules` | ✅ |
| `POST /webhook` | ✅ |
| Case-insensitive keyword matching | ✅ |
| Keyword matching anywhere in comment | ✅ |
| Background processing | ✅ |
| PostgreSQL persistence | ✅ |
| Redis/BullMQ queue | ✅ |
| Duplicate protection | ✅ |
| Retry transient failures | ✅ |
| Rate limiting | ✅ |
| `GET /stats` | ✅ |
| Docker deployment | ✅ |
| Render deployment | ✅ |
| Webhook signature verification | Not implemented |
| Final DM reconciliation | Not implemented |
| Full 500-event validation | Not completed |

---

# Author

**Syed Uzair N**

GitHub: https://github.com/uzueer/Linkplease

---

## License

This project was created as a technical assignment for LinkPlease.
