import { describe, expect, it } from "@jest/globals";
import { PrivateKey } from "o1js";

import { zkCloudWorkerClient, blockchain, initBlockchain } from "zkcloudworker";
import { zkcloudworker } from "..";
import packageJson from "../package.json";
import { JWT, DEPLOYER_PRIVATE_KEY } from "../env.json";

const { name: repo, author: developer } = packageJson;
const { chain, deploy, mint, useLocalCloudWorker } = processArguments();

const api = new zkCloudWorkerClient({
  jwt: useLocalCloudWorker ? "local" : JWT,
  zkcloudworker,
  chain,
});

let admin: PrivateKey;

const adminContract = PrivateKey.randomKeypair();
const token = PrivateKey.randomKeypair();
const user = PrivateKey.randomKeypair();

describe("Token Worker", () => {
  it(`should initialize blockchain`, async () => {
    if (chain === "local" || chain === "lightnet") {
      console.log("local chain:", chain);
      const { keys } = await initBlockchain(chain, 1);
      expect(keys.length).toBeGreaterThanOrEqual(1);
      if (keys.length < 1) throw new Error("Invalid keys");
      admin = keys[0].key;
    } else {
      console.log("non-local chain:", chain);
      await initBlockchain(chain);
      admin = PrivateKey.fromBase58(DEPLOYER_PRIVATE_KEY);
    }

    process.env.DEPLOYER_PRIVATE_KEY = admin.toBase58();
    process.env.DEPLOYER_PUBLIC_KEY = admin.toPublicKey().toBase58();
  });

  if (deploy) {
    it(`should deploy contract`, async () => {
      console.log(`Deploying contract...`);
      console.time(`Deployed contract`);

      /*
          private async deployTx(args: {
              contractPrivateKey: string;
              adminPrivateString: string;
              adminContractPrivateKey: string;
              symbol: string;
              uri: string;
            }): Promise<string> {
      */
      const answer = await api.execute({
        developer,
        repo,
        transactions: [],
        task: "deploy",
        args: JSON.stringify({
          contractPrivateKey: token.privateKey.toBase58(),
          adminPrivateString: admin.toBase58(),
          adminContractPrivateKey: adminContract.privateKey.toBase58(),
          symbol: "TEST",
          uri: "token-test",
        }),
        metadata: `deploy token`,
      });
      console.log("answer:", answer);
      expect(answer).toBeDefined();
      expect(answer.success).toBe(true);
      const jobId = answer.jobId;
      expect(jobId).toBeDefined();
      if (jobId === undefined) throw new Error("Job ID is undefined");
      const deployResult = await api.waitForJobResult({
        jobId,
        printLogs: true,
      });
      console.log("Token deployment result:", deployResult.result.result);
      console.timeEnd(`Deployed contract`);
    });
  }

  if (mint) {
    it(`should mint tokens`, async () => {
      console.time(`Tokens minted`);

      /*
        private async mintTx(args: {
            amount: number;
            contractAddress: string;
            to: string;
            adminPrivateKey: string;
          }): Promise<string> {
      */
      const answer = await api.execute({
        developer,
        repo,
        transactions: [],
        task: "mint",
        args: JSON.stringify({
          amount: 1000,
          contractAddress: token.publicKey.toBase58(),
          to: user.publicKey.toBase58(),
          adminPrivateKey: admin.toBase58(),
        }),
        metadata: `mint tokens`,
      });
      console.log("answer:", answer);
      expect(answer).toBeDefined();
      expect(answer.success).toBe(true);
      const jobId = answer.jobId;
      expect(jobId).toBeDefined();
      if (jobId === undefined) throw new Error("Job ID is undefined");
      const mintResult = await api.waitForJobResult({
        jobId,
        printLogs: true,
      });
      console.log("Token mint result:", mintResult.result.result);
      console.timeEnd(`Tokens minted`);
    });
  }
});

function processArguments(): {
  chain: blockchain;
  deploy: boolean;
  mint: boolean;
  useLocalCloudWorker: boolean;
} {
  function getArgument(arg: string): string | undefined {
    const argument = process.argv.find((a) => a.startsWith("--" + arg));
    return argument?.split("=")[1];
  }

  const chainName = getArgument("chain") ?? "local";
  const shouldDeploy = getArgument("deploy") ?? "true";
  const shouldMint = getArgument("mint") ?? "true";
  const cloud = getArgument("cloud");

  if (
    chainName !== "local" &&
    chainName !== "devnet" &&
    chainName !== "lightnet" &&
    chainName !== "zeko"
  )
    throw new Error("Invalid chain name");
  return {
    chain: chainName as blockchain,
    deploy: shouldDeploy === "true",
    mint: shouldMint === "true",
    useLocalCloudWorker: cloud
      ? cloud === "local"
      : chainName === "local" || chainName === "lightnet",
  };
}
