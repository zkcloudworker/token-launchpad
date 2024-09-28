"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const o1js_1 = require("o1js");
const zkcloudworker_1 = require("zkcloudworker");
const __1 = require("..");
const package_json_1 = __importDefault(require("../package.json"));
const env_json_1 = require("../env.json");
const { name: repo, author: developer } = package_json_1.default;
const { chain, deploy, mint, useLocalCloudWorker } = processArguments();
const api = new zkcloudworker_1.zkCloudWorkerClient({
    jwt: useLocalCloudWorker ? "local" : env_json_1.JWT,
    zkcloudworker: __1.zkcloudworker,
    chain,
});
let admin;
const adminContract = o1js_1.PrivateKey.randomKeypair();
const token = o1js_1.PrivateKey.randomKeypair();
const user = o1js_1.PrivateKey.randomKeypair();
(0, globals_1.describe)("Token Worker", () => {
    (0, globals_1.it)(`should initialize blockchain`, async () => {
        if (chain === "local" || chain === "lightnet") {
            console.log("local chain:", chain);
            const { keys } = await (0, zkcloudworker_1.initBlockchain)(chain, 1);
            (0, globals_1.expect)(keys.length).toBeGreaterThanOrEqual(1);
            if (keys.length < 1)
                throw new Error("Invalid keys");
            admin = keys[0].key;
        }
        else {
            console.log("non-local chain:", chain);
            await (0, zkcloudworker_1.initBlockchain)(chain);
            admin = o1js_1.PrivateKey.fromBase58(env_json_1.DEPLOYER_PRIVATE_KEY);
        }
        process.env.DEPLOYER_PRIVATE_KEY = admin.toBase58();
        process.env.DEPLOYER_PUBLIC_KEY = admin.toPublicKey().toBase58();
    });
    if (deploy) {
        (0, globals_1.it)(`should deploy contract`, async () => {
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
            (0, globals_1.expect)(answer).toBeDefined();
            (0, globals_1.expect)(answer.success).toBe(true);
            const jobId = answer.jobId;
            (0, globals_1.expect)(jobId).toBeDefined();
            if (jobId === undefined)
                throw new Error("Job ID is undefined");
            const deployResult = await api.waitForJobResult({
                jobId,
                printLogs: true,
            });
            console.log("Token deployment result:", deployResult.result.result);
            console.timeEnd(`Deployed contract`);
        });
    }
    if (mint) {
        (0, globals_1.it)(`should mint tokens`, async () => {
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
            (0, globals_1.expect)(answer).toBeDefined();
            (0, globals_1.expect)(answer.success).toBe(true);
            const jobId = answer.jobId;
            (0, globals_1.expect)(jobId).toBeDefined();
            if (jobId === undefined)
                throw new Error("Job ID is undefined");
            const mintResult = await api.waitForJobResult({
                jobId,
                printLogs: true,
            });
            console.log("Token mint result:", mintResult.result.result);
            console.timeEnd(`Tokens minted`);
        });
    }
});
function processArguments() {
    function getArgument(arg) {
        const argument = process.argv.find((a) => a.startsWith("--" + arg));
        return argument?.split("=")[1];
    }
    const chainName = getArgument("chain") ?? "local";
    const shouldDeploy = getArgument("deploy") ?? "true";
    const shouldMint = getArgument("mint") ?? "true";
    const cloud = getArgument("cloud");
    if (chainName !== "local" &&
        chainName !== "devnet" &&
        chainName !== "lightnet" &&
        chainName !== "zeko")
        throw new Error("Invalid chain name");
    return {
        chain: chainName,
        deploy: shouldDeploy === "true",
        mint: shouldMint === "true",
        useLocalCloudWorker: cloud
            ? cloud === "local"
            : chainName === "local" || chainName === "lightnet",
    };
}
