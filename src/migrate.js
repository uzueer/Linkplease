const fs = require("fs");
const path = require("path");
const pool = require("./db");

async function migrate() {
  try {
    const migration001 = fs.readFileSync(
      path.join(__dirname, "../migrations/001_initial.sql"),
      "utf8"
    );

    const migration002 = fs.readFileSync(
      path.join(__dirname, "../migrations/002_stats.sql"),
      "utf8"
    );

    await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");

    await pool.query(migration001);
    await pool.query(migration002);

    console.log("Database migrations completed");
  } catch (error) {
    console.error("Database migration failed:", error);
    throw error;
  }
}

module.exports = migrate;