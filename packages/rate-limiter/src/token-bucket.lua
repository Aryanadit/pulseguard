-- Token Bucket Rate Limiter
--
-- KEYS[1] = Redis key for this bucket
--
-- ARGV[1] = capacity      (maximum tokens in the bucket)
-- ARGV[2] = refill_rate   (tokens added per second)
-- ARGV[3] = requested     (tokens needed for this request)
-- ARGV[4] = now_ms        (current timestamp in milliseconds)
--
-- Returns:
-- { allowed, remaining_tokens, retry_after_ms }

local key = KEYS[1]

local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local requested = tonumber(ARGV[3])
local now_ms = tonumber(ARGV[4])

-- Read current bucket state from Redis
local data = redis.call("HMGET", key, "tokens", "last_refill_ms")

local tokens = tonumber(data[1])
local last_refill_ms = tonumber(data[2])

-- If this bucket does not exist yet, start with a full bucket
if tokens == nil or last_refill_ms == nil then
  tokens = capacity
  last_refill_ms = now_ms
end

-- Compute how much time has elapsed since last refill
local elapsed_seconds = (now_ms - last_refill_ms) / 1000.0

-- Calculate how many tokens should be added
local refill_tokens = elapsed_seconds * refill_rate

-- Refill bucket, but never exceed capacity
tokens = math.min(capacity, tokens + refill_tokens)

-- Update refill timestamp
last_refill_ms = now_ms

local allowed = 0
local retry_after_ms = 0

-- Determine whether this request can be served
if tokens >= requested then
  tokens = tokens - requested
  allowed = 1
else
  local deficit = requested - tokens
  retry_after_ms = math.ceil((deficit / refill_rate) * 1000)
end

-- TTL is 2× the time required to completely refill an empty bucket
local ttl_seconds = math.ceil((capacity / refill_rate) * 2)

-- Persist updated state
redis.call(
  "HMSET",
  key,
  "tokens", tokens,
  "last_refill_ms", last_refill_ms
)

-- Automatically clean up idle buckets
redis.call("EXPIRE", key, ttl_seconds)

-- Return:
-- 1. allowed (1 = yes, 0 = no)
-- 2. remaining whole tokens
-- 3. retry time in milliseconds
return {
  allowed,
  math.floor(tokens),
  retry_after_ms
}