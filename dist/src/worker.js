"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deserializeTinyTransaction = exports.tinyTransactionParams = exports.TokenLauncherWorker = void 0;
const zkcloudworker_1 = require("zkcloudworker");
const o1js_1 = require("o1js");
const env_json_1 = require("../env.json");
const MINT_FEE = 1e8;
const ISSUE_FEE = 1e9;
const TRANSFER_FEE = 1e8;
class TokenLauncherWorker extends zkcloudworker_1.zkCloudWorker {
    constructor(cloud) {
        super(cloud);
        this.cache = o1js_1.Cache.FileSystem(this.cloud.cache);
    }
    async compile(params = {}) {
        try {
            console.time("compiled");
            if (params.compileAdmin === true) {
                if (TokenLauncherWorker.contractAdminVerificationKey === undefined) {
                    console.time("compiled FungibleTokenAdmin");
                    TokenLauncherWorker.contractAdminVerificationKey = (await zkcloudworker_1.FungibleTokenAdmin.compile({
                        cache: this.cache,
                    })).verificationKey;
                    console.timeEnd("compiled FungibleTokenAdmin");
                }
            }
            if (TokenLauncherWorker.contractVerificationKey === undefined) {
                console.time("compiled FungibleToken");
                TokenLauncherWorker.contractVerificationKey = (await zkcloudworker_1.FungibleToken.compile({
                    cache: this.cache,
                })).verificationKey;
                console.timeEnd("compiled FungibleToken");
            }
            console.timeEnd("compiled");
        }
        catch (error) {
            console.error("Error in compile, restarting container", error);
            // Restarting the container, see https://github.com/o1-labs/o1js/issues/1651
            await this.cloud.forceWorkerRestart();
            throw error;
        }
    }
    async create(transaction) {
        throw new Error("Method not implemented.");
    }
    async merge(proof1, proof2) {
        throw new Error("Method not implemented.");
    }
    async execute(transactions) {
        switch (this.cloud.task) {
            case "tiny":
                if (transactions.length === 0)
                    throw new Error("transactions is empty");
                return await this.tinyTx(transactions[0]);
            case "transfer":
                if (transactions.length === 0)
                    throw new Error("transactions is empty");
                return await this.transferTx(transactions[0]);
            case "mint":
                if (transactions.length === 0)
                    throw new Error("transactions is empty");
                return await this.mintTx(transactions[0]);
            case "deploy":
                if (transactions.length === 0)
                    throw new Error("transactions is empty");
                return await this.deployTx(transactions[0]);
            default:
                throw new Error(`Unknown task: ${this.cloud.task}`);
        }
    }
    stringifyJobResult(result) {
        return JSON.stringify(result, null, 2);
    }
    async deployTx(transaction) {
        const args = JSON.parse(transaction);
        if (args.adminContractPublicKey === undefined ||
            args.adminPublicKey === undefined ||
            args.chain === undefined ||
            args.serializedTransaction === undefined ||
            args.signedData === undefined ||
            args.tokenPublicKey === undefined ||
            args.uri === undefined ||
            args.symbol === undefined ||
            args.sendTransaction === undefined) {
            throw new Error("One or more required args are undefined");
        }
        const contractAddress = o1js_1.PublicKey.fromBase58(args.tokenPublicKey);
        console.log("Contract", contractAddress.toBase58());
        const adminContractPublicKey = o1js_1.PublicKey.fromBase58(args.adminContractPublicKey);
        console.log("Admin Contract", adminContractPublicKey.toBase58());
        const wallet = o1js_1.PublicKey.fromBase58(env_json_1.WALLET);
        const zkToken = new zkcloudworker_1.FungibleToken(contractAddress);
        const zkAdmin = new zkcloudworker_1.FungibleTokenAdmin(adminContractPublicKey);
        await this.compile({ compileAdmin: true });
        console.log(`Preparing tx...`);
        console.time("prepared tx");
        const signedJson = JSON.parse(args.signedData);
        const { fee, sender, nonce, memo } = (0, zkcloudworker_1.transactionParams)(args.serializedTransaction, signedJson);
        console.log("Admin (sender)", sender.toBase58());
        if (sender.toBase58() != args.adminPublicKey)
            throw new Error("Invalid sender");
        await (0, zkcloudworker_1.fetchMinaAccount)({
            publicKey: sender,
            force: true,
        });
        await (0, zkcloudworker_1.fetchMinaAccount)({
            publicKey: wallet,
        });
        if (!o1js_1.Mina.hasAccount(sender)) {
            console.error("Sender does not have account");
            return "Sender does not have account";
        }
        console.log("Sender balance:", await (0, zkcloudworker_1.accountBalanceMina)(sender));
        const txNew = await o1js_1.Mina.transaction({ sender, fee, memo, nonce }, async () => {
            o1js_1.AccountUpdate.fundNewAccount(sender, 3);
            const provingFee = o1js_1.AccountUpdate.createSigned(sender);
            provingFee.send({
                to: o1js_1.PublicKey.fromBase58(env_json_1.WALLET),
                amount: o1js_1.UInt64.from(ISSUE_FEE),
            });
            await zkAdmin.deploy({ adminPublicKey: sender });
            zkAdmin.account.zkappUri.set(args.uri);
            await zkToken.deploy({
                symbol: args.symbol,
                src: args.uri,
            });
            await zkToken.initialize(adminContractPublicKey, o1js_1.UInt8.from(9), // TODO: set decimals
            // We can set `startPaused` to `Bool(false)` here, because we are doing an atomic deployment
            // If you are not deploying the admin and token contracts in the same transaction,
            // it is safer to start the tokens paused, and resume them only after verifying that
            // the admin contract has been deployed
            (0, o1js_1.Bool)(false));
        });
        const tx = (0, zkcloudworker_1.deserializeTransaction)(args.serializedTransaction, txNew, signedJson);
        await tx.prove();
        const txJSON = tx.toJSON();
        if (tx === undefined)
            throw new Error("tx is undefined");
        try {
            console.time("proved tx");
            await tx.prove();
            console.timeEnd("proved tx");
            console.timeEnd("prepared tx");
            if (!args.sendTransaction) {
                return this.stringifyJobResult({
                    success: true,
                    tx: txJSON,
                });
            }
            let txSent;
            let sent = false;
            while (!sent) {
                txSent = await tx.safeSend();
                if (txSent.status == "pending") {
                    sent = true;
                    console.log(`${memo} tx sent: hash: ${txSent.hash} status: ${txSent.status}`);
                }
                else if (this.cloud.chain === "zeko") {
                    console.log("Retrying Zeko tx");
                    await (0, zkcloudworker_1.sleep)(10000);
                }
                else {
                    console.log(`${memo} tx NOT sent: hash: ${txSent?.hash} status: ${txSent?.status}`, txSent.errors);
                    return this.stringifyJobResult({
                        success: false,
                        tx: txJSON,
                        hash: txSent.hash,
                        error: String(txSent.errors),
                    });
                }
            }
            if (this.cloud.isLocalCloud && txSent?.status === "pending") {
                const txIncluded = await txSent.safeWait();
                console.log(`${memo} tx included into block: hash: ${txIncluded.hash} status: ${txIncluded.status}`);
                return this.stringifyJobResult({
                    success: true,
                    tx: txJSON,
                    hash: txIncluded.hash,
                });
            }
            if (txSent?.hash)
                this.cloud.publishTransactionMetadata({
                    txId: txSent?.hash,
                    metadata: {
                        admin: sender.toBase58(),
                        contractAddress: contractAddress.toBase58(),
                        adminContractAddress: adminContractPublicKey.toBase58(),
                        type: "deploy",
                    },
                });
            return this.stringifyJobResult({
                success: txSent?.hash !== undefined && txSent?.status == "pending"
                    ? true
                    : false,
                tx: txJSON,
                hash: txSent?.hash,
                error: String(txSent?.errors ?? ""),
            });
        }
        catch (error) {
            console.error("Error sending transaction", error);
            return this.stringifyJobResult({
                success: false,
                tx: txJSON,
                error: String(error),
            });
        }
    }
    async mintTx(transaction) {
        const args = JSON.parse(transaction);
        if (args.adminContractPublicKey === undefined ||
            args.adminPublicKey === undefined ||
            args.chain === undefined ||
            args.serializedTransaction === undefined ||
            args.signedData === undefined ||
            args.tokenPublicKey === undefined ||
            args.symbol === undefined ||
            args.sendTransaction === undefined ||
            args.amount === undefined ||
            args.to === undefined) {
            throw new Error("One or more required args are undefined");
        }
        const contractAddress = o1js_1.PublicKey.fromBase58(args.tokenPublicKey);
        console.log("Contract", contractAddress.toBase58());
        const adminContractPublicKey = o1js_1.PublicKey.fromBase58(args.adminContractPublicKey);
        console.log("Admin Contract", adminContractPublicKey.toBase58());
        const wallet = o1js_1.PublicKey.fromBase58(env_json_1.WALLET);
        const zkToken = new zkcloudworker_1.FungibleToken(contractAddress);
        const tokenId = zkToken.deriveTokenId();
        const zkAdmin = new zkcloudworker_1.FungibleTokenAdmin(adminContractPublicKey);
        const to = o1js_1.PublicKey.fromBase58(args.to);
        const amount = o1js_1.UInt64.from(args.amount);
        await this.compile({ compileAdmin: true });
        console.log(`Preparing tx...`);
        console.time("prepared tx");
        const signedJson = JSON.parse(args.signedData);
        const { fee, sender, nonce, memo } = (0, zkcloudworker_1.transactionParams)(args.serializedTransaction, signedJson);
        console.log("Admin (sender)", sender.toBase58());
        if (sender.toBase58() != args.adminPublicKey)
            throw new Error("Invalid sender");
        await (0, zkcloudworker_1.fetchMinaAccount)({
            publicKey: sender,
            force: true,
        });
        await (0, zkcloudworker_1.fetchMinaAccount)({
            publicKey: contractAddress,
            force: true,
        });
        await (0, zkcloudworker_1.fetchMinaAccount)({
            publicKey: adminContractPublicKey,
            force: true,
        });
        await (0, zkcloudworker_1.fetchMinaAccount)({
            publicKey: contractAddress,
            tokenId,
            force: true,
        });
        await (0, zkcloudworker_1.fetchMinaAccount)({
            publicKey: to,
            tokenId,
            force: true,
        });
        await (0, zkcloudworker_1.fetchMinaAccount)({
            publicKey: wallet,
            force: true,
        });
        if (!o1js_1.Mina.hasAccount(sender)) {
            console.error("Sender does not have account");
            return "Sender does not have account";
        }
        console.log("Sender balance:", await (0, zkcloudworker_1.accountBalanceMina)(sender));
        const isNewAccount = o1js_1.Mina.hasAccount(to, tokenId) === false;
        const txNew = await o1js_1.Mina.transaction({ sender, fee, memo, nonce }, async () => {
            if (isNewAccount)
                o1js_1.AccountUpdate.fundNewAccount(sender, 1);
            const provingFee = o1js_1.AccountUpdate.createSigned(sender);
            provingFee.send({
                to: o1js_1.PublicKey.fromBase58(env_json_1.WALLET),
                amount: o1js_1.UInt64.from(MINT_FEE),
            });
            await zkToken.mint(to, amount);
        });
        const tx = (0, zkcloudworker_1.deserializeTransaction)(args.serializedTransaction, txNew, signedJson);
        await tx.prove();
        const txJSON = tx.toJSON();
        if (tx === undefined)
            throw new Error("tx is undefined");
        try {
            console.time("proved tx");
            await tx.prove();
            console.timeEnd("proved tx");
            console.timeEnd("prepared tx");
            if (!args.sendTransaction) {
                return this.stringifyJobResult({
                    success: true,
                    tx: txJSON,
                });
            }
            let txSent;
            let sent = false;
            while (!sent) {
                txSent = await tx.safeSend();
                if (txSent.status == "pending") {
                    sent = true;
                    console.log(`${memo} tx sent: hash: ${txSent.hash} status: ${txSent.status}`);
                }
                else if (this.cloud.chain === "zeko") {
                    console.log("Retrying Zeko tx");
                    await (0, zkcloudworker_1.sleep)(10000);
                }
                else {
                    console.log(`${memo} tx NOT sent: hash: ${txSent?.hash} status: ${txSent?.status}`, txSent.errors);
                    return this.stringifyJobResult({
                        success: false,
                        tx: txJSON,
                        hash: txSent.hash,
                        error: String(txSent.errors),
                    });
                }
            }
            if (this.cloud.isLocalCloud && txSent?.status === "pending") {
                const txIncluded = await txSent.safeWait();
                console.log(`${memo} tx included into block: hash: ${txIncluded.hash} status: ${txIncluded.status}`);
                return this.stringifyJobResult({
                    success: true,
                    tx: txJSON,
                    hash: txIncluded.hash,
                });
            }
            if (txSent?.hash)
                this.cloud.publishTransactionMetadata({
                    txId: txSent?.hash,
                    metadata: {
                        admin: sender.toBase58(),
                        contractAddress: contractAddress.toBase58(),
                        adminContractAddress: adminContractPublicKey.toBase58(),
                        to: to.toBase58(),
                        amount: amount.toBigInt().toString(),
                        type: "mint",
                    },
                });
            return this.stringifyJobResult({
                success: txSent?.hash !== undefined && txSent?.status == "pending"
                    ? true
                    : false,
                tx: txJSON,
                hash: txSent?.hash,
                error: String(txSent?.errors ?? ""),
            });
        }
        catch (error) {
            console.error("Error sending transaction", error);
            return this.stringifyJobResult({
                success: false,
                tx: txJSON,
                error: String(error),
            });
        }
    }
    async transferTx(transaction) {
        const args = JSON.parse(transaction);
        if (args.chain === undefined ||
            args.serializedTransaction === undefined ||
            args.signedData === undefined ||
            args.tokenPublicKey === undefined ||
            args.symbol === undefined ||
            args.sendTransaction === undefined ||
            args.amount === undefined ||
            args.to === undefined ||
            args.from === undefined) {
            throw new Error("One or more required args are undefined");
        }
        const contractAddress = o1js_1.PublicKey.fromBase58(args.tokenPublicKey);
        console.log("Contract", contractAddress.toBase58());
        const wallet = o1js_1.PublicKey.fromBase58(env_json_1.WALLET);
        const zkToken = new zkcloudworker_1.FungibleToken(contractAddress);
        const tokenId = zkToken.deriveTokenId();
        const from = o1js_1.PublicKey.fromBase58(args.from);
        const to = o1js_1.PublicKey.fromBase58(args.to);
        const amount = o1js_1.UInt64.from(args.amount);
        await this.compile({ compileAdmin: true });
        console.log(`Preparing tx...`);
        console.time("prepared tx");
        const signedJson = JSON.parse(args.signedData);
        const { fee, sender, nonce, memo } = (0, zkcloudworker_1.transactionParams)(args.serializedTransaction, signedJson);
        console.log("Sender:", sender.toBase58());
        if (sender.toBase58() != from.toBase58())
            throw new Error("Invalid sender");
        await (0, zkcloudworker_1.fetchMinaAccount)({
            publicKey: sender,
            force: true,
        });
        await (0, zkcloudworker_1.fetchMinaAccount)({
            publicKey: contractAddress,
            force: true,
        });
        await (0, zkcloudworker_1.fetchMinaAccount)({
            publicKey: contractAddress,
            tokenId,
            force: true,
        });
        await (0, zkcloudworker_1.fetchMinaAccount)({
            publicKey: to,
            tokenId,
            force: true,
        });
        await (0, zkcloudworker_1.fetchMinaAccount)({
            publicKey: from,
            tokenId,
            force: true,
        });
        await (0, zkcloudworker_1.fetchMinaAccount)({
            publicKey: from,
            force: true,
        });
        await (0, zkcloudworker_1.fetchMinaAccount)({
            publicKey: wallet,
            force: true,
        });
        if (!o1js_1.Mina.hasAccount(sender)) {
            console.error("Sender does not have account");
            return "Sender does not have account";
        }
        console.log("Sender balance:", await (0, zkcloudworker_1.accountBalanceMina)(sender));
        const isNewAccount = o1js_1.Mina.hasAccount(to, tokenId) === false;
        const txNew = await o1js_1.Mina.transaction({ sender, fee, memo, nonce }, async () => {
            if (isNewAccount)
                o1js_1.AccountUpdate.fundNewAccount(sender, 1);
            const provingFee = o1js_1.AccountUpdate.createSigned(sender);
            provingFee.send({
                to: o1js_1.PublicKey.fromBase58(env_json_1.WALLET),
                amount: o1js_1.UInt64.from(TRANSFER_FEE),
            });
            await zkToken.transfer(from, to, amount);
        });
        const tx = (0, zkcloudworker_1.deserializeTransaction)(args.serializedTransaction, txNew, signedJson);
        await tx.prove();
        const txJSON = tx.toJSON();
        if (tx === undefined)
            throw new Error("tx is undefined");
        try {
            console.time("proved tx");
            await tx.prove();
            console.timeEnd("proved tx");
            console.timeEnd("prepared tx");
            if (!args.sendTransaction) {
                return this.stringifyJobResult({
                    success: true,
                    tx: txJSON,
                });
            }
            let txSent;
            let sent = false;
            while (!sent) {
                txSent = await tx.safeSend();
                if (txSent.status == "pending") {
                    sent = true;
                    console.log(`${memo} tx sent: hash: ${txSent.hash} status: ${txSent.status}`);
                }
                else if (this.cloud.chain === "zeko") {
                    console.log("Retrying Zeko tx");
                    await (0, zkcloudworker_1.sleep)(10000);
                }
                else {
                    console.log(`${memo} tx NOT sent: hash: ${txSent?.hash} status: ${txSent?.status}`, txSent.errors);
                    return this.stringifyJobResult({
                        success: false,
                        tx: txJSON,
                        hash: txSent.hash,
                        error: String(txSent.errors),
                    });
                }
            }
            if (this.cloud.isLocalCloud && txSent?.status === "pending") {
                const txIncluded = await txSent.safeWait();
                console.log(`${memo} tx included into block: hash: ${txIncluded.hash} status: ${txIncluded.status}`);
                return this.stringifyJobResult({
                    success: true,
                    tx: txJSON,
                    hash: txIncluded.hash,
                });
            }
            if (txSent?.hash)
                this.cloud.publishTransactionMetadata({
                    txId: txSent?.hash,
                    metadata: {
                        admin: sender.toBase58(),
                        contractAddress: contractAddress.toBase58(),
                        from: from.toBase58(),
                        to: to.toBase58(),
                        amount: amount.toBigInt().toString(),
                        type: "transfer",
                    },
                });
            return this.stringifyJobResult({
                success: txSent?.hash !== undefined && txSent?.status == "pending"
                    ? true
                    : false,
                tx: txJSON,
                hash: txSent?.hash,
                error: String(txSent?.errors ?? ""),
            });
        }
        catch (error) {
            console.error("Error sending transaction", error);
            return this.stringifyJobResult({
                success: false,
                tx: txJSON,
                error: String(error),
            });
        }
    }
    async tinyTx(transaction) {
        const args = JSON.parse(transaction);
        if (args.sender === undefined ||
            args.contractAddress === undefined ||
            args.chain === undefined ||
            args.serializedTransaction === undefined ||
            args.sendTransaction === undefined ||
            args.value === undefined) {
            throw new Error("One or more required args are undefined");
        }
        const contractAddress = o1js_1.PublicKey.fromBase58(args.contractAddress);
        console.log("Contract", contractAddress.toBase58());
        const zkApp = new zkcloudworker_1.TinyContract(contractAddress);
        const value = (0, o1js_1.Field)(args.value);
        await zkcloudworker_1.TinyContract.compile({ cache: this.cache });
        console.log(`Preparing tx...`);
        console.time("prepared tx");
        const { fee, sender, nonce, memo } = tinyTransactionParams(args.serializedTransaction);
        console.log("Sender:", sender.toBase58());
        if (sender.toBase58() != args.sender)
            throw new Error("Invalid sender");
        await (0, zkcloudworker_1.fetchMinaAccount)({
            publicKey: sender,
            force: true,
        });
        await (0, zkcloudworker_1.fetchMinaAccount)({
            publicKey: contractAddress,
            force: true,
        });
        if (!o1js_1.Mina.hasAccount(sender)) {
            console.error("Sender does not have account");
            return "Sender does not have account";
        }
        console.log("Sender balance:", await (0, zkcloudworker_1.accountBalanceMina)(sender));
        const txNew = await o1js_1.Mina.transaction({ sender, fee, memo, nonce }, async () => {
            await zkApp.setValue(value);
        });
        const tx = deserializeTinyTransaction(args.serializedTransaction, txNew);
        await tx.prove();
        const txJSON = tx.toJSON();
        if (tx === undefined)
            throw new Error("tx is undefined");
        try {
            console.time("proved tx");
            await tx.prove();
            console.timeEnd("proved tx");
            console.timeEnd("prepared tx");
            if (!args.sendTransaction) {
                return this.stringifyJobResult({
                    success: true,
                    tx: txJSON,
                });
            }
            let txSent;
            let sent = false;
            while (!sent) {
                txSent = await tx.safeSend();
                if (txSent.status == "pending") {
                    sent = true;
                    console.log(`${memo} tx sent: hash: ${txSent.hash} status: ${txSent.status}`);
                }
                else if (this.cloud.chain === "zeko") {
                    console.log("Retrying Zeko tx");
                    await (0, zkcloudworker_1.sleep)(10000);
                }
                else {
                    console.log(`${memo} tx NOT sent: hash: ${txSent?.hash} status: ${txSent?.status}`, txSent.errors);
                    return this.stringifyJobResult({
                        success: false,
                        tx: txJSON,
                        hash: txSent.hash,
                        error: String(txSent.errors),
                    });
                }
            }
            if (this.cloud.isLocalCloud && txSent?.status === "pending") {
                const txIncluded = await txSent.safeWait();
                console.log(`${memo} tx included into block: hash: ${txIncluded.hash} status: ${txIncluded.status}`);
                return this.stringifyJobResult({
                    success: true,
                    tx: txJSON,
                    hash: txIncluded.hash,
                });
            }
            if (txSent?.hash)
                this.cloud.publishTransactionMetadata({
                    txId: txSent?.hash,
                    metadata: {
                        admin: sender.toBase58(),
                        contractAddress: contractAddress.toBase58(),
                        value: value.toBigInt().toString(),
                        type: "tiny",
                    },
                });
            return this.stringifyJobResult({
                success: txSent?.hash !== undefined && txSent?.status == "pending"
                    ? true
                    : false,
                tx: txJSON,
                hash: txSent?.hash,
                error: String(txSent?.errors ?? ""),
            });
        }
        catch (error) {
            console.error("Error sending transaction", error);
            return this.stringifyJobResult({
                success: false,
                tx: txJSON,
                error: String(error),
            });
        }
    }
}
exports.TokenLauncherWorker = TokenLauncherWorker;
TokenLauncherWorker.contractVerificationKey = undefined;
TokenLauncherWorker.contractAdminVerificationKey = undefined;
function tinyTransactionParams(serializedTransaction) {
    const { sender, nonce, tx, fee } = JSON.parse(serializedTransaction);
    const transaction = o1js_1.Mina.Transaction.fromJSON(JSON.parse(tx));
    const memo = transaction.transaction.memo;
    return {
        fee,
        sender: o1js_1.PublicKey.fromBase58(sender),
        nonce,
        memo,
    };
}
exports.tinyTransactionParams = tinyTransactionParams;
function deserializeTinyTransaction(serializedTransaction, txNew) {
    //console.log("new transaction", txNew);
    const { tx, blindingValues, length } = JSON.parse(serializedTransaction);
    const transaction = o1js_1.Mina.Transaction.fromJSON(JSON.parse(tx));
    //console.log("transaction", transaction);
    if (length !== txNew.transaction.accountUpdates.length) {
        throw new Error("New Transaction length mismatch");
    }
    if (length !== transaction.transaction.accountUpdates.length) {
        throw new Error("Serialized Transaction length mismatch");
    }
    for (let i = 0; i < length; i++) {
        transaction.transaction.accountUpdates[i].lazyAuthorization =
            txNew.transaction.accountUpdates[i].lazyAuthorization;
        if (blindingValues[i] !== "")
            transaction.transaction.accountUpdates[i].lazyAuthorization.blindingValue = o1js_1.Field.fromJSON(blindingValues[i]);
    }
    return transaction;
}
exports.deserializeTinyTransaction = deserializeTinyTransaction;
