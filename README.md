# LinkPlease

A backend automation service that turns Instagram-style comments into automated DMs.

When a user comments a configured keyword such as `PRICE`, LinkPlease matches the comment against the creator's rules and sends the appropriate DM through the PseudoGram mock API.

## 🔗 Links

- **Live API:** https://linkplease-ioif.onrender.com
- **GitHub:** https://github.com/uzueer/Linkplease


## 🏗️ Simple Architecture

```text
                PseudoGram
                    │
                    │ POST /webhook
                    ▼
          ┌───────────────────┐
          │  Express API      │
          │  Node.js          │
          └─────────┬─────────┘
                    │
             ┌──────┴──────┐
             │             │
             ▼             ▼
       PostgreSQL        Redis
       Data storage      Queue
       Rules/Events      + Rate Limit
             │             │
             │             ▼
             │       ┌──────────────┐
             └──────►│   Worker     │
                     │   BullMQ     │
                     └──────┬───────┘
                            │
                            ▼
                       PseudoGram
                         DM API
```

### How it works

1. A creator creates a keyword rule through `POST /rules`.
2. PseudoGram sends a comment event to `POST /webhook`.
3. The API stores the event in PostgreSQL.
4. The event is added to a Redis/BullMQ background queue.
5. The worker matches the comment against the configured rules.
6. Duplicate protection checks whether the same user already received a DM for that rule.
7. Redis rate limiting protects the PseudoGram API from exceeding its request limit.
8. The worker sends the DM and retries temporary API failures.

## 🛠️ Tech Stack

| Technology | Purpose |
|---|---|
| Node.js | Backend runtime |
| Express.js | REST API |
| PostgreSQL | Persistent data storage |
| Redis | Queue and rate limiting |
| BullMQ | Background job processing |
| Docker | Containerization |
| Docker Compose | Local development |
| Render | Deployment |
| PseudoGram API | Mock Instagram/DM API |

## 📁 Project Structure

```text
LinkPlease/
├── migrations/
│   ├── 001_initial.sql
│   └── 002_stats.sql
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
├── Dockerfile
├── docker-compose.yml
├── FAILURES.md
├── package.json
└── README.md
```

## 🔌 API Endpoints

### `POST /rules`

Creates a keyword-based DM rule.

```json
{
  "keyword": "PRICE",
  "dm_message": "Here is the price list!"
}
```

### `POST /webhook`

Receives comment events from PseudoGram.

The endpoint acknowledges the webhook quickly and leaves the actual processing to the background worker.

Example response:

```json
{
  "received": true
}
```

### `GET /stats`

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

## 🔐 Reliability

The system was designed around the failure cases in the assignment.

### Duplicate protection

PostgreSQL uses unique constraints on:

```text
event_id
(rule_id, user_id)
```

This prevents the same event from being processed repeatedly and prevents the same user from receiving the same rule's DM multiple times.

### Retry handling

Temporary PseudoGram failures such as HTTP `500` are retried.

Example:

```text
Attempt 1 → HTTP 500
             ↓
          Retry
             ↓
Attempt 2 → HTTP 202
             ↓
       DM accepted
```

### Background processing

DM sending does not block the webhook request. Events are queued and processed by a separate worker.

### Rate limiting

Redis is used to enforce the external API's rate limit across worker processing.

## 🗄️ Database

The application uses PostgreSQL with three main tables:

- `rules` — keyword and DM message configuration
- `events` — incoming webhook events
- `deliveries` — DM delivery state and retry information

A `duplicate_blocks` table is also used for duplicate statistics.

Database initialization is handled through the SQL migrations in `migrations/`.

## 🐳 Run Locally

### Requirements

- Docker
- Docker Compose
- Git
- Node.js 20+ if running outside Docker

### Start

```bash
git clone https://github.com/uzueer/Linkplease.git
cd Linkplease

docker compose up --build -d
```

Check services:

```bash
docker compose ps
```

Check API:

```bash
curl http://localhost:5000/
```

Check statistics:

```bash
curl http://localhost:5000/stats
```

Check worker:

```bash
docker compose logs worker --tail=50
```

## 🧪 Example Test

Create a rule:

```bash
curl -X POST http://localhost:5000/rules   -H "Content-Type: application/json"   -d '{
    "keyword": "PRICE",
    "dm_message": "Here is the price list!"
  }'
```

Send a test comment:

```bash
curl -X POST http://localhost:5000/webhook   -H "Content-Type: application/json"   -d '{
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

Then inspect the worker:

```bash
docker compose logs worker --tail=50
```

## 📊 Testing Failure Recovery

During testing, the PseudoGram API returned a temporary `500` error. The worker retried the request and the next attempt was accepted successfully.

This verified the basic retry path:

```text
PseudoGram 500
      ↓
Worker retry
      ↓
PseudoGram 202
      ↓
Delivery accepted
```

## ⚠️ Known Limitations

The current implementation focuses on **Part A** of the assignment.

The main limitations are documented in [`FAILURES.md`](FAILURES.md).

The most important ones are:

- Final PseudoGram DM delivery-status reconciliation is not implemented.
- Webhook HMAC signature verification is not implemented.
- Worker recovery for stale queued deliveries can be improved.
- Full 500-event production validation was not completed.

These limitations are intentionally documented rather than claiming functionality that was not fully implemented or tested.

## 🚀 Future Improvements

With more development time, I would add:

1. Final DM-status reconciliation using the PseudoGram status API.
2. HMAC-SHA256 webhook signature verification.
3. Persistent recovery for interrupted or stale deliveries.
4. More comprehensive integration and load tests.
5. Automated comparison of `/stats` against PseudoGram's truth endpoint.
6. Stronger transaction-level idempotency for concurrent events.

## 👨‍💻 Author

**Syed Uzair N**

Computer Science Engineering

- GitHub: https://github.com/uzueer
- Repository: https://github.com/uzueer/Linkplease
- Live API: https://linkplease-ioif.onrender.com
- Demo: https://www.loom.com/share/0545349a785a4fc58bfc2ba824044999
