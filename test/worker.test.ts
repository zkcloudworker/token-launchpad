import { describe, it } from "node:test";
import assert from "node:assert";
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
  serializeTransaction,
  tokenBalance,
  FungibleToken,
  WhitelistedFungibleToken,
  FungibleTokenAdmin,
  FungibleTokenWhitelistedAdmin,
  FungibleTokenOfferContract,
  FungibleTokenBidContract,
  tokenVerificationKeys,
  buildTokenDeployTransaction,
  buildTokenTransaction,
  LAUNCH_FEE,
  TRANSACTION_FEE,
  getTxStatusFast,
  sendTx,
} from "zkcloudworker";
import { zkcloudworker } from "../index.js";
const JWT: string = process.env.JWT!;
import {
  testKeys as devnetKeys,
  tokenContractKey,
  adminContractKey,
  wallet,
} from "./helpers/config.js";
import { processArguments } from "./helpers/utils.js";

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
  whitelistAdmin,
  whitelistOffer,
  whitelistBid,
  updateWhitelistAdmin,
  updateWhitelistOffer,
  updateWhitelistBid,
} = args;

const api = new TokenAPI({
  jwt: useLocalCloudWorker ? "local" : JWT,
  zkcloudworker,
  chain,
});

let accounts: {
  name: string;
  publicKey: PublicKey;
  balance?: number;
  tokenBalance?: number;
}[] = [];

let tokenKey = useRandomTokenAddress
  ? TestPublicKey.random()
  : tokenContractKey;
let adminKey = useRandomTokenAddress
  ? TestPublicKey.random()
  : adminContractKey;
const tokenId = TokenId.derive(tokenKey);

