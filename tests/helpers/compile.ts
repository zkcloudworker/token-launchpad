import { describe, expect, it } from "@jest/globals";
import { Mina, VerificationKey, Field, Cache } from "o1js";
import { initBlockchain, blockchain } from "zkcloudworker";
import fs from "fs/promises";
import {
  FungibleToken,
  FungibleTokenAdmin,
  WhitelistedFungibleToken,
  FungibleTokenWhitelistedAdmin,
  FungibleTokenBidContract,
  FungibleTokenOfferContract,
  tokenVerificationKeys,
} from "../../src/token.js";
import { FungibleTokenAdmin as FungibleTokenAdminMF } from "./FungibleTokenAdmin.js";
import { FungibleToken as FungibleTokenMF } from "./FungibleToken.js";

import o1js_package from "../../node_modules/o1js/package.json";
import zkcloudworker_package from "../../node_modules/zkcloudworker/package.json";
const o1jsVersion = o1js_package.version;
const zkcloudworkerVersion = zkcloudworker_package.version;
let isDifferent = false;

const contracts = [
  { name: "FungibleToken", contract: FungibleToken },
  { name: "FungibleTokenAdmin", contract: FungibleTokenAdmin },
  { name: "WhitelistedFungibleToken", contract: WhitelistedFungibleToken },
  {
    name: "FungibleTokenWhitelistedAdmin",
    contract: FungibleTokenWhitelistedAdmin,
  },
  { name: "FungibleTokenBidContract", contract: FungibleTokenBidContract },
  { name: "FungibleTokenOfferContract", contract: FungibleTokenOfferContract },
  { name: "FungibleTokenAdminMF", contract: FungibleTokenAdminMF },
  { name: "FungibleTokenMF", contract: FungibleTokenMF },
];

const verificationKeys: { name: string; verificationKey: VerificationKey }[] =
  [];

export function compileContracts(chain: blockchain) {
  const networkId = chain === "mainnet" ? "mainnet" : "testnet";

  const cache: Cache = Cache.FileSystem(
    networkId === "mainnet" ? "./cache-mainnet" : "./cache"
  );

  it("should initialize a blockchain", async () => {
    await initBlockchain(chain);
    console.log("chain:", chain);
    console.log("networkId:", Mina.getNetworkId());
    console.log(`o1js version:`, o1jsVersion);
    console.log(`zkcloudworker version:`, zkcloudworkerVersion);
    for (const contract of contracts) {
      console.log(`${contract.name} contract:`, contract.contract.name);
    }
  });

  it("should compile", async () => {
    console.log("compiling...");
    for (const contract of contracts) {
      console.time(`compiled ${contract.name}`);
      const { verificationKey } = await contract.contract.compile({ cache });
      verificationKeys.push({ name: contract.name, verificationKey });
      console.timeEnd(`compiled ${contract.name}`);
    }
  });

  it("should compare verification keys with MF versions", async () => {
    const sets = [
      { name: "FungibleToken", MF_name: "FungibleTokenMF" },
      { name: "WhitelistedFungibleToken", MF_name: "FungibleTokenMF" },
      { name: "FungibleTokenAdmin", MF_name: "FungibleTokenAdminMF" },
    ];
    for (const set of sets) {
      const verificationKey = verificationKeys.find(
        (vk) => vk.name === set.name
      )?.verificationKey;
      const MF_verificationKey = verificationKeys.find(
        (vk) => vk.name === set.MF_name
      )?.verificationKey;
      if (!verificationKey) {
        throw new Error(`Verification key for ${set.name} not found`);
      }
      if (!MF_verificationKey) {
        throw new Error(`Verification key for ${set.MF_name} not found`);
      }
      expect(verificationKey.hash.toJSON()).toEqual(
        MF_verificationKey.hash.toJSON()
      );
      expect(verificationKey.data).toEqual(MF_verificationKey.data);
    }
  });

  it("should verify the verification keys", async () => {
    for (const contract of contracts) {
      const verificationKey = verificationKeys.find(
        (vk) => vk.name === contract.name
      )?.verificationKey;
      const recordedVerificationKey =
        tokenVerificationKeys[networkId]["vk"][contract.name];
      if (!verificationKey) {
        throw new Error(`Verification key for ${contract.name} not found`);
      }
      if (!recordedVerificationKey) {
        console.error(
          `Recorded verification key for ${contract.name} not found`
        );
        isDifferent = true;
      }
      if (verificationKey.hash.toJSON() !== recordedVerificationKey.hash) {
        console.error(`Verification key for ${contract.name} is different`);
        isDifferent = true;
      }
      if (verificationKey.data !== recordedVerificationKey.data) {
        console.error(
          `Verification key data for ${contract.name} is different`
        );
        isDifferent = true;
      }
    }
    expect(isDifferent).toBe(false);
  });

  it("should save new verification keys", async () => {
    if (isDifferent) {
      console.log("saving new verification keys");
      const vk: any = {};
      vk[networkId] = {
        o1js: o1jsVersion,
        zkcloudworker: zkcloudworkerVersion,
        vk: {},
      };

      for (const contract of verificationKeys) {
        vk[networkId]["vk"][contract.name] = {
          hash: contract.verificationKey.hash.toJSON(),
          data: contract.verificationKey.data,
        };
      }

      await fs.writeFile(
        `./vk/${networkId}-verification-keys.json`,
        JSON.stringify(vk, null, 2)
      );
    }
  });
}