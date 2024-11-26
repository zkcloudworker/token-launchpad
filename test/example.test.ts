import { describe, it } from "node:test";
import assert from "node:assert";

describe("Example", async () => {
  it("should work", async () => {
    console.log("Hello, world!");
    console.log("wallet:", process.env.WALLET);
  });

  it("should not work", async () => {
    console.log("Hello, world 2!");
    //assert.fail("Should not work");
  });
});
