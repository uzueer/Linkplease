const { Queue } = require("bullmq");

const connection = process.env.REDIS_URL
  ? { url: process.env.REDIS_URL }
  : { host: "localhost", port: 6379 };

const commentQueue = new Queue("comment-processing", {
  connection,
});

module.exports = commentQueue;