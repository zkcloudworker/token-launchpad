"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenLauncherWorker = void 0;
const zkcloudworker_1 = require("zkcloudworker");
const o1js_1 = require("o1js");
const env_json_1 = require("../env.json");
const MINT_FEE = 1e8;
const ISSUE_FEE = 1e9;
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
        if (this.cloud.args === undefined)
            throw new Error("this.cloud.args is undefined");
        const args = JSON.parse(this.cloud.args);
        switch (this.cloud.task) {
            case "transfer":
                return await this.transferTx(args);
            case "mint":
                return await this.mintTx(args);
            case "deploy":
                if (transactions.length === 0)
                    throw new Error("transactions is empty");
                return await this.deployTx(transactions[0]);
            default:
                throw new Error(`Unknown task: ${this.cloud.task}`);
        }
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
            args.symbol === undefined) {
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
        console.log(`Sending tx...`);
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
        if (tx === undefined)
            throw new Error("tx is undefined");
        try {
            console.time("proved tx");
            await tx.prove();
            console.timeEnd("proved tx");
            console.timeEnd("prepared tx");
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
                    console.log(`${memo} tx NOT sent: hash: ${txSent?.hash} status: ${txSent?.status}`);
                    return "Error sending transaction";
                }
            }
            if (this.cloud.isLocalCloud && txSent?.status === "pending") {
                const txIncluded = await txSent.safeWait();
                console.log(`${memo} tx included into block: hash: ${txIncluded.hash} status: ${txIncluded.status}`);
                return txIncluded.hash;
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
            return txSent?.hash ?? "Error sending transaction";
        }
        catch (error) {
            console.error("Error sending transaction", error);
            return "Error sending transaction";
        }
    }
    async transferTx(args) {
        if (args.amount === undefined)
            throw new Error("args.amount is undefined");
        if (args.contractAddress === undefined)
            throw new Error("args.contractAddress is undefined");
        if (args.from === undefined)
            throw new Error("args.from is undefined");
        if (args.to === undefined)
            throw new Error("args.to is undefined");
        const privateKey = o1js_1.PrivateKey.fromBase58(args.from);
        const sender = privateKey.toPublicKey();
        console.log("Sender", sender.toBase58());
        const receiver = o1js_1.PublicKey.fromBase58(args.to);
        console.log("Receiver", receiver.toBase58());
        const contractAddress = o1js_1.PublicKey.fromBase58(args.contractAddress);
        console.log("Contract", contractAddress.toBase58());
        const amount = o1js_1.UInt64.from(args.amount);
        console.log("Amount", amount.toBigInt().toString());
        const zkApp = new zkcloudworker_1.FungibleToken(contractAddress);
        await this.compile();
        console.log(`Sending tx...`);
        console.time("prepared tx");
        const memo = "send token";
        const tokenId = zkApp.deriveTokenId();
        await (0, zkcloudworker_1.fetchMinaAccount)({
            publicKey: contractAddress,
            force: true,
        });
        await (0, zkcloudworker_1.fetchMinaAccount)({
            publicKey: sender,
            force: true,
        });
        await (0, zkcloudworker_1.fetchMinaAccount)({
            publicKey: sender,
            tokenId,
            force: true,
        });
        await (0, zkcloudworker_1.fetchMinaAccount)({
            publicKey: receiver,
            tokenId,
            force: false,
        });
        const isNewAccount = o1js_1.Mina.hasAccount(receiver, tokenId) ? false : true;
        if (!o1js_1.Mina.hasAccount(contractAddress)) {
            console.error("Contract does not have account");
            return "Contract does not have account";
        }
        if (!o1js_1.Mina.hasAccount(sender, tokenId)) {
            console.error("Sender does not have account for this token");
            return "Sender does not have account for this token";
        }
        if (!o1js_1.Mina.hasAccount(sender)) {
            console.error("Sender does not have account");
            return "Sender does not have account";
        }
        console.log("Sender balance:", await (0, zkcloudworker_1.accountBalanceMina)(sender));
        const tx = await o1js_1.Mina.transaction({
            sender,
            memo,
            fee: await (0, zkcloudworker_1.fee)(),
        }, async () => {
            if (isNewAccount) {
                o1js_1.AccountUpdate.fundNewAccount(sender);
            }
            await zkApp.transfer(sender, receiver, amount);
        });
        if (tx === undefined)
            throw new Error("tx is undefined");
        tx.sign([privateKey]);
        try {
            console.time("proved tx");
            await tx.prove();
            console.timeEnd("proved tx");
            console.timeEnd("prepared tx");
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
                    console.log(`${memo} tx NOT sent: hash: ${txSent?.hash} status: ${txSent?.status}`);
                    return "Error sending transaction";
                }
            }
            if (this.cloud.isLocalCloud && txSent?.status === "pending") {
                const txIncluded = await txSent.safeWait();
                console.log(`${memo} tx included into block: hash: ${txIncluded.hash} status: ${txIncluded.status}`);
                return txIncluded.hash;
            }
            if (txSent?.hash)
                this.cloud.publishTransactionMetadata({
                    txId: txSent?.hash,
                    metadata: {
                        sender: sender.toBase58(),
                        receiver: receiver.toBase58(),
                        amount: amount.toBigInt().toString(),
                        contractAddress: contractAddress.toBase58(),
                        type: "transfer",
                    },
                });
            return txSent?.hash ?? "Error sending transaction";
        }
        catch (error) {
            console.error("Error sending transaction", error);
            return "Error sending transaction";
        }
    }
    async mintTx(args) {
        if (args.amount === undefined)
            throw new Error("args.amount is undefined");
        if (args.contractAddress === undefined)
            throw new Error("args.contractAddress is undefined");
        if (args.adminPrivateKey === undefined)
            throw new Error("args.from is undefined");
        if (args.to === undefined)
            throw new Error("args.to is undefined");
        const privateKey = o1js_1.PrivateKey.fromBase58(args.adminPrivateKey);
        const sender = privateKey.toPublicKey();
        console.log("Sender", sender.toBase58());
        const receiver = o1js_1.PublicKey.fromBase58(args.to);
        console.log("Receiver", receiver.toBase58());
        const contractAddress = o1js_1.PublicKey.fromBase58(args.contractAddress);
        console.log("Contract", contractAddress.toBase58());
        const amount = o1js_1.UInt64.from(args.amount);
        console.log("Amount", amount.toBigInt().toString());
        const wallet = o1js_1.PublicKey.fromBase58(env_json_1.WALLET);
        const zkApp = new zkcloudworker_1.FungibleToken(contractAddress);
        await this.compile({ compileAdmin: true });
        console.log(`Sending tx...`);
        console.time("prepared tx");
        const memo = "mint token";
        const tokenId = zkApp.deriveTokenId();
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
            publicKey: sender,
            force: true,
        });
        await (0, zkcloudworker_1.fetchMinaAccount)({
            publicKey: wallet,
        });
        await (0, zkcloudworker_1.fetchMinaAccount)({
            publicKey: receiver,
            tokenId,
            force: false,
        });
        const zkAdminAddress = zkApp.admin.get();
        if (zkAdminAddress === undefined) {
            console.error("Admin address is undefined");
            return "Admin address is undefined";
        }
        await (0, zkcloudworker_1.fetchMinaAccount)({
            publicKey: zkAdminAddress,
            force: true,
        });
        //const zkAdmin = new FungibleTokenAdmin(zkAdminAddress);
        const isNewAccount = o1js_1.Mina.hasAccount(receiver, tokenId) ? false : true;
        const isNewWallet = o1js_1.Mina.hasAccount(wallet) ? false : true;
        const newAccountsCount = (isNewAccount ? 1 : 0) + (isNewWallet ? 1 : 0);
        if (!o1js_1.Mina.hasAccount(contractAddress)) {
            console.error("Contract does not have account");
            return "Contract does not have account";
        }
        if (!o1js_1.Mina.hasAccount(contractAddress, tokenId)) {
            console.error("Contract does not have account for this token");
            return "Contract does not have account for this token";
        }
        if (!o1js_1.Mina.hasAccount(sender)) {
            console.error("Sender does not have account");
            return "Sender does not have account";
        }
        if (!o1js_1.Mina.hasAccount(zkAdminAddress)) {
            console.error("Admin contract does not have account");
            return "Admin contract does not have account";
        }
        console.log("Sender balance:", await (0, zkcloudworker_1.accountBalanceMina)(sender));
        const tx = await o1js_1.Mina.transaction({
            sender,
            memo,
            fee: await (0, zkcloudworker_1.fee)(),
        }, async () => {
            if (newAccountsCount > 0) {
                o1js_1.AccountUpdate.fundNewAccount(sender, newAccountsCount);
            }
            const provingFee = o1js_1.AccountUpdate.createSigned(sender);
            provingFee.send({
                to: o1js_1.PublicKey.fromBase58(env_json_1.WALLET),
                amount: o1js_1.UInt64.from(MINT_FEE),
            });
            await zkApp.mint(receiver, amount);
        });
        if (tx === undefined)
            throw new Error("tx is undefined");
        tx.sign([privateKey]);
        try {
            console.time("proved tx");
            await tx.prove();
            console.timeEnd("proved tx");
            console.timeEnd("prepared tx");
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
                    console.log(`${memo} tx NOT sent: hash: ${txSent?.hash} status: ${txSent?.status}`);
                    return "Error sending transaction";
                }
            }
            if (this.cloud.isLocalCloud && txSent?.status === "pending") {
                const txIncluded = await txSent.safeWait();
                console.log(`${memo} tx included into block: hash: ${txIncluded.hash} status: ${txIncluded.status}`);
                return txIncluded.hash;
            }
            if (txSent?.hash)
                this.cloud.publishTransactionMetadata({
                    txId: txSent?.hash,
                    metadata: {
                        admin: sender.toBase58(),
                        receiver: receiver.toBase58(),
                        amount: amount.toBigInt().toString(),
                        contractAddress: contractAddress.toBase58(),
                        type: "mint",
                    },
                });
            return txSent?.hash ?? "Error sending transaction";
        }
        catch (error) {
            console.error("Error sending transaction", error);
            return "Error sending transaction";
        }
    }
}
exports.TokenLauncherWorker = TokenLauncherWorker;
TokenLauncherWorker.contractVerificationKey = undefined;
TokenLauncherWorker.contractAdminVerificationKey = undefined;
