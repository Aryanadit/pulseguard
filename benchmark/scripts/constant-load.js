import http from "k6/http";
import { check } from "k6";
import {
  BASE_URL,
  TEST_ENDPOINT,
  DEFAULT_HEADERS,
} from "../config/constants.js";

export const options = {
  vus: 50,
  duration: "30s",

  thresholds: {
    http_req_failed: ["rate<0.01"], // Less than 1% failures
    http_req_duration: ["p(95)<10"], // p95 latency under 10 ms
    checks: ["rate>0.99"], // 99%+ checks pass
  },
};

export default function () {
  const response = http.get(`${BASE_URL}${TEST_ENDPOINT}`, {
    headers: DEFAULT_HEADERS,
  });

  const headers = {};
  for (const key in response.headers) {
    headers[key.toLowerCase()] = response.headers[key];
  }

  check(response, {
    "status is 200 or 429": (r) => r.status === 200 || r.status === 429,

    "rate limit headers exist": () =>
      headers["ratelimit-limit"] !== undefined &&
      headers["ratelimit-remaining"] !== undefined,
  });
}
