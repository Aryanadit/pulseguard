import http from "k6/http";
import { check } from "k6";
import {
  BASE_URL,
  TEST_ENDPOINT,
  DEFAULT_HEADERS,
} from "../config/constants.js";

export const options = {
  stages: [
    { duration: "30s", target: 10 },
    { duration: "1m", target: 50 },
    { duration: "1m", target: 100 },
    { duration: "1m", target: 200 },
    { duration: "1m", target: 400 },
    { duration: "30s", target: 0 },
  ],

  thresholds: {
    http_req_duration: ["p(95)<20"],
    checks: ["rate>0.99"],
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
