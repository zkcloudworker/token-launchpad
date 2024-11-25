import { describe, expect, it } from "@jest/globals";
import {
  Mina,
  AccountUpdate,
  UInt64,
  Cache,
  PublicKey,
  setNumberOfWorkers,
  UInt8,
  TokenId,
} from "o1js";
import {
  TokenAPI,
  sleep,
  Memory,
  fetchMinaAccount,
  fee,
  initBlockchain,
  accountBalanceMina,
  // FungibleToken,
  // FungibleTokenAdmin,
  serializeTransaction,
} from "zkcloudworker";
import { FungibleTokenContract } from "../src/FungibleTokenContract.js";
import { FungibleTokenWhitelistedAdmin } from "../src/FungibleTokenWhitelistedAdmin.js";
import { FungibleTokenAdmin } from "../src/FungibleTokenAdmin.js";
import {
  buildTokenDeployTransaction,
  buildTokenTransaction,
} from "../src/build.js";
import { LAUNCH_FEE, TRANSACTION_FEE } from "../src/fee.js";
import { zkcloudworker } from "../index.js";
// import { JWT } from "../env.json";
const JWT: string = process.env.JWT!;
import {
  testKeys as devnetKeys,
  tokenContractKey,
  adminContractKey,
  wallet,
} from "./helpers/config.js";
import { processArguments, sendTx, getTxStatusFast } from "./helpers/utils.js";
import { FungibleTokenOfferContract } from "../src/offer.js";

const { TestPublicKey } = Mina;
type TestPublicKey = Mina.TestPublicKey;

setNumberOfWorkers(8);

