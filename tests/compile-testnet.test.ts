import { describe, expect, it } from "@jest/globals";
import { compileContracts } from "./helpers/compile.js";

describe("Contracts verification keys on testnet", () => {
  compileContracts("devnet");
});