import { describe, expect, it } from "@jest/globals";
import {
  Mina,
  AccountUpdate,
  UInt64,
  Cache,
  PublicKey,
  setNumberOfWorkers,
  UInt8,
  Bool,
  Field,
} from "o1js";

import {
  TokenAPI,
  sleep,
  Memory,
  fetchMinaAccount,
  fee,
  initBlockchain,
  accountBalanceMina,
  FungibleToken,
  FungibleTokenAdmin,
  serializeTransaction,
  fungibleTokenVerificationKeys,
} from "zkcloudworker";
import { zkcloudworker } from "..";
import { JWT } from "../env.json";
import {
  testKeys as devnetKeys,
  tokenContractKey,
  adminContractKey,
  wallet,
} from "./config";
import { processArguments, sendTx, getTxStatusFast } from "./utils";

const { TestPublicKey } = Mina;
type TestPublicKey = Mina.TestPublicKey;

setNumberOfWorkers(8);

const {
  chain,
  compile,
  deploy,
  mint,
  transfer,
  useRandomTokenAddress,
  useLocalCloudWorker,
} = processArguments();

const api = new TokenAPI({
  jwt: useLocalCloudWorker ? "local" : JWT,
  zkcloudworker,
  chain,
});

describe("Token Launchpad Worker", () => {
  const symbol = "TEST";
  const name = "Test Token";
  const src = "https://minatokens.com";
  let keys: TestPublicKey[];
  let admin: TestPublicKey;
  let user1: TestPublicKey;
  let user2: TestPublicKey;
  let user3: TestPublicKey;
  let user4: TestPublicKey;

  let tokenKey = useRandomTokenAddress
    ? TestPublicKey.random()
    : tokenContractKey;
  let adminKey = useRandomTokenAddress
    ? TestPublicKey.random()
    : adminContractKey;
  const MINT_FEE = 1e8;
  const ISSUE_FEE = 1e9;
  const TRANSFER_FEE = 1e8;

  it(`should initialize blockchain`, async () => {
    Memory.info("initializing blockchain");

    if (chain === "local" || chain === "lightnet") {
      console.log("local chain:", chain);
      keys = (await initBlockchain(chain, 10)).keys;
    } else {
      console.log("non-local chain:", chain);
      await initBlockchain(chain);
      keys = devnetKeys;
    }
    expect(keys.length).toBeGreaterThanOrEqual(6);
    if (keys.length < 6) throw new Error("Invalid keys");
    let topup: TestPublicKey;
    [admin, user1, user2, user3, user4, topup] = keys;
    await fetchMinaAccount({ publicKey: wallet, force: false });
    if (!Mina.hasAccount(wallet)) {
      const topupTx = await Mina.transaction(
        {
          sender: topup,
          fee: await fee(),
          memo: "topup",
        },
        async () => {
          const senderUpdate = AccountUpdate.createSigned(topup);
          senderUpdate.balance.subInPlace(1000000000);
          senderUpdate.send({ to: wallet, amount: 1_000_000_000 });
        }
      );
      topupTx.sign([topup.key]);
      await sendTx(topupTx, "topup");
    }

    console.log("contract address:", tokenKey.toBase58());
    console.log("admin:", admin.toBase58());
    console.log("admin balance:", await accountBalanceMina(admin));
    console.log("user1 balance:", await accountBalanceMina(user1));
    console.log("user2 balance:", await accountBalanceMina(user2));
    console.log("user3 balance:", await accountBalanceMina(user3));
    console.log("user4 balance:", await accountBalanceMina(user4));
    console.log("wallet balance:", await accountBalanceMina(wallet));
  });

  if (compile) {
    it(`should compile contract`, async () => {
      console.log("Analyzing contracts methods...");
      console.time("methods analyzed");
      const methods = [
        {
          name: "FungibleToken",
          result: await FungibleToken.analyzeMethods(),
          skip: false,
        },
        {
          name: "FungibleTokenAdmin",
          result: await FungibleTokenAdmin.analyzeMethods(),
          skip: false,
        },
      ];
      console.timeEnd("methods analyzed");
      const maxRows = 2 ** 16;
      for (const contract of methods) {
        // calculate the size of the contract - the sum or rows for each method
        const size = Object.values(contract.result).reduce(
          (acc, method) => acc + method.rows,
          0
        );
        // calculate percentage rounded to 0 decimal places
        const percentage = Math.round(((size * 100) / maxRows) * 100) / 100;

        console.log(
          `method's total size for a ${contract.name} is ${size} rows (${percentage}% of max ${maxRows} rows)`
        );
        if (contract.skip !== true)
          for (const method in contract.result) {
            console.log(method, `rows:`, (contract.result as any)[method].rows);
          }
      }

      console.time("compiled");
      console.log("Compiling contracts...");
      const cache: Cache = Cache.FileSystem("./cache");

      console.time("FungibleTokenAdmin compiled");
      const adminVerificationKey = (await FungibleTokenAdmin.compile({ cache }))
        .verificationKey;
      console.timeEnd("FungibleTokenAdmin compiled");

      console.time("FungibleToken compiled");
      const tokenVerificationKey = (await FungibleToken.compile({ cache }))
        .verificationKey;
      console.timeEnd("FungibleToken compiled");
      console.timeEnd("compiled");
      Memory.info("compiled");
      const printVerificationKey = true;
      if (printVerificationKey) {
        console.log("admin:", {
          hash: adminVerificationKey.hash.toJSON(),
          //data: adminVerificationKey.data,
        });
        console.log("token:", {
          hash: tokenVerificationKey.hash.toJSON(),
          //data: tokenVerificationKey.data,
        });
      }
    });
  }
  if (deploy) {
    it(`should deploy contract`, async () => {
      console.log("deploying contract");
      console.time("deployed");
      const vk =
        fungibleTokenVerificationKeys[
          chain === "mainnet" ? "mainnet" : "testnet"
        ];
      FungibleTokenAdmin._verificationKey = {
        hash: Field(vk.admin.hash),
        data: vk.admin.data,
      };
      FungibleToken._verificationKey = {
        hash: Field(vk.token.hash),
        data: vk.token.data,
      };

      await fetchMinaAccount({ publicKey: admin, force: true });
      const adminContract = new FungibleTokenAdmin(adminKey);
      const tokenContract = new FungibleToken(tokenKey);
      const nonce = Number(Mina.getAccount(admin).nonce.toBigint());
      const memo = `deploy token ${symbol}`.substring(0, 30);

      const tx = await Mina.transaction(
        { sender: admin, fee: await fee(), memo, nonce },
        async () => {
          AccountUpdate.fundNewAccount(admin, 3);
          const provingFee = AccountUpdate.createSigned(admin);
          provingFee.send({
            to: wallet,
            amount: UInt64.from(ISSUE_FEE),
          });
          await adminContract.deploy({ adminPublicKey: admin });
          adminContract.account.zkappUri.set(src);
          await tokenContract.deploy({
            symbol,
            src,
          });
          await tokenContract.initialize(
            adminKey,
            UInt8.from(9), // TODO: set decimals
            // We can set `startPaused` to `Bool(false)` here, because we are doing an atomic deployment
            // If you are not deploying the admin and token contracts in the same transaction,
            // it is safer to start the tokens paused, and resume them only after verifying that
            // the admin contract has been deployed
            Bool(false)
          );
        }
      );
      tx.sign([admin.key, adminKey.key, tokenKey.key]);
      const serializedTransaction = serializeTransaction(tx);
      const transaction = tx.toJSON();
      const txJSON = JSON.parse(transaction);
      let signedData = JSON.stringify({ zkappCommand: txJSON });
      console.log("sending deploy transaction");
      const jobId = await api.sendDeployTransaction({
        serializedTransaction,
        signedData,
        adminContractPublicKey: adminKey.toBase58(),
        tokenPublicKey: tokenKey.toBase58(),
        adminPublicKey: admin.toBase58(),
        chain,
        symbol,
        uri: src,
        sendTransaction: true,
      });
      console.log("deploy jobId:", jobId);
      expect(jobId).toBeDefined();
      if (jobId === undefined) throw new Error("Deploy jobId is undefined");
      const result = await api.waitForJobResult({ jobId, printLogs: true });

      expect(result).toBeDefined();
      if (result === undefined) throw new Error("Deploy result is undefined");
      const resultJSON = JSON.parse(result);
      expect(resultJSON.success).toBe(true);
      const hash = resultJSON.hash;
      expect(hash).toBeDefined();
      if (hash === undefined) throw new Error("Deploy hash is undefined");
      console.log("deploy hash:", hash);
      console.log("waiting for deploy tx to be included...");
      while (!(await getTxStatusFast({ hash })).result === true) {
        await sleep(10000);
      }
      console.log("deploy tx included");
      Memory.info("deployed");
      console.timeEnd("deployed");
      if (chain !== "local") await sleep(10000);
    });
  }

  if (mint) {
    it(`should mint tokens`, async () => {
      console.time("minted");
      await fetchMinaAccount({ publicKey: admin, force: true });
      const tokenContract = new FungibleToken(tokenKey);
      const tokenId = tokenContract.deriveTokenId();
      await fetchMinaAccount({ publicKey: admin, force: true });
      await fetchMinaAccount({ publicKey: adminKey, force: true });
      await fetchMinaAccount({ publicKey: tokenKey, force: true });
      await fetchMinaAccount({
        publicKey: tokenKey,
        tokenId,
        force: true,
      });

      await fetchMinaAccount({
        publicKey: user1,
        tokenId,
        force: true,
      });
      await fetchMinaAccount({
        publicKey: user2,
        tokenId,
        force: true,
      });
      await fetchMinaAccount({
        publicKey: user3,
        tokenId,
        force: true,
      });
      await fetchMinaAccount({
        publicKey: user4,
        tokenId,
        force: true,
      });
      let nonce = Number(Mina.getAccount(admin).nonce.toBigint());
      const toArray: PublicKey[] = [user1, user2];
      const hashArray: string[] = [];
      const amount = UInt64.from(1000e9);
      const memo =
        `mint ${Number(amount.toBigInt()) / 1_000_000_000} ${symbol}`.length >
        30
          ? `mint ${symbol}`.substring(0, 30)
          : `mint ${Number(amount.toBigInt()) / 1_000_000_000} ${symbol}`;
      for (const to of toArray) {
        const tx = await Mina.transaction(
          {
            sender: admin,
            fee: await fee(),
            nonce: nonce++,
            memo,
          },
          async () => {
            if (!Mina.hasAccount(to, tokenId))
              AccountUpdate.fundNewAccount(admin, 1);
            const provingFee = AccountUpdate.createSigned(admin);
            provingFee.send({
              to: wallet,
              amount: UInt64.from(MINT_FEE),
            });
            await tokenContract.mint(to, amount);
          }
        );
        tx.sign([admin.key]);
        const serializedTransaction = serializeTransaction(tx);
        const transaction = tx.toJSON();
        const txJSON = JSON.parse(transaction);
        let signedData = JSON.stringify({ zkappCommand: txJSON });
        const jobId = await api.sendMintTransaction({
          serializedTransaction,
          signedData,
          adminContractPublicKey: adminKey.toBase58(),
          tokenPublicKey: tokenKey.toBase58(),
          adminPublicKey: admin.toBase58(),
          chain,
          symbol,
          amount: Number(amount.toBigInt()),
          to: to.toBase58(),
          sendTransaction: true,
        });
        console.log("mint jobId:", jobId);
        expect(jobId).toBeDefined();
        if (jobId === undefined) throw new Error("Mint jobId is undefined");
        const result = await api.waitForJobResult({ jobId, printLogs: true });

        expect(result).toBeDefined();
        if (result === undefined) throw new Error("Mint result is undefined");
        const resultJSON = JSON.parse(result);
        expect(resultJSON.success).toBe(true);
        const hash = resultJSON.hash;
        expect(hash).toBeDefined();
        if (hash === undefined) throw new Error("Mint hash is undefined");
        console.log("mint hash:", hash);
        hashArray.push(hash);
      }

      for (const hash of hashArray) {
        console.log("Waiting for mint tx to be included...", hash);
        while (!(await getTxStatusFast({ hash })).result === true) {
          await sleep(10000);
        }
        console.log("mint tx included", hash);
      }
      Memory.info("minted");
      console.timeEnd("minted");
      if (chain !== "local") await sleep(10000);
    });
  }

  if (transfer) {
    it(`should transfer tokens`, async () => {
      console.time("transferred");
      await fetchMinaAccount({ publicKey: user1, force: true });
      await fetchMinaAccount({ publicKey: user2, force: true });
      const tokenContract = new FungibleToken(tokenKey);
      const tokenId = tokenContract.deriveTokenId();

      const addresses: { from: TestPublicKey; to: TestPublicKey }[] = [
        { from: user1, to: user3 },
        { from: user2, to: user4 },
      ];
      const hashArray: string[] = [];
      const amount = UInt64.from(10e9);
      const memo =
        `transfer ${Number(amount.toBigInt()) / 1_000_000_000} ${symbol}`
          .length > 30
          ? `transfer ${symbol}`.substring(0, 30)
          : `transfer ${Number(amount.toBigInt()) / 1_000_000_000} ${symbol}`;
      for (const { from, to } of addresses) {
        await fetchMinaAccount({ publicKey: adminKey, force: true });
        await fetchMinaAccount({ publicKey: tokenKey, force: true });
        await fetchMinaAccount({
          publicKey: tokenKey,
          tokenId,
          force: true,
        });
        await fetchMinaAccount({
          publicKey: from,
          force: true,
        });
        await fetchMinaAccount({
          publicKey: from,
          tokenId,
          force: true,
        });
        await fetchMinaAccount({
          publicKey: to,
          tokenId,
          force: false,
        });
        const nonce = Number(Mina.getAccount(from).nonce.toBigint());
        const isNewAccount = Mina.hasAccount(to, tokenId) === false;
        const tx = await Mina.transaction(
          {
            sender: from,
            fee: await fee(),
            nonce,
            memo,
          },
          async () => {
            if (!Mina.hasAccount(to, tokenId))
              AccountUpdate.fundNewAccount(from, 1);
            const provingFee = AccountUpdate.createSigned(from);
            provingFee.send({
              to: wallet,
              amount: UInt64.from(TRANSFER_FEE),
            });
            await tokenContract.transfer(from, to, amount);
          }
        );
        tx.sign([from.key]);
        const serializedTransaction = serializeTransaction(tx);
        const transaction = tx.toJSON();
        const txJSON = JSON.parse(transaction);
        let signedData = JSON.stringify({ zkappCommand: txJSON });
        const jobId = await api.sendTransferTransaction({
          serializedTransaction,
          signedData,
          tokenPublicKey: tokenKey.toBase58(),
          chain,
          symbol,
          amount: Number(amount.toBigInt()),
          from: from.toBase58(),
          to: to.toBase58(),
          sendTransaction: true,
        });
        console.log("transfer jobId:", jobId);
        expect(jobId).toBeDefined();
        if (jobId === undefined) throw new Error("Transfer jobId is undefined");
        const result = await api.waitForJobResult({ jobId, printLogs: true });

        expect(result).toBeDefined();
        if (result === undefined)
          throw new Error("Transfer result is undefined");
        const resultJSON = JSON.parse(result);
        expect(resultJSON.success).toBe(true);
        const hash = resultJSON.hash;
        expect(hash).toBeDefined();
        if (hash === undefined) throw new Error("Transfer hash is undefined");
        console.log("transfer hash:", hash);
        hashArray.push(hash);
      }

      for (const hash of hashArray) {
        console.log("Waiting for transfer tx to be included...", hash);
        while (!(await getTxStatusFast({ hash })).result === true) {
          await sleep(10000);
        }
        console.log("transfer tx included", hash);
      }
      Memory.info("transferred");
      console.timeEnd("transferred");
      if (chain !== "local") await sleep(10000);
    });
  }
});
