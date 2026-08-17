require("dotenv").config();

const axios = require("axios");

const BASE_URL = "http://localhost:5000";

async function sendEvent(i) {
  const payload = {
    event_id: `evt_load_${i}`,
    event_type: "comment.created",
    data: {
      comment_id: `cmt_load_${i}`,
      post_id: "post_test_001",
      text: "PRICE please!",
      created_at: new Date().toISOString(),
      from: {
        user_id: `usr_load_${i}`,
        username: `loaduser${i}`,
      },
    },
  };

  try {
    const response = await axios.post(
      `${BASE_URL}/webhook`,
      payload
    );

    console.log(
      `${i}: ${response.status}`,
      response.data
    );
  } catch (error) {
    console.error(
      `${i}:`,
      error.response?.data || error.message
    );
  }
}

async function main() {
  console.log("Sending 20 valid comment events...");

  await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      sendEvent(index + 1)
    )
  );

  console.log("Finished sending events.");
}

main();