require("dotenv").config();

const { Worker } = require("bullmq");
const pool = require("./db");
const { sendDM } = require("./pseudogram");
const { acquireDMRateLimit } = require("./rateLimiter");

const connection = process.env.REDIS_URL
  ? { url: process.env.REDIS_URL }
  : { host: "localhost", port: 6379 };

const MAX_DM_ATTEMPTS = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processDM({
  deliveryId,
  recipientUserId,
  message,
  commentId,
  idempotencyKey,
}) {
  for (let attempt = 1; attempt <= MAX_DM_ATTEMPTS; attempt++) {
    try {
      /*
       * Wait until it is safe to call PseudoGram.
       * PseudoGram allows 10 requests per rolling 60 seconds.
       */
      await acquireDMRateLimit();

      /*
       * Count an actual PseudoGram request.
       */
      await pool.query(
        `UPDATE deliveries
         SET attempts = attempts + 1,
             updated_at = NOW()
         WHERE id = $1`,
        [deliveryId]
      );

      console.log(
        `Sending DM, attempt ${attempt}/${MAX_DM_ATTEMPTS}`
      );

      const dmResult = await sendDM({
        recipientUserId,
        message,
        commentId,
        idempotencyKey,
      });

      console.log("DM API response:", dmResult);

      /*
       * 202 means PseudoGram accepted the DM.
       * It does NOT mean final delivery.
       */
      await pool.query(
        `UPDATE deliveries
         SET dm_id = $1,
             status = 'queued',
             updated_at = NOW()
         WHERE id = $2`,
        [dmResult.dm_id, deliveryId]
      );

      console.log(
        `DM accepted by PseudoGram: ${dmResult.dm_id}`
      );

      return;
    } catch (error) {
      console.error(
        `DM attempt ${attempt} failed:`,
        error.message
      );

      /*
       * 400 = invalid request.
       * Retrying will not fix the request.
       */
      if (error.status === 400) {
        await pool.query(
          `UPDATE deliveries
           SET status = 'failed',
               updated_at = NOW()
           WHERE id = $1`,
          [deliveryId]
        );

        console.error(
          `Delivery ${deliveryId} failed permanently: 400`
        );

        return;
      }

      /*
       * 429 = rate limited.
       * Respect Retry-After from PseudoGram.
       */
      if (error.status === 429) {
        if (attempt >= MAX_DM_ATTEMPTS) {
          break;
        }

        const retryAfterSeconds =
          Number(error.retryAfter) || 5;

        console.log(
          `Rate limited. Waiting ${retryAfterSeconds} seconds...`
        );

        await sleep(retryAfterSeconds * 1000);

        continue;
      }

      /*
       * 500 = temporary PseudoGram failure.
       * Safe to retry according to the assignment.
       *
       * Network errors are also treated as retryable.
       */
      if (error.status === 500 || !error.status) {
        if (attempt >= MAX_DM_ATTEMPTS) {
          break;
        }

        const delay = 1000 * 2 ** (attempt - 1);

        console.log(
          `Retrying in ${delay}ms...`
        );

        await sleep(delay);

        continue;
      }

      /*
       * Unknown error.
       */
      break;
    }
  }

  /*
   * All retry attempts exhausted.
   */
  await pool.query(
    `UPDATE deliveries
     SET status = 'failed',
         updated_at = NOW()
     WHERE id = $1`,
    [deliveryId]
  );

  throw new Error(
    `Delivery ${deliveryId} failed after ${MAX_DM_ATTEMPTS} attempts`
  );
}

const worker = new Worker(
  "comment-processing",

  async (job) => {
    const { database_id } = job.data;

    console.log(
      `Processing event database ID: ${database_id}`
    );

    /*
     * Get the event stored by /webhook.
     */
    const eventResult = await pool.query(
      `SELECT *
       FROM events
       WHERE id = $1`,
      [database_id]
    );

    if (eventResult.rowCount === 0) {
      throw new Error(
        `Event not found: ${database_id}`
      );
    }

    const event = eventResult.rows[0];

    console.log(`Comment: ${event.text}`);
    console.log(`User: ${event.user_id}`);

    /*
     * Part A is about comment.created.
     */
    if (event.event_type !== "comment.created") {
      console.log(
        `Ignoring event type: ${event.event_type}`
      );

      return;
    }

    /*
     * Load rules.
     */
    const rulesResult = await pool.query(
      `SELECT id, keyword, dm_message
       FROM rules`
    );

    const commentText =
      (event.text || "").toLowerCase();

    /*
     * Check every rule.
     */
    for (const rule of rulesResult.rows) {
      const keyword =
        rule.keyword.toLowerCase();

      /*
       * Keyword matching:
       * case-insensitive and anywhere in the comment.
       */
      if (!commentText.includes(keyword)) {
        continue;
      }

      console.log(
        `Rule matched: "${rule.keyword}" for user ${event.user_id}`
      );

      /*
       * Create a delivery.
       *
       * UNIQUE(rule_id, user_id) guarantees that the
       * same user cannot receive the same rule twice.
       *
       * If a delivery already exists, return that
       * existing delivery so an unfinished delivery
       * can be retried.
       */
      const deliveryResult = await pool.query(
        `INSERT INTO deliveries (
          rule_id,
          user_id,
          comment_id,
          status
        )
        VALUES ($1, $2, $3, 'queued')
        ON CONFLICT (rule_id, user_id)
        DO UPDATE SET
          updated_at = NOW()
        RETURNING id, dm_id, status`,
        [
          rule.id,
          event.user_id,
          event.comment_id,
        ]
      );

      const delivery = deliveryResult.rows[0];

      /*
       * If dm_id already exists, PseudoGram has already
       * accepted this logical DM.
       */
      if (delivery.dm_id) {
        console.log(
          `Duplicate blocked: DM already submitted: ${delivery.dm_id}`
        );

        try {
          await pool.query(
            `INSERT INTO duplicate_blocks (
              delivery_id,
              rule_id,
              user_id,
              event_id
            ) VALUES ($1, $2, $3, $4)`,
            [delivery.id, rule.id, event.user_id, event.event_id]
          );
        } catch (err) {
          console.error("Failed to record duplicate block:", err.message);
        }

        continue;
      }

      const deliveryId = delivery.id;

      console.log(
        `Processing delivery: ${deliveryId}`
      );

      /*
       * Same rule + same user = same logical DM.
       *
       * PseudoGram's Idempotency-Key prevents accidental
       * duplicate sends if the API accepts a request but
       * our process does not receive the response.
       */
      const idempotencyKey =
        `${rule.id}:${event.user_id}`;

      await processDM({
        deliveryId,
        recipientUserId: event.user_id,
        message: rule.dm_message,
        commentId: event.comment_id,
        idempotencyKey,
      });
    }
  },

  {
    connection,

    /*
     * Multiple comments can be processed concurrently.
     *
     * The shared Redis rate limiter controls calls
     * to PseudoGram.
     */
    concurrency: 10,
  }
);

worker.on("completed", (job) => {
  console.log(
    `Job ${job.id} completed`
  );
});

worker.on("failed", (job, error) => {
  console.error(
    `Job ${job?.id} failed:`,
    error.message
  );
});

console.log("Comment worker started");