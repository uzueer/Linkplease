require("dotenv").config();

const axios = require("axios");

const pseudogram = axios.create({
  baseURL: process.env.PSEUDOGRAM_BASE_URL,
  headers: {
    "X-API-Key": process.env.PSEUDOGRAM_API_KEY,
    "Content-Type": "application/json",
  },
});

async function sendDM({
  recipientUserId,
  message,
  commentId,
  idempotencyKey,
}) {
  try {
    const response = await pseudogram.post(
      "/v1/dm/send",
      {
        recipient_user_id: recipientUserId,
        message,
        comment_id: commentId,
      },
      {
        headers: {
          "Idempotency-Key": idempotencyKey,
        },
      }
    );

    return response.data;
  } catch (error) {
    const status = error.response?.status;

    const apiError = new Error(
      error.response?.data?.error || error.message
    );

    apiError.status = status;
    apiError.retryAfter = error.response?.headers?.["retry-after"];

    throw apiError;
  }
}

module.exports = {
  sendDM,
};