describe("Token Launchpad Worker", async () => {
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
  const offer = TestPublicKey.random();
  const bid = TestPublicKey.random();

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
    assert(keys.length >= 8, "Invalid keys");
    let topup: TestPublicKey;
    [admin, user1, user2, user3, user4, topup, bidder, buyer] = keys;
    accounts = [
      { name: "admin", publicKey: admin },
      { name: "user1", publicKey: user1 },
      { name: "user2", publicKey: user2 },
      { name: "user3", publicKey: user3 },
      { name: "user4", publicKey: user4 },
      { name: "buyer", publicKey: buyer },
      { name: "bidder", publicKey: bidder },
      { name: "offer", publicKey: offer },
      { name: "bid", publicKey: bid },
      { name: "wallet", publicKey: wallet },
    ];
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
      await sendTx({ tx: topupTx, description: "topup" });
    }

    console.log("contract address:", tokenKey.toBase58());
    console.log("admin:", admin.toBase58());
    await printBalances();
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

      const { tx } = await buildTokenDeployTransaction({
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
      assert(jobId !== undefined, "Deploy jobId is undefined");
      const result = await api.waitForJobResult({ jobId, printLogs: true });

      assert(result !== undefined, "Deploy result is undefined");
      const resultJSON = JSON.parse(result);
      assert(resultJSON.success, "Deploy result is not success");
      const hash = resultJSON.hash;
      assert(hash !== undefined, "Deploy hash is undefined");
      console.log("deploy hash:", hash);
      console.time("deploy tx included");
      console.log("waiting for deploy tx to be included...");
      const txStatus = await getTxStatusFast({ hash });
      console.log("txStatus deploy", txStatus);
      while (!(await getTxStatusFast({ hash })).result === true) {
        await sleep(10000);
      }
      console.timeEnd("deploy tx included");
      Memory.info("deployed");
      console.timeEnd("deployed");
      const txStatus2 = await getTxStatusFast({ hash });
      console.log("txStatus deploy post", txStatus2);
      if (chain !== "local") await sleep(30000);
      await printBalances();
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
        const { tx } = await buildTokenTransaction({
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
        assert(jobId !== undefined, "Mint jobId is undefined");
        const result = await api.waitForJobResult({ jobId, printLogs: true });

        assert(result !== undefined, "Mint result is undefined");
        const resultJSON = JSON.parse(result);
        assert(resultJSON.success, "Mint result is not success");
        const hash = resultJSON.hash;
        assert(hash !== undefined, "Mint hash is undefined");
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
      await printBalances();
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
          contract: offer,
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

          assert(
            balanceSeller !== undefined,
            `Seller account ${seller.toBase58()} is undefined`
          );
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
        const { tx } = await buildTokenTransaction({
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
        assert(jobId !== undefined, "Offer jobId is undefined");
        const result = await api.waitForJobResult({ jobId, printLogs: true });

        assert(result !== undefined, "Offer result is undefined");
        const resultJSON = JSON.parse(result);
        assert(resultJSON.success, "Offer result is not success");
        const hash = resultJSON.hash;
        assert(hash !== undefined, "Offer hash is undefined");
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
      await printBalances();

      Memory.info("offered");
      console.timeEnd("offered");
      if (chain !== "local") await sleep(10000);
    });

    it(`should buy tokens`, async () => {
      console.time("bought");
      const hashArray: string[] = [];

      for (const { contract, boughtAmount, price, buyer } of offers) {
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
        const { tx } = await buildTokenTransaction({
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
        assert(jobId !== undefined, "Buy jobId is undefined");
        const result = await api.waitForJobResult({ jobId, printLogs: true });

        assert(result !== undefined, "Buy result is undefined");
        const resultJSON = JSON.parse(result);
        assert(resultJSON.success, "Buy result is not success");
        const hash = resultJSON.hash;
        assert(hash !== undefined, "Buy hash is undefined");
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

      Memory.info("bought");
      console.timeEnd("bought");
      if (chain !== "local") await sleep(10000);
      await printBalances();
    });

    it(`should withdraw tokens`, async () => {
      console.time("withdrawn");
      const hashArray: string[] = [];

      for (const { contract, withdrawAmount, seller } of offers) {
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
        const { tx } = await buildTokenTransaction({
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
        assert(jobId !== undefined, "Withdraw jobId is undefined");
        const result = await api.waitForJobResult({ jobId, printLogs: true });

        assert(result !== undefined, "Withdraw result is undefined");
        const resultJSON = JSON.parse(result);
        assert(resultJSON.success, "Withdraw result is not success");
        const hash = resultJSON.hash;
        assert(hash !== undefined, "Withdraw hash is undefined");
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

      Memory.info("withdrawn");
      console.timeEnd("withdrawn");
      if (chain !== "local") await sleep(10000);
      await printBalances();
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
        const { tx } = await buildTokenTransaction({
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
        assert(jobId !== undefined, "Transfer jobId is undefined");
        const result = await api.waitForJobResult({ jobId, printLogs: true });

        assert(result !== undefined, "Transfer result is undefined");
        const resultJSON = JSON.parse(result);
        assert(resultJSON.success, "Transfer result is not success");
        const hash = resultJSON.hash;
        assert(hash !== undefined, "Transfer hash is undefined");
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
      await printBalances();
    });
  }
});

async function printBalances() {
  console.log("Balances:");
  for (const account of accounts) {
    await fetchMinaAccount({
      publicKey: account.publicKey,
      force: account.balance !== undefined,
    });
    await fetchMinaAccount({
      publicKey: account.publicKey,
      tokenId,
      force: account.tokenBalance !== undefined,
    });
    const balance = await accountBalanceMina(account.publicKey);
    const tb = await tokenBalance(account.publicKey, tokenId);
    if (account.balance !== balance || account.tokenBalance !== tb) {
      const balanceDiff =
        account.balance !== undefined ? balance - account.balance : balance;
      const tokenBalanceDiff =
        tb !== undefined
          ? account.tokenBalance
            ? tb - account.tokenBalance
            : tb
          : 0;
      console.log(
        `${account.name}: ${balance} MINA ${
          account.balance
            ? "(" + (balanceDiff >= 0 ? "+" : "") + balanceDiff.toString() + ")"
            : ""
        }, ${tb ? tb / 1_000_000_000 : 0} TEST ${
          account.tokenBalance
            ? "(" +
              (tokenBalanceDiff >= 0 ? "+" : "") +
              (tokenBalanceDiff / 1_000_000_000).toString() +
              ")"
            : ""
        }`
      );
      account.balance = balance;
      account.tokenBalance = tb;
    }
  }
}
