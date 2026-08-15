const { Queue } = require("bullmq");

const connection = {
  host: "localhost",
  port: 6379,
};

const commentQueue = new Queue("comment-processing", {
  connection,
});

module.exports = commentQueue;