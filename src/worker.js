require("dotenv").config();
const { Worker } = require("bullmq");
const pool = require("./db");

const connection = {
  host: "localhost",
  port: 6379,
};

const worker = new Worker(
  "comment-processing",
  async (job) => {
    const { database_id } = job.data;

    console.log(`Processing event database ID: ${database_id}`);

    // Get event from PostgreSQL
    const eventResult = await pool.query(
      `SELECT *
       FROM events
       WHERE id = $1`,
      [database_id]
    );

    if (eventResult.rowCount === 0) {
      throw new Error(`Event not found: ${database_id}`);
    }

    const event = eventResult.rows[0];

    console.log(`Comment: ${event.text}`);
    console.log(`User: ${event.user_id}`);

    // Only process comment.created events
    if (event.event_type !== "comment.created") {
      console.log(`Ignoring event type: ${event.event_type}`);
      return;
    }

    // Get all rules
    const rulesResult = await pool.query(
      `SELECT id, keyword, dm_message
       FROM rules`
    );

    const commentText = (event.text || "").toLowerCase();

    for (const rule of rulesResult.rows) {
      const keyword = rule.keyword.toLowerCase();

      // Check whether keyword exists in comment
      if (!commentText.includes(keyword)) {
        continue;
      }

      console.log(
        `Rule matched: "${rule.keyword}" for user ${event.user_id}`
      );

      // Create delivery record.
      // UNIQUE(rule_id, user_id) prevents duplicate DMs.
      const deliveryResult = await pool.query(
        `INSERT INTO deliveries (
          rule_id,
          user_id,
          comment_id,
          status
        )
        VALUES ($1, $2, $3, 'queued')
        ON CONFLICT (rule_id, user_id) DO NOTHING
        RETURNING id`,
        [
          rule.id,
          event.user_id,
          event.comment_id,
        ]
      );

      // User already received this rule's DM
      if (deliveryResult.rowCount === 0) {
        console.log(
          `Duplicate blocked: rule=${rule.id}, user=${event.user_id}`
        );

        continue;
      }

      console.log(
        `Delivery created: ${deliveryResult.rows[0].id}`
      );
    }
  },
  {
    connection,
  }
);

worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`);
});

worker.on("failed", (job, error) => {
  console.error(`Job ${job?.id} failed:`, error);
});

console.log("Comment worker started");