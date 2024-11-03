"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const o1js_1 = require("o1js");
const zkcloudworker_1 = require("zkcloudworker");
const __1 = require("..");
const env_json_1 = require("../env.json");
const config_1 = require("./config");
const utils_1 = require("./utils");
const { TestPublicKey } = o1js_1.Mina;
(0, o1js_1.setNumberOfWorkers)(8);
const { chain, compile, deploy, mint, transfer, useRandomTokenAddress, useLocalCloudWorker, } = (0, utils_1.processArguments)();
const api = new zkcloudworker_1.TokenAPI({
    jwt: useLocalCloudWorker ? "local" : env_json_1.JWT,
    zkcloudworker: __1.zkcloudworker,
    chain,
});
(0, globals_1.describe)("Token Launchpad Worker", () => {
    const symbol = "TEST";
    const name = "Test Token";
    const src = "https://minatokens.com";
    let keys;
    let admin;
    let user1;
    let user2;
    let user3;
    let user4;
    let tokenKey = useRandomTokenAddress
        ? TestPublicKey.random()
        : config_1.tokenContractKey;
    let adminKey = useRandomTokenAddress
        ? TestPublicKey.random()
        : config_1.adminContractKey;
    const MINT_FEE = 1e8;
    const ISSUE_FEE = 1e9;
    const TRANSFER_FEE = 1e8;
    (0, globals_1.it)(`should initialize blockchain`, async () => {
        zkcloudworker_1.Memory.info("initializing blockchain");
        if (chain === "local" || chain === "lightnet") {
            console.log("local chain:", chain);
            keys = (await (0, zkcloudworker_1.initBlockchain)(chain, 10)).keys;
        }
        else {
            console.log("non-local chain:", chain);
            await (0, zkcloudworker_1.initBlockchain)(chain);
            keys = config_1.testKeys;
        }
        (0, globals_1.expect)(keys.length).toBeGreaterThanOrEqual(6);
        if (keys.length < 6)
            throw new Error("Invalid keys");
        let topup;
        [admin, user1, user2, user3, user4, topup] = keys;
        await (0, zkcloudworker_1.fetchMinaAccount)({ publicKey: config_1.wallet, force: false });
        if (!o1js_1.Mina.hasAccount(config_1.wallet)) {
            const topupTx = await o1js_1.Mina.transaction({
                sender: topup,
                fee: await (0, zkcloudworker_1.fee)(),
                memo: "topup",
            }, async () => {
                const senderUpdate = o1js_1.AccountUpdate.createSigned(topup);
                senderUpdate.balance.subInPlace(1000000000);
                senderUpdate.send({ to: config_1.wallet, amount: 1_000_000_000 });
            });
            topupTx.sign([topup.key]);
            await (0, utils_1.sendTx)(topupTx, "topup");
        }
        console.log("contract address:", tokenKey.toBase58());
        console.log("admin:", admin.toBase58());
        console.log("admin balance:", await (0, zkcloudworker_1.accountBalanceMina)(admin));
        console.log("user1 balance:", await (0, zkcloudworker_1.accountBalanceMina)(user1));
        console.log("user2 balance:", await (0, zkcloudworker_1.accountBalanceMina)(user2));
        console.log("user3 balance:", await (0, zkcloudworker_1.accountBalanceMina)(user3));
        console.log("user4 balance:", await (0, zkcloudworker_1.accountBalanceMina)(user4));
        console.log("wallet balance:", await (0, zkcloudworker_1.accountBalanceMina)(config_1.wallet));
    });
    if (compile) {
        (0, globals_1.it)(`should compile contract`, async () => {
            console.log("Analyzing contracts methods...");
            console.time("methods analyzed");
            const methods = [
                {
                    name: "FungibleToken",
                    result: await zkcloudworker_1.FungibleToken.analyzeMethods(),
                    skip: false,
                },
                {
                    name: "FungibleTokenAdmin",
                    result: await zkcloudworker_1.FungibleTokenAdmin.analyzeMethods(),
                    skip: false,
                },
            ];
            console.timeEnd("methods analyzed");
            const maxRows = 2 ** 16;
            for (const contract of methods) {
                // calculate the size of the contract - the sum or rows for each method
                const size = Object.values(contract.result).reduce((acc, method) => acc + method.rows, 0);
                // calculate percentage rounded to 0 decimal places
                const percentage = Math.round(((size * 100) / maxRows) * 100) / 100;
                console.log(`method's total size for a ${contract.name} is ${size} rows (${percentage}% of max ${maxRows} rows)`);
                if (contract.skip !== true)
                    for (const method in contract.result) {
                        console.log(method, `rows:`, contract.result[method].rows);
                    }
            }
            console.time("compiled");
            console.log("Compiling contracts...");
            const cache = o1js_1.Cache.FileSystem("./cache");
            console.time("FungibleTokenAdmin compiled");
            const adminVerificationKey = (await zkcloudworker_1.FungibleTokenAdmin.compile({ cache }))
                .verificationKey;
            console.timeEnd("FungibleTokenAdmin compiled");
            console.time("FungibleToken compiled");
            const tokenVerificationKey = (await zkcloudworker_1.FungibleToken.compile({ cache }))
                .verificationKey;
            console.timeEnd("FungibleToken compiled");
            console.timeEnd("compiled");
            zkcloudworker_1.Memory.info("compiled");
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
        (0, globals_1.it)(`should deploy contract`, async () => {
            console.log("deploying contract");
            console.time("deployed");
            const vk = zkcloudworker_1.fungibleTokenVerificationKeys[chain === "mainnet" ? "mainnet" : "testnet"];
            zkcloudworker_1.FungibleTokenAdmin._verificationKey = {
                hash: (0, o1js_1.Field)(vk.admin.hash),
                data: vk.admin.data,
            };
            zkcloudworker_1.FungibleToken._verificationKey = {
                hash: (0, o1js_1.Field)(vk.token.hash),
                data: vk.token.data,
            };
            await (0, zkcloudworker_1.fetchMinaAccount)({ publicKey: admin, force: true });
            const adminContract = new zkcloudworker_1.FungibleTokenAdmin(adminKey);
            const tokenContract = new zkcloudworker_1.FungibleToken(tokenKey);
            const nonce = Number(o1js_1.Mina.getAccount(admin).nonce.toBigint());
            const memo = `deploy token ${symbol}`.substring(0, 30);
            const tx = await o1js_1.Mina.transaction({ sender: admin, fee: await (0, zkcloudworker_1.fee)(), memo, nonce }, async () => {
                o1js_1.AccountUpdate.fundNewAccount(admin, 3);
                const provingFee = o1js_1.AccountUpdate.createSigned(admin);
                provingFee.send({
                    to: config_1.wallet,
                    amount: o1js_1.UInt64.from(ISSUE_FEE),
                });
                await adminContract.deploy({ adminPublicKey: admin });
                adminContract.account.zkappUri.set(src);
                await tokenContract.deploy({
                    symbol,
                    src,
                });
                await tokenContract.initialize(adminKey, o1js_1.UInt8.from(9), // TODO: set decimals
                // We can set `startPaused` to `Bool(false)` here, because we are doing an atomic deployment
                // If you are not deploying the admin and token contracts in the same transaction,
                // it is safer to start the tokens paused, and resume them only after verifying that
                // the admin contract has been deployed
                (0, o1js_1.Bool)(false));
            });
            tx.sign([admin.key, adminKey.key, tokenKey.key]);
            const serializedTransaction = (0, zkcloudworker_1.serializeTransaction)(tx);
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
            (0, globals_1.expect)(jobId).toBeDefined();
            if (jobId === undefined)
                throw new Error("Deploy jobId is undefined");
            const result = await api.waitForJobResult({ jobId, printLogs: true });
            (0, globals_1.expect)(result).toBeDefined();
            if (result === undefined)
                throw new Error("Deploy result is undefined");
            const resultJSON = JSON.parse(result);
            (0, globals_1.expect)(resultJSON.success).toBe(true);
            const hash = resultJSON.hash;
            (0, globals_1.expect)(hash).toBeDefined();
            if (hash === undefined)
                throw new Error("Deploy hash is undefined");
            console.log("deploy hash:", hash);
            console.log("waiting for deploy tx to be included...");
            while (!(await (0, utils_1.getTxStatusFast)({ hash })).result === true) {
                await (0, zkcloudworker_1.sleep)(10000);
            }
            console.log("deploy tx included");
            zkcloudworker_1.Memory.info("deployed");
            console.timeEnd("deployed");
            if (chain !== "local")
                await (0, zkcloudworker_1.sleep)(10000);
        });
    }
    if (mint) {
        (0, globals_1.it)(`should mint tokens`, async () => {
            console.time("minted");
            await (0, zkcloudworker_1.fetchMinaAccount)({ publicKey: admin, force: true });
            const tokenContract = new zkcloudworker_1.FungibleToken(tokenKey);
            const tokenId = tokenContract.deriveTokenId();
            await (0, zkcloudworker_1.fetchMinaAccount)({ publicKey: admin, force: true });
            await (0, zkcloudworker_1.fetchMinaAccount)({ publicKey: adminKey, force: true });
            await (0, zkcloudworker_1.fetchMinaAccount)({ publicKey: tokenKey, force: true });
            await (0, zkcloudworker_1.fetchMinaAccount)({
                publicKey: tokenKey,
                tokenId,
                force: true,
            });
            await (0, zkcloudworker_1.fetchMinaAccount)({
                publicKey: user1,
                tokenId,
                force: true,
            });
            await (0, zkcloudworker_1.fetchMinaAccount)({
                publicKey: user2,
                tokenId,
                force: true,
            });
            await (0, zkcloudworker_1.fetchMinaAccount)({
                publicKey: user3,
                tokenId,
                force: true,
            });
            await (0, zkcloudworker_1.fetchMinaAccount)({
                publicKey: user4,
                tokenId,
                force: true,
            });
            let nonce = Number(o1js_1.Mina.getAccount(admin).nonce.toBigint());
            const toArray = [user1, user2];
            const hashArray = [];
            const amount = o1js_1.UInt64.from(1000e9);
            const memo = `mint ${Number(amount.toBigInt()) / 1_000_000_000} ${symbol}`.length >
                30
                ? `mint ${symbol}`.substring(0, 30)
                : `mint ${Number(amount.toBigInt()) / 1_000_000_000} ${symbol}`;
            for (const to of toArray) {
                const tx = await o1js_1.Mina.transaction({
                    sender: admin,
                    fee: await (0, zkcloudworker_1.fee)(),
                    nonce: nonce++,
                    memo,
                }, async () => {
                    if (!o1js_1.Mina.hasAccount(to, tokenId))
                        o1js_1.AccountUpdate.fundNewAccount(admin, 1);
                    const provingFee = o1js_1.AccountUpdate.createSigned(admin);
                    provingFee.send({
                        to: config_1.wallet,
                        amount: o1js_1.UInt64.from(MINT_FEE),
                    });
                    await tokenContract.mint(to, amount);
                });
                tx.sign([admin.key]);
                const serializedTransaction = (0, zkcloudworker_1.serializeTransaction)(tx);
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
                (0, globals_1.expect)(jobId).toBeDefined();
                if (jobId === undefined)
                    throw new Error("Mint jobId is undefined");
                const result = await api.waitForJobResult({ jobId, printLogs: true });
                (0, globals_1.expect)(result).toBeDefined();
                if (result === undefined)
                    throw new Error("Mint result is undefined");
                const resultJSON = JSON.parse(result);
                (0, globals_1.expect)(resultJSON.success).toBe(true);
                const hash = resultJSON.hash;
                (0, globals_1.expect)(hash).toBeDefined();
                if (hash === undefined)
                    throw new Error("Mint hash is undefined");
                console.log("mint hash:", hash);
                hashArray.push(hash);
            }
            for (const hash of hashArray) {
                console.log("Waiting for mint tx to be included...", hash);
                while (!(await (0, utils_1.getTxStatusFast)({ hash })).result === true) {
                    await (0, zkcloudworker_1.sleep)(10000);
                }
                console.log("mint tx included", hash);
            }
            zkcloudworker_1.Memory.info("minted");
            console.timeEnd("minted");
            if (chain !== "local")
                await (0, zkcloudworker_1.sleep)(10000);
        });
    }
    if (transfer) {
        (0, globals_1.it)(`should transfer tokens`, async () => {
            console.time("transferred");
            await (0, zkcloudworker_1.fetchMinaAccount)({ publicKey: user1, force: true });
            await (0, zkcloudworker_1.fetchMinaAccount)({ publicKey: user2, force: true });
            const tokenContract = new zkcloudworker_1.FungibleToken(tokenKey);
            const tokenId = tokenContract.deriveTokenId();
            const addresses = [
                { from: user1, to: user3 },
                { from: user2, to: user4 },
            ];
            const hashArray = [];
            const amount = o1js_1.UInt64.from(10e9);
            const memo = `transfer ${Number(amount.toBigInt()) / 1_000_000_000} ${symbol}`
                .length > 30
                ? `transfer ${symbol}`.substring(0, 30)
                : `transfer ${Number(amount.toBigInt()) / 1_000_000_000} ${symbol}`;
            for (const { from, to } of addresses) {
                await (0, zkcloudworker_1.fetchMinaAccount)({ publicKey: adminKey, force: true });
                await (0, zkcloudworker_1.fetchMinaAccount)({ publicKey: tokenKey, force: true });
                await (0, zkcloudworker_1.fetchMinaAccount)({
                    publicKey: tokenKey,
                    tokenId,
                    force: true,
                });
                await (0, zkcloudworker_1.fetchMinaAccount)({
                    publicKey: from,
                    force: true,
                });
                await (0, zkcloudworker_1.fetchMinaAccount)({
                    publicKey: from,
                    tokenId,
                    force: true,
                });
                await (0, zkcloudworker_1.fetchMinaAccount)({
                    publicKey: to,
                    tokenId,
                    force: false,
                });
                const nonce = Number(o1js_1.Mina.getAccount(from).nonce.toBigint());
                const isNewAccount = o1js_1.Mina.hasAccount(to, tokenId) === false;
                const tx = await o1js_1.Mina.transaction({
                    sender: from,
                    fee: await (0, zkcloudworker_1.fee)(),
                    nonce,
                    memo,
                }, async () => {
                    if (!o1js_1.Mina.hasAccount(to, tokenId))
                        o1js_1.AccountUpdate.fundNewAccount(from, 1);
                    const provingFee = o1js_1.AccountUpdate.createSigned(from);
                    provingFee.send({
                        to: config_1.wallet,
                        amount: o1js_1.UInt64.from(TRANSFER_FEE),
                    });
                    await tokenContract.transfer(from, to, amount);
                });
                tx.sign([from.key]);
                const serializedTransaction = (0, zkcloudworker_1.serializeTransaction)(tx);
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
                (0, globals_1.expect)(jobId).toBeDefined();
                if (jobId === undefined)
                    throw new Error("Transfer jobId is undefined");
                const result = await api.waitForJobResult({ jobId, printLogs: true });
                (0, globals_1.expect)(result).toBeDefined();
                if (result === undefined)
                    throw new Error("Transfer result is undefined");
                const resultJSON = JSON.parse(result);
                (0, globals_1.expect)(resultJSON.success).toBe(true);
                const hash = resultJSON.hash;
                (0, globals_1.expect)(hash).toBeDefined();
                if (hash === undefined)
                    throw new Error("Transfer hash is undefined");
                console.log("transfer hash:", hash);
                hashArray.push(hash);
            }
            for (const hash of hashArray) {
                console.log("Waiting for transfer tx to be included...", hash);
                while (!(await (0, utils_1.getTxStatusFast)({ hash })).result === true) {
                    await (0, zkcloudworker_1.sleep)(10000);
                }
                console.log("transfer tx included", hash);
            }
            zkcloudworker_1.Memory.info("transferred");
            console.timeEnd("transferred");
            if (chain !== "local")
                await (0, zkcloudworker_1.sleep)(10000);
        });
    }
});
