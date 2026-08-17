require("dotenv").config();

const express = require("express");
const routes = require("./routes");

const pool = require("./db");
const { connectRedis } = require("./redis");
const migrate = require("./migrate");

const app = express();

app.use(express.json());
app.use(routes);

app.get("/", (req, res) => {
  res.json({
    message: "LinkPlease API is running",
  });
});

async function startServer() {
  try {
    await pool.query("SELECT 1");
    console.log("PostgreSQL connected");

    await migrate();

    await connectRedis();
    console.log("Redis connected");

    const PORT = process.env.PORT || 5000;

    app.listen(PORT, () => {
      console.log(`LinkPlease running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();