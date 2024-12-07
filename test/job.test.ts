import { describe, it } from "node:test";
import assert from "node:assert";

import { zkcloudworker } from "../index.js";
import { TokenAPI } from "zkcloudworker";
const JWT: string = process.env.JWT!;

const api = new TokenAPI({
  jwt: JWT,
  zkcloudworker,
  chain: "devnet",
});

describe("Job results", async () => {
  it("should get successful job result", async () => {
    const result = await api.getResults(
      "zkCWiS0tIrDSbGKWClUGZmAhBGw3qRTo3gRuqaJmzVYBtCTPB"
    );
    console.log(result);
    assert.equal(result.jobStatus, "used");
  });

  it("should get failed job result", async () => {
    const result = await api.getResults(
      "zkCWvcg1BiPdLmsyxexOkrC3qZfx2UdLan0JB30cKDYVeSMB"
    );
    assert.equal(result.jobStatus, "failed");
  });
});
