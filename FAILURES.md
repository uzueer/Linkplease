# Known Failures and Limitations

I focused on getting Part A working reliably first. I tested the API locally with Docker, PostgreSQL, Redis, the worker, and the PseudoGram API. I also tested transient API failures and retries.

There are still some cases where the system can behave incorrectly or where I would improve the design with more time.

### 1. A DM can be accepted but later fail

When PseudoGram returns HTTP `202`, I currently store the DM as `queued` and save the returned `dm_id`.

The important detail is that `202 Accepted` does not mean the DM was actually delivered. PseudoGram can later change that DM to `failed`.

My current worker does not continuously call `GET /v1/dm/{dm_id}` to reconcile the final status. Because of this, a DM that was accepted and later failed can remain in the `queued` state in my database.

With more time, I would add a background reconciliation job that periodically checks queued DMs and updates them to `delivered` or `failed`.

### 2. Worker failure during processing can leave a delivery pending

The worker processes deliveries asynchronously. If the worker crashes or the container is stopped at an unfortunate point while a delivery is being processed or retried, the delivery can remain in the database as `queued`.

The database record is persistent, but my current implementation does not have a separate recovery process that scans old queued deliveries and resumes every interrupted delivery.

I would solve this by having a recovery/reconciliation worker periodically find stale queued deliveries and put them back into the processing queue.

### 3. Duplicate events are handled, but there is still a race-condition risk

I store the incoming `event_id` as unique, which prevents the same event from being inserted into the `events` table more than once.

I also have a unique constraint on `(rule_id, user_id)` in `deliveries`, which protects the main duplicate-DM requirement: the same user should not receive the same rule's DM more than once.

However, if two matching events are processed concurrently before the delivery state is updated, there is still a small race window around the check-and-create operation. The database constraint provides protection against creating duplicate delivery records, but I would make the transaction/idempotency handling more explicit if I were taking this to production at a larger scale.

### 4. Webhook signature verification is not implemented yet

The PseudoGram webhook includes an `X-PseudoGram-Signature` header containing an HMAC-SHA256 signature of the raw request body.

My current `/webhook` endpoint does not verify this signature.

That means a request that knows the webhook format could potentially be sent directly to the endpoint and processed as if it came from PseudoGram.

I would add raw-body HMAC verification before parsing the request and reject requests with an invalid or missing signature.

### 5. `/stats` is limited by the current delivery-status implementation

The assignment defines `sent` as DMs that PseudoGram confirmed as delivered.

My current implementation counts `sent` from deliveries whose database status is `delivered`. However, the Part A worker currently receives the initial `202 queued` response and does not perform final-status reconciliation.

Because of that, the statistics can temporarily show a DM as `queued` even when PseudoGram has already delivered it.

This is one of the main things I would improve before considering the system production-ready.

### 6. I have not fully validated the official 500-event production test

I tested the system locally with smaller batches and verified that events were accepted, queued, processed by the worker, matched against rules, and sent to PseudoGram.

I also observed PseudoGram returning a `500` during testing. The worker retried the request and succeeded on a later attempt.

I have not yet completed a full verified 500-event production run and compared every result against PseudoGram's `/v1/simulate/{run_id}/truth` endpoint.

Because of that, I don't want to claim that the system has been proven under the assignment's full 500-event load.

---

## What I would improve next

If I had another week, my priority would be:

1. Add PseudoGram DM-status reconciliation.
2. Add HMAC webhook signature verification.
3. Add recovery for stale queued deliveries after worker restarts.
4. Run repeated 500-event tests and compare `/stats` against PseudoGram's truth endpoint.
5. Make the delivery/idempotency transaction handling stronger for concurrent events.

I intentionally kept these limitations documented instead of hiding them behind optimistic statistics or claiming that the system handles cases I have not actually tested.