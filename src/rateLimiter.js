const { redis, connectRedis } = require("./redis");

const LIMIT = 10;
const WINDOW_MS = 60_000;

const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local request_id = ARGV[4]

redis.call("ZREMRANGEBYSCORE", key, 0, now - window)

local count = redis.call("ZCARD", key)

if count < limit then
    redis.call("ZADD", key, now, request_id)
    redis.call("PEXPIRE", key, window)
    return {1, 0}
end

local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")

if #oldest == 0 then
    return {1, 0}
end

local oldest_timestamp = tonumber(oldest[2])
local wait_ms = (oldest_timestamp + window) - now

return {0, wait_ms}
`;

async function acquireDMRateLimit() {
  await connectRedis();

  while (true) {
    const now = Date.now();

    const requestId =
      `${now}-${process.pid}-${Math.random()}`;

    const result = await redis.eval(
      RATE_LIMIT_SCRIPT,
      {
        keys: ["pseudogram:dm:rate-limit"],
        arguments: [
          String(now),
          String(WINDOW_MS),
          String(LIMIT),
          requestId,
        ],
      }
    );

    const allowed = Number(result[0]);
    const waitMs = Number(result[1]);

    if (allowed === 1) {
      return;
    }

    console.log(
      `DM rate limit reached. Waiting ${waitMs}ms`
    );

    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.max(waitMs, 50)
      )
    );
  }
}

module.exports = {
  acquireDMRateLimit,
};