const args = processArguments();
console.log("args:", args);
const {
  chain,
  compile,
  deploy,
  mint,
  transfer,
  buy,
  sell,
  withdrawBid,
  withdrawOffer,
  useRandomTokenAddress,
  useLocalCloudWorker,
} = args;

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
  let buyer: TestPublicKey;
  let bidder: TestPublicKey;

  let tokenKey = useRandomTokenAddress
    ? TestPublicKey.random()
    : tokenContractKey;
  let adminKey = useRandomTokenAddress
    ? TestPublicKey.random()
    : adminContractKey;
  const tokenId = TokenId.derive(tokenKey);
  const FungibleToken = FungibleTokenContract(FungibleTokenAdmin);

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
    expect(keys.length).toBeGreaterThanOrEqual(8);
    if (keys.length < 6) throw new Error("Invalid keys");
    let topup: TestPublicKey;
    [admin, user1, user2, user3, user4, topup, bidder, buyer] = keys;
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
    console.log("bidder balance:", await accountBalanceMina(bidder));
    console.log("buyer balance:", await accountBalanceMina(buyer));
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
        {
          name: "FungibleTokenOffer",
          result: await FungibleTokenOfferContract.analyzeMethods(),
          skip: false,
        },
      ];
      console.timeEnd("methods analyzed");
      const maxRows = 2 ** 16;
      for (const contract of methods) {
        // calculate the size of the contract - the sum or rows for each method
        const size = Object.values(contract.result).reduce(
          (acc, method) => acc + (method as any).rows,
          0
        ) as number;
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
      console.time("FungibleTokenOffer compiled");
      const offerVerificationKey = (
        await FungibleTokenOfferContract.compile({
          cache,
        })
      ).verificationKey;
      console.timeEnd("FungibleTokenOffer compiled");
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
        console.log("offer:", {
          hash: offerVerificationKey.hash.toJSON(),
          //data: offerVerificationKey.data,
        });
      }
    });
  }

  if (deploy) {
    it(`should deploy contract`, async () => {
      console.log("deploying contract");
      console.time("deployed");

      const tx = await buildTokenDeployTransaction({
        chain,
        fee: await fee(),
        sender: admin,
        nonce: Number(Mina.getAccount(admin).nonce.toBigint()),
        memo: `deploy token ${symbol}`.substring(0, 30),
        adminContractAddress: adminKey,
        adminAddress: admin,
        tokenAddress: tokenKey,
        uri: src,
        symbol,
        provingKey: wallet,
        provingFee: UInt64.from(LAUNCH_FEE),
        decimals: UInt8.from(9),
      });

      tx.sign([admin.key, adminKey.key, tokenKey.key]);
      const serializedTransaction = serializeTransaction(tx);
      const transaction = tx.toJSON();
      const txJSON = JSON.parse(transaction);
      let signedData = JSON.stringify({ zkappCommand: txJSON });
      console.log("sending deploy transaction");
      const jobId = await api.sendDeployTransaction({
        txType: "deploy",
        serializedTransaction,
        signedData,
        adminContractAddress: adminKey.toBase58(),
        tokenAddress: tokenKey.toBase58(),
        senderAddress: admin.toBase58(),
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
      let nonce = Number(Mina.getAccount(admin).nonce.toBigint());
      const toArray: PublicKey[] = [user1]; //, user2
      const hashArray: string[] = [];
      const amount = UInt64.from(1000e9);
      const memo =
        `mint ${Number(amount.toBigInt()) / 1_000_000_000} ${symbol}`.length >
        30
          ? `mint ${symbol}`.substring(0, 30)
          : `mint ${Number(amount.toBigInt()) / 1_000_000_000} ${symbol}`;
      for (const to of toArray) {
        const tx = await buildTokenTransaction({
          txType: "mint",
          chain,
          fee: await fee(),
          sender: admin,
          nonce: nonce++,
          memo,
          tokenAddress: tokenKey,
          from: admin,
          to,
          amount,
          provingKey: wallet,
          provingFee: UInt64.from(TRANSACTION_FEE),
        });

        tx.sign([admin.key]);

        const serializedTransaction = serializeTransaction(tx);
        const transaction = tx.toJSON();
        const txJSON = JSON.parse(transaction);
        let signedData = JSON.stringify({ zkappCommand: txJSON });

        const jobId = await api.sendTransaction({
          txType: "mint",
          serializedTransaction,
          signedData,
          tokenAddress: tokenKey.toBase58(),
          from: admin.toBase58(),
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

  if (buy) {
    let offers: {
      contract: TestPublicKey;
      sellAmount: UInt64;
      boughtAmount: UInt64;
      withdrawAmount: UInt64;
      price: UInt64;
      buyer: TestPublicKey;
      seller: TestPublicKey;
    }[] = [];

    it(`should offer tokens`, async () => {
      console.time("offered");
      const hashArray: string[] = [];
      const offerPrice = UInt64.from(2e8);
      const offeredAmount = UInt64.from(200e9);
      const boughtAmount = UInt64.from(50e9);
      const withdrawAmount = UInt64.from(150e9);
      offers = [
        {
          contract: TestPublicKey.random(),
          sellAmount: offeredAmount,
          boughtAmount,
          withdrawAmount,
          price: offerPrice,
          buyer,
          seller: user1,
        },
      ];
      const offerMemo =
        `offer ${Number(offeredAmount.toBigInt()) / 1_000_000_000} ${symbol}`
          .length > 30
          ? `offer ${symbol}`.substring(0, 30)
          : `offer ${
              Number(offeredAmount.toBigInt()) / 1_000_000_000
            } ${symbol}`;

      for (const { seller, contract, sellAmount, price } of offers) {
        for (const { seller, contract } of offers) {
          await fetchMinaAccount({
            publicKey: seller,
            tokenId,
            force: true,
          });
          const balanceSeller = Mina.hasAccount(seller, tokenId)
            ? Mina.getAccount(seller, tokenId).balance
            : undefined;

          expect(balanceSeller).toBeDefined();
          if (balanceSeller === undefined)
            throw new Error(`Seller account ${seller.toBase58()} is undefined`);
          console.log(
            "seller balance:",
            seller.toBase58(),
            balanceSeller.toBigInt() / 1_000_000_000n
          );
          await fetchMinaAccount({
            publicKey: contract,
            tokenId,
            force: false,
          });
          const balanceOffer = Mina.hasAccount(contract, tokenId)
            ? Mina.getAccount(contract, tokenId).balance
            : undefined;
          console.log(
            "offer balance:",
            contract.toBase58(),
            balanceOffer ? balanceOffer.toBigInt() / 1_000_000_000n : undefined
          );
        }
        await fetchMinaAccount({ publicKey: seller, force: true });
        const nonce = Number(Mina.getAccount(seller).nonce.toBigint());
        console.log(
          "Building offer transaction for contract:",
          contract.toBase58()
        );
        const tx = await buildTokenTransaction({
          txType: "offer",
          chain,
          fee: await fee(),
          sender: seller,
          nonce,
          memo: offerMemo,
          tokenAddress: tokenKey,
          from: seller,
          to: contract,
          amount: sellAmount,
          price: offerPrice,
          provingKey: wallet,
          provingFee: UInt64.from(TRANSACTION_FEE),
        });

        tx.sign([seller.key, contract.key]);
        const transaction = tx.toJSON();
        const txJSON = JSON.parse(transaction);

        const serializedTransaction = serializeTransaction(tx);
        let signedData = JSON.stringify({ zkappCommand: txJSON });

        const jobId = await api.sendTransaction({
          txType: "offer",
          serializedTransaction,
          signedData,
          tokenAddress: tokenKey.toBase58(),
          chain,
          symbol,
          amount: Number(sellAmount.toBigInt()),
          from: seller.toBase58(),
          to: contract.toBase58(),
          sendTransaction: true,
          price: Number(price.toBigInt()),
        });
        console.log("offer jobId:", jobId);
        expect(jobId).toBeDefined();
        if (jobId === undefined) throw new Error("Offer jobId is undefined");
        const result = await api.waitForJobResult({ jobId, printLogs: true });

        expect(result).toBeDefined();
        if (result === undefined) throw new Error("Offer result is undefined");
        const resultJSON = JSON.parse(result);
        expect(resultJSON.success).toBe(true);
        const hash = resultJSON.hash;
        expect(hash).toBeDefined();
        if (hash === undefined) throw new Error("Offer hash is undefined");
        console.log("offer hash:", hash);
        hashArray.push(hash);
      }

      for (const hash of hashArray) {
        console.log("Waiting for offer tx to be included...", hash);
        while (!(await getTxStatusFast({ hash })).result === true) {
          await sleep(10000);
        }
        console.log("offer tx included", hash);
      }
      for (const { seller, contract } of offers) {
        await fetchMinaAccount({
          publicKey: seller,
          tokenId,
          force: true,
        });
        const balanceSeller = Mina.hasAccount(seller, tokenId)
          ? Mina.getAccount(seller, tokenId).balance
          : undefined;
        expect(balanceSeller).toBeDefined();
        if (balanceSeller === undefined)
          throw new Error(`Seller account ${seller.toBase58()} is undefined`);
        console.log(
          "seller balance:",
          seller.toBase58(),
          balanceSeller.toBigInt() / 1_000_000_000n
        );
        await fetchMinaAccount({
          publicKey: contract,
          tokenId,
          force: true,
        });
        const balanceOffer = Mina.hasAccount(contract, tokenId)
          ? Mina.getAccount(contract, tokenId).balance
          : undefined;
        expect(balanceOffer).toBeDefined();
        if (balanceOffer === undefined)
          throw new Error(`Offer account ${contract.toBase58()} is undefined`);
        console.log(
          "offer balance:",
          contract.toBase58(),
          balanceOffer.toBigInt() / 1_000_000_000n
        );
      }
      Memory.info("offered");
      console.timeEnd("offered");
      if (chain !== "local") await sleep(10000);
    });

    it(`should buy tokens`, async () => {
      console.time("bought");
      const hashArray: string[] = [];

      for (const { contract, boughtAmount, price, buyer } of offers) {
        await fetchMinaAccount({
          publicKey: buyer,
          tokenId,
          force: false,
        });
        const balanceBuyer = Mina.hasAccount(buyer, tokenId)
          ? Mina.getAccount(buyer, tokenId).balance
          : undefined;
        console.log(
          "buyer balance:",
          buyer.toBase58(),
          balanceBuyer ? balanceBuyer.toBigInt() / 1_000_000_000n : undefined
        );
        await fetchMinaAccount({
          publicKey: contract,
          tokenId,
          force: true,
        });
        const balanceOffer = Mina.hasAccount(contract, tokenId)
          ? Mina.getAccount(contract, tokenId).balance
          : undefined;
        expect(balanceOffer).toBeDefined();
        if (balanceOffer === undefined)
          throw new Error(`Offer account ${contract.toBase58()} is undefined`);
        console.log(
          "offer balance:",
          contract.toBase58(),
          balanceOffer.toBigInt() / 1_000_000_000n
        );

        const boughtMemo =
          `buy ${Number(boughtAmount.toBigInt()) / 1_000_000_000} ${symbol}`
            .length > 30
            ? `buy ${symbol}`.substring(0, 30)
            : `buy ${
                Number(boughtAmount.toBigInt()) / 1_000_000_000
              } ${symbol}`;
        await fetchMinaAccount({ publicKey: buyer, force: true });
        const nonce = Number(Mina.getAccount(buyer).nonce.toBigint());
        console.log("Building buy transaction:", contract.toBase58());
        console.log("buyer:", buyer.toBase58());
        const tx = await buildTokenTransaction({
          txType: "buy",
          chain,
          fee: await fee(),
          sender: buyer,
          nonce,
          memo: boughtMemo,
          tokenAddress: tokenKey,
          from: contract,
          to: buyer,
          amount: boughtAmount,
          price,
          provingKey: wallet,
          provingFee: UInt64.from(TRANSACTION_FEE),
        });

        tx.sign([buyer.key]);
        const transaction = tx.toJSON();
        const txJSON = JSON.parse(transaction);

        const serializedTransaction = serializeTransaction(tx);
        let signedData = JSON.stringify({ zkappCommand: txJSON });

        const jobId = await api.sendTransaction({
          txType: "buy",
          serializedTransaction,
          signedData,
          tokenAddress: tokenKey.toBase58(),
          chain,
          symbol,
          amount: Number(boughtAmount.toBigInt()),
          from: contract.toBase58(),
          to: buyer.toBase58(),
          sendTransaction: true,
          price: Number(price.toBigInt()),
        });
        console.log("buy jobId:", jobId);
        expect(jobId).toBeDefined();
        if (jobId === undefined) throw new Error("Buy jobId is undefined");
        const result = await api.waitForJobResult({ jobId, printLogs: true });

        expect(result).toBeDefined();
        if (result === undefined) throw new Error("Buy result is undefined");
        const resultJSON = JSON.parse(result);
        expect(resultJSON.success).toBe(true);
        const hash = resultJSON.hash;
        expect(hash).toBeDefined();
        if (hash === undefined) throw new Error("Buy hash is undefined");
        console.log("buy hash:", hash);
        hashArray.push(hash);
      }

      for (const hash of hashArray) {
        console.log("Waiting for buy tx to be included...", hash);
        while (!(await getTxStatusFast({ hash })).result === true) {
          await sleep(10000);
        }
        console.log("buy tx included", hash);
      }
      for (const { buyer, contract } of offers) {
        await fetchMinaAccount({
          publicKey: buyer,
          tokenId,
          force: true,
        });
        const balanceBuyer = Mina.hasAccount(buyer, tokenId)
          ? Mina.getAccount(buyer, tokenId).balance
          : undefined;
        expect(balanceBuyer).toBeDefined();
        if (balanceBuyer === undefined)
          throw new Error(`Buyer account ${buyer.toBase58()} is undefined`);
        console.log(
          "buyer balance:",
          buyer.toBase58(),
          balanceBuyer.toBigInt() / 1_000_000_000n
        );
        await fetchMinaAccount({
          publicKey: contract,
          tokenId,
          force: true,
        });
        const balanceOffer = Mina.hasAccount(contract, tokenId)
          ? Mina.getAccount(contract, tokenId).balance
          : undefined;
        expect(balanceOffer).toBeDefined();
        if (balanceOffer === undefined)
          throw new Error(`Offer account ${contract.toBase58()} is undefined`);
        console.log(
          "offer balance:",
          contract.toBase58(),
          balanceOffer.toBigInt() / 1_000_000_000n
        );
      }
      Memory.info("bought");
      console.timeEnd("bought");
      if (chain !== "local") await sleep(10000);
    });

    it(`should withdraw tokens`, async () => {
      console.time("withdrawn");
      const hashArray: string[] = [];

      for (const { contract, withdrawAmount, seller } of offers) {
        await fetchMinaAccount({
          publicKey: seller,
          tokenId,
          force: false,
        });
        const balanceSeller = Mina.hasAccount(seller, tokenId)
          ? Mina.getAccount(seller, tokenId).balance
          : undefined;
        console.log(
          "seller balance:",
          seller.toBase58(),
          balanceSeller ? balanceSeller.toBigInt() / 1_000_000_000n : undefined
        );
        await fetchMinaAccount({
          publicKey: contract,
          tokenId,
          force: true,
        });
        const balanceOffer = Mina.hasAccount(contract, tokenId)
          ? Mina.getAccount(contract, tokenId).balance
          : undefined;
        expect(balanceOffer).toBeDefined();
        if (balanceOffer === undefined)
          throw new Error(`Offer account ${contract.toBase58()} is undefined`);
        console.log(
          "offer balance:",
          contract.toBase58(),
          balanceOffer.toBigInt() / 1_000_000_000n
        );

        const withdrawMemo =
          `withdraw ${
            Number(withdrawAmount.toBigInt()) / 1_000_000_000
          } ${symbol}`.length > 30
            ? `buy ${symbol}`.substring(0, 30)
            : `withdraw ${
                Number(withdrawAmount.toBigInt()) / 1_000_000_000
              } ${symbol}`;
        await fetchMinaAccount({ publicKey: seller, force: true });
        const nonce = Number(Mina.getAccount(seller).nonce.toBigint());
        console.log("Building withdraw transaction:", contract.toBase58());
        console.log("seller:", seller.toBase58());
        const tx = await buildTokenTransaction({
          txType: "withdrawOffer",
          chain,
          fee: await fee(),
          sender: seller,
          nonce,
          memo: withdrawMemo,
          tokenAddress: tokenKey,
          from: contract,
          to: seller,
          amount: withdrawAmount,
          provingKey: wallet,
          provingFee: UInt64.from(TRANSACTION_FEE),
        });

        tx.sign([seller.key]);
        const transaction = tx.toJSON();
        const txJSON = JSON.parse(transaction);

        const serializedTransaction = serializeTransaction(tx);
        let signedData = JSON.stringify({ zkappCommand: txJSON });

        const jobId = await api.sendTransaction({
          txType: "withdrawOffer",
          serializedTransaction,
          signedData,
          tokenAddress: tokenKey.toBase58(),
          chain,
          symbol,
          amount: Number(withdrawAmount.toBigInt()),
          from: contract.toBase58(),
          to: seller.toBase58(),
          sendTransaction: true,
        });
        console.log("withdraw jobId:", jobId);
        expect(jobId).toBeDefined();
        if (jobId === undefined) throw new Error("Withdraw jobId is undefined");
        const result = await api.waitForJobResult({ jobId, printLogs: true });

        expect(result).toBeDefined();
        if (result === undefined)
          throw new Error("Withdraw result is undefined");
        const resultJSON = JSON.parse(result);
        expect(resultJSON.success).toBe(true);
        const hash = resultJSON.hash;
        expect(hash).toBeDefined();
        if (hash === undefined) throw new Error("Withdraw hash is undefined");
        console.log("withdraw hash:", hash);
        hashArray.push(hash);
      }

      for (const hash of hashArray) {
        console.log("Waiting for withdraw tx to be included...", hash);
        while (!(await getTxStatusFast({ hash })).result === true) {
          await sleep(10000);
        }
        console.log("withdraw tx included", hash);
      }
      for (const { seller, contract } of offers) {
        await fetchMinaAccount({
          publicKey: seller,
          tokenId,
          force: true,
        });
        const balanceSeller = Mina.hasAccount(seller, tokenId)
          ? Mina.getAccount(seller, tokenId).balance
          : undefined;
        expect(balanceSeller).toBeDefined();
        if (balanceSeller === undefined)
          throw new Error(`Seller account ${seller.toBase58()} is undefined`);
        console.log(
          "seller balance:",
          seller.toBase58(),
          balanceSeller.toBigInt() / 1_000_000_000n
        );
        await fetchMinaAccount({
          publicKey: contract,
          tokenId,
          force: true,
        });
        const balanceOffer = Mina.hasAccount(contract, tokenId)
          ? Mina.getAccount(contract, tokenId).balance
          : undefined;
        expect(balanceOffer).toBeDefined();
        if (balanceOffer === undefined)
          throw new Error(`Offer account ${contract.toBase58()} is undefined`);
        console.log(
          "offer balance:",
          contract.toBase58(),
          balanceOffer.toBigInt() / 1_000_000_000n
        );
      }
      Memory.info("withdrawn");
      console.timeEnd("withdrawn");
      if (chain !== "local") await sleep(10000);
    });
  }

  if (transfer) {
    it(`should transfer tokens`, async () => {
      console.time("transferred");

      const addresses: { from: TestPublicKey; to: TestPublicKey }[] = [
        { from: user1, to: user3 },
        // { from: user2, to: user4 },
      ];
      const hashArray: string[] = [];
      const amount = UInt64.from(10e9);
      const memo =
        `transfer ${Number(amount.toBigInt()) / 1_000_000_000} ${symbol}`
          .length > 30
          ? `transfer ${symbol}`.substring(0, 30)
          : `transfer ${Number(amount.toBigInt()) / 1_000_000_000} ${symbol}`;
      for (const { from, to } of addresses) {
        await fetchMinaAccount({ publicKey: from, force: true });
        const nonce = Number(Mina.getAccount(from).nonce.toBigint());
        console.log("Building transfer transaction...");
        const tx = await buildTokenTransaction({
          txType: "transfer",
          chain,
          fee: await fee(),
          sender: from,
          nonce,
          memo,
          tokenAddress: tokenKey,
          from,
          to,
          amount,
          provingKey: wallet,
          provingFee: UInt64.from(TRANSACTION_FEE),
        });

        tx.sign([from.key]);
        const serializedTransaction = serializeTransaction(tx);
        const transaction = tx.toJSON();
        const txJSON = JSON.parse(transaction);
        let signedData = JSON.stringify({ zkappCommand: txJSON });
        const jobId = await api.sendTransaction({
          txType: "transfer",
          serializedTransaction,
          signedData,
          tokenAddress: tokenKey.toBase58(),
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
