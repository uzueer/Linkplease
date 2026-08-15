const express = require("express");
const pool = require("./db");
const commentQueue = require("./queue");

const router = express.Router();

// POST /rules
router.post("/rules", async (req, res) => {
  try {
    const { keyword, dm_message } = req.body;

    if (!keyword || !dm_message) {
      return res.status(400).json({
        error: "keyword and dm_message are required",
      });
    }

    const result = await pool.query(
      `INSERT INTO rules (keyword, dm_message)
       VALUES ($1, $2)
       RETURNING id, keyword, dm_message`,
      [keyword, dm_message]
    );

    const rule = result.rows[0];

    res.status(201).json({
      rule_id: rule.id,
      keyword: rule.keyword,
      dm_message: rule.dm_message,
    });
  } catch (error) {
    console.error("Create rule error:", error);

    res.status(500).json({
      error: "Internal server error",
    });
  }
});

router.post("/webhook", async (req, res) => {
  try {
    const event = req.body;

    if (!event.event_id || !event.event_type) {
      return res.status(400).json({
        error: "Invalid webhook event",
      });
    }

    const data = event.data || {};

    const result = await pool.query(
      `INSERT INTO events (
        event_id,
        event_type,
        comment_id,
        post_id,
        user_id,
        username,
        text,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (event_id) DO NOTHING
      RETURNING id`,
      [
        event.event_id,
        event.event_type,
        data.comment_id || null,
        data.post_id || null,
        data.from?.user_id || null,
        data.from?.username || null,
        data.text || null,
        data.created_at || null,
      ]
    );

    // Duplicate event
    if (result.rowCount === 0) {
      console.log(`Duplicate event ignored: ${event.event_id}`);

      return res.status(200).json({
        received: true,
      });
    }

    const eventId = result.rows[0].id;

    await commentQueue.add(
      "process-comment",
      {
        event_id: event.event_id,
        database_id: eventId,
      },
      {
        jobId: event.event_id,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
      }
    );

    console.log(`Event queued: ${event.event_id}`);

    return res.status(200).json({
      received: true,
    });
  } catch (error) {
    console.error("Webhook error:", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
});
module.exports = router;