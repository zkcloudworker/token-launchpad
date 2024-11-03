import {
  zkCloudWorker,
  Cloud,
  fee,
  sleep,
  fetchMinaAccount,
  accountBalanceMina,
  FungibleTokenDeployParams,
  FungibleTokenMintParams,
  FungibleTokenTransferParams,
  FungibleTokenJobResult,
  transactionParams,
  deserializeTransaction,
  TinyContract,
} from "./lib";
import { FungibleToken } from "./FungibleToken";
import { FungibleTokenAdmin } from "./FungibleTokenAdmin";

import {
  VerificationKey,
  PublicKey,
  Mina,
  PrivateKey,
  AccountUpdate,
  Cache,
  UInt64,
  UInt8,
  Bool,
  Field,
  Transaction,
} from "o1js_v1";
import { WALLET } from "../../../env.json";
const MINT_FEE = 1e8;
const ISSUE_FEE = 1e9;
const TRANSFER_FEE = 1e8;

interface TinyTransactionParams {
  chain: string;
  contractAddress: string;
  serializedTransaction: string;
  sender: string;
  value: number;
  sendTransaction: boolean;
}
export class TokenLauncherWorker extends zkCloudWorker {
  static contractVerificationKey: VerificationKey | undefined = undefined;
  static contractAdminVerificationKey: VerificationKey | undefined = undefined;
  readonly cache: Cache;

  constructor(cloud: Cloud) {
    super(cloud);
    this.cache = Cache.FileSystem(this.cloud.cache);
  }

  private async compile(
    params: { compileAdmin?: boolean } = {}
  ): Promise<void> {
    try {
      console.time("compiled");
      if (params.compileAdmin === true) {
        if (TokenLauncherWorker.contractAdminVerificationKey === undefined) {
          console.time("compiled FungibleTokenAdmin");
          TokenLauncherWorker.contractAdminVerificationKey = (
            await FungibleTokenAdmin.compile({
              cache: this.cache,
            })
          ).verificationKey;
          console.timeEnd("compiled FungibleTokenAdmin");
        }
      }

      if (TokenLauncherWorker.contractVerificationKey === undefined) {
        console.time("compiled FungibleToken");
        TokenLauncherWorker.contractVerificationKey = (
          await FungibleToken.compile({
            cache: this.cache,
          })
        ).verificationKey;
        console.timeEnd("compiled FungibleToken");
      }
      console.timeEnd("compiled");
    } catch (error) {
      console.error("Error in compile, restarting container", error);
      // Restarting the container, see https://github.com/o1-labs/o1js/issues/1651
      await this.cloud.forceWorkerRestart();
      throw error;
    }
  }

  public async create(transaction: string): Promise<string | undefined> {
    throw new Error("Method not implemented.");
  }

  public async merge(
    proof1: string,
    proof2: string
  ): Promise<string | undefined> {
    throw new Error("Method not implemented.");
  }

  public async execute(transactions: string[]): Promise<string | undefined> {
    switch (this.cloud.task) {
      case "tiny":
        if (transactions.length === 0) throw new Error("transactions is empty");
        return await this.tinyTx(transactions[0]);

      case "transfer":
        if (transactions.length === 0) throw new Error("transactions is empty");
        return await this.transferTx(transactions[0]);

      case "mint":
        if (transactions.length === 0) throw new Error("transactions is empty");
        return await this.mintTx(transactions[0]);

      case "deploy":
        if (transactions.length === 0) throw new Error("transactions is empty");
        return await this.deployTx(transactions[0]);

      default:
        throw new Error(`Unknown task: ${this.cloud.task}`);
    }
  }

  private stringifyJobResult(result: FungibleTokenJobResult): string {
    return JSON.stringify(result, null, 2);
  }

  private async deployTx(transaction: string): Promise<string> {
    const args: FungibleTokenDeployParams = JSON.parse(transaction);
    if (
      args.adminContractPublicKey === undefined ||
      args.adminPublicKey === undefined ||
      args.chain === undefined ||
      args.serializedTransaction === undefined ||
      args.signedData === undefined ||
      args.tokenPublicKey === undefined ||
      args.uri === undefined ||
      args.symbol === undefined ||
      args.sendTransaction === undefined
    ) {
      throw new Error("One or more required args are undefined");
    }

    const contractAddress = PublicKey.fromBase58(args.tokenPublicKey);
    console.log("Contract", contractAddress.toBase58());
    const adminContractPublicKey = PublicKey.fromBase58(
      args.adminContractPublicKey
    );
    console.log("Admin Contract", adminContractPublicKey.toBase58());
    const wallet = PublicKey.fromBase58(WALLET);
    const zkToken = new FungibleToken(contractAddress);
    const zkAdmin = new FungibleTokenAdmin(adminContractPublicKey);

    console.log(`Preparing tx...`);
    console.time("prepared tx");
    const signedJson = JSON.parse(args.signedData);

    const { fee, sender, nonce, memo } = transactionParams(
      args.serializedTransaction,
      signedJson
    );
    console.log("Admin (sender)", sender.toBase58());

    if (sender.toBase58() != args.adminPublicKey)
      throw new Error("Invalid sender");
    await fetchMinaAccount({
      publicKey: sender,
      force: true,
    });
    await fetchMinaAccount({
      publicKey: wallet,
    });

    if (!Mina.hasAccount(sender)) {
      console.error("Sender does not have account");
      return "Sender does not have account";
    }

    console.log("Sender balance:", await accountBalanceMina(sender));
    await this.compile({ compileAdmin: true });

    const txNew = await Mina.transaction(
      { sender, fee, memo, nonce },
      async () => {
        AccountUpdate.fundNewAccount(sender, 3);
        const provingFee = AccountUpdate.createSigned(sender);
        provingFee.send({
          to: PublicKey.fromBase58(WALLET),
          amount: UInt64.from(ISSUE_FEE),
        });
        await zkAdmin.deploy({ adminPublicKey: sender });
        zkAdmin.account.zkappUri.set(args.uri);
        await zkToken.deploy({
          symbol: args.symbol,
          src: args.uri,
        });
        await zkToken.initialize(
          adminContractPublicKey,
          UInt8.from(9), // TODO: set decimals
          // We can set `startPaused` to `Bool(false)` here, because we are doing an atomic deployment
          // If you are not deploying the admin and token contracts in the same transaction,
          // it is safer to start the tokens paused, and resume them only after verifying that
          // the admin contract has been deployed
          Bool(false)
        );
      }
    );
    const tx = deserializeTransaction(
      args.serializedTransaction,
      txNew,
      signedJson
    );
    if (tx === undefined) throw new Error("tx is undefined");
    console.time("proved tx");
    await tx.prove();
    console.timeEnd("proved tx");
    const txJSON = tx.toJSON();
    console.timeEnd("prepared tx");

    try {
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
          console.log(
            `${memo} tx sent: hash: ${txSent.hash} status: ${txSent.status}`
          );
        } else if (this.cloud.chain === "zeko") {
          console.log("Retrying Zeko tx");
          await sleep(10000);
        } else {
          console.log(
            `${memo} tx NOT sent: hash: ${txSent?.hash} status: ${txSent?.status}`,
            txSent.errors
          );
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
        console.log(
          `${memo} tx included into block: hash: ${txIncluded.hash} status: ${txIncluded.status}`
        );
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
          } as any,
        });
      return this.stringifyJobResult({
        success:
          txSent?.hash !== undefined && txSent?.status == "pending"
            ? true
            : false,
        tx: txJSON,
        hash: txSent?.hash,
        error: String(txSent?.errors ?? ""),
      });
    } catch (error) {
      console.error("Error sending transaction", error);
      return this.stringifyJobResult({
        success: false,
        tx: txJSON,
        error: String(error),
      });
    }
  }

  private async mintTx(transaction: string): Promise<string> {
    const args: FungibleTokenMintParams = JSON.parse(transaction);
    if (
      args.adminContractPublicKey === undefined ||
      args.adminPublicKey === undefined ||
      args.chain === undefined ||
      args.serializedTransaction === undefined ||
      args.signedData === undefined ||
      args.tokenPublicKey === undefined ||
      args.symbol === undefined ||
      args.sendTransaction === undefined ||
      args.amount === undefined ||
      args.to === undefined
    ) {
      throw new Error("One or more required args are undefined");
    }

    const contractAddress = PublicKey.fromBase58(args.tokenPublicKey);
    console.log("Contract", contractAddress.toBase58());
    const adminContractPublicKey = PublicKey.fromBase58(
      args.adminContractPublicKey
    );
    console.log("Admin Contract", adminContractPublicKey.toBase58());
    const wallet = PublicKey.fromBase58(WALLET);
    const zkToken = new FungibleToken(contractAddress);
    const tokenId = zkToken.deriveTokenId();
    const zkAdmin = new FungibleTokenAdmin(adminContractPublicKey);
    const to = PublicKey.fromBase58(args.to);
    const amount = UInt64.from(args.amount);
    await this.compile({ compileAdmin: true });

    console.log(`Preparing tx...`);
    console.time("prepared tx");
    const signedJson = JSON.parse(args.signedData);

    const { fee, sender, nonce, memo } = transactionParams(
      args.serializedTransaction,
      signedJson
    );
    console.log("Admin (sender)", sender.toBase58());

    if (sender.toBase58() != args.adminPublicKey)
      throw new Error("Invalid sender");
    await fetchMinaAccount({
      publicKey: sender,
      force: true,
    });
    await fetchMinaAccount({
      publicKey: contractAddress,
      force: true,
    });
    await fetchMinaAccount({
      publicKey: adminContractPublicKey,
      force: true,
    });
    await fetchMinaAccount({
      publicKey: contractAddress,
      tokenId,
      force: true,
    });
    await fetchMinaAccount({
      publicKey: to,
      tokenId,
      force: true,
    });
    await fetchMinaAccount({
      publicKey: wallet,
      force: true,
    });

    if (!Mina.hasAccount(sender)) {
      console.error("Sender does not have account");
      return "Sender does not have account";
    }

    console.log("Sender balance:", await accountBalanceMina(sender));
    const isNewAccount = Mina.hasAccount(to, tokenId) === false;

    const txNew = await Mina.transaction(
      { sender, fee, memo, nonce },
      async () => {
        if (isNewAccount) AccountUpdate.fundNewAccount(sender, 1);
        const provingFee = AccountUpdate.createSigned(sender);
        provingFee.send({
          to: PublicKey.fromBase58(WALLET),
          amount: UInt64.from(MINT_FEE),
        });
        await zkToken.mint(to, amount);
      }
    );
    const tx = deserializeTransaction(
      args.serializedTransaction,
      txNew,
      signedJson
    );
    if (tx === undefined) throw new Error("tx is undefined");
    console.time("proved tx");
    await tx.prove();
    console.timeEnd("proved tx");
    const txJSON = tx.toJSON();
    console.timeEnd("prepared tx");

    try {
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
          console.log(
            `${memo} tx sent: hash: ${txSent.hash} status: ${txSent.status}`
          );
        } else if (this.cloud.chain === "zeko") {
          console.log("Retrying Zeko tx");
          await sleep(10000);
        } else {
          console.log(
            `${memo} tx NOT sent: hash: ${txSent?.hash} status: ${txSent?.status}`,
            txSent.errors
          );
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
        console.log(
          `${memo} tx included into block: hash: ${txIncluded.hash} status: ${txIncluded.status}`
        );
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
          } as any,
        });
      return this.stringifyJobResult({
        success:
          txSent?.hash !== undefined && txSent?.status == "pending"
            ? true
            : false,
        tx: txJSON,
        hash: txSent?.hash,
        error: String(txSent?.errors ?? ""),
      });
    } catch (error) {
      console.error("Error sending transaction", error);
      return this.stringifyJobResult({
        success: false,
        tx: txJSON,
        error: String(error),
      });
    }
  }

  private async transferTx(transaction: string): Promise<string> {
    const args: FungibleTokenTransferParams = JSON.parse(transaction);
    if (
      args.chain === undefined ||
      args.serializedTransaction === undefined ||
      args.signedData === undefined ||
      args.tokenPublicKey === undefined ||
      args.symbol === undefined ||
      args.sendTransaction === undefined ||
      args.amount === undefined ||
      args.to === undefined ||
      args.from === undefined
    ) {
      throw new Error("One or more required args are undefined");
    }

    const contractAddress = PublicKey.fromBase58(args.tokenPublicKey);
    console.log("Contract", contractAddress.toBase58());
    const wallet = PublicKey.fromBase58(WALLET);
    const zkToken = new FungibleToken(contractAddress);
    const tokenId = zkToken.deriveTokenId();
    const from = PublicKey.fromBase58(args.from);
    const to = PublicKey.fromBase58(args.to);
    const amount = UInt64.from(args.amount);
    await this.compile({ compileAdmin: true });

    console.log(`Preparing tx...`);
    console.time("prepared tx");
    const signedJson = JSON.parse(args.signedData);

    const { fee, sender, nonce, memo } = transactionParams(
      args.serializedTransaction,
      signedJson
    );
    console.log("Sender:", sender.toBase58());

    if (sender.toBase58() != from.toBase58()) throw new Error("Invalid sender");
    await fetchMinaAccount({
      publicKey: sender,
      force: true,
    });
    await fetchMinaAccount({
      publicKey: contractAddress,
      force: true,
    });

    await fetchMinaAccount({
      publicKey: contractAddress,
      tokenId,
      force: true,
    });
    await fetchMinaAccount({
      publicKey: to,
      tokenId,
      force: true,
    });
    await fetchMinaAccount({
      publicKey: from,
      tokenId,
      force: true,
    });
    await fetchMinaAccount({
      publicKey: from,
      force: true,
    });
    await fetchMinaAccount({
      publicKey: wallet,
      force: true,
    });

    if (!Mina.hasAccount(sender)) {
      console.error("Sender does not have account");
      return "Sender does not have account";
    }

    console.log("Sender balance:", await accountBalanceMina(sender));
    const isNewAccount = Mina.hasAccount(to, tokenId) === false;

    const txNew = await Mina.transaction(
      { sender, fee, memo, nonce },
      async () => {
        if (isNewAccount) AccountUpdate.fundNewAccount(sender, 1);
        const provingFee = AccountUpdate.createSigned(sender);
        provingFee.send({
          to: PublicKey.fromBase58(WALLET),
          amount: UInt64.from(TRANSFER_FEE),
        });
        await zkToken.transfer(from, to, amount);
      }
    );
    const tx = deserializeTransaction(
      args.serializedTransaction,
      txNew,
      signedJson
    );
    if (tx === undefined) throw new Error("tx is undefined");
    console.time("proved tx");
    await tx.prove();
    console.timeEnd("proved tx");
    const txJSON = tx.toJSON();
    console.timeEnd("prepared tx");

    try {
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
          console.log(
            `${memo} tx sent: hash: ${txSent.hash} status: ${txSent.status}`
          );
        } else if (this.cloud.chain === "zeko") {
          console.log("Retrying Zeko tx");
          await sleep(10000);
        } else {
          console.log(
            `${memo} tx NOT sent: hash: ${txSent?.hash} status: ${txSent?.status}`,
            txSent.errors
          );
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
        console.log(
          `${memo} tx included into block: hash: ${txIncluded.hash} status: ${txIncluded.status}`
        );
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
          } as any,
        });
      return this.stringifyJobResult({
        success:
          txSent?.hash !== undefined && txSent?.status == "pending"
            ? true
            : false,
        tx: txJSON,
        hash: txSent?.hash,
        error: String(txSent?.errors ?? ""),
      });
    } catch (error) {
      console.error("Error sending transaction", error);
      return this.stringifyJobResult({
        success: false,
        tx: txJSON,
        error: String(error),
      });
    }
  }

  private async tinyTx(transaction: string): Promise<string> {
    const args: TinyTransactionParams = JSON.parse(transaction);
    if (
      args.sender === undefined ||
      args.contractAddress === undefined ||
      args.chain === undefined ||
      args.serializedTransaction === undefined ||
      args.sendTransaction === undefined ||
      args.value === undefined
    ) {
      throw new Error("One or more required args are undefined");
    }

    const contractAddress = PublicKey.fromBase58(args.contractAddress);
    console.log("Contract", contractAddress.toBase58());

    const zkApp = new TinyContract(contractAddress);
    const value = Field(args.value);
    await TinyContract.compile({ cache: this.cache });

    console.log(`Preparing tx...`);
    console.time("prepared tx");

    const { fee, sender, nonce, memo } = tinyTransactionParams(
      args.serializedTransaction
    );
    console.log("Sender:", sender.toBase58());

    if (sender.toBase58() != args.sender) throw new Error("Invalid sender");
    await fetchMinaAccount({
      publicKey: sender,
      force: true,
    });
    await fetchMinaAccount({
      publicKey: contractAddress,
      force: true,
    });

    if (!Mina.hasAccount(sender)) {
      console.error("Sender does not have account");
      return "Sender does not have account";
    }

    console.log("Sender balance:", await accountBalanceMina(sender));

    const txNew = await Mina.transaction(
      { sender, fee, memo, nonce },
      async () => {
        await zkApp.setValue(value);
      }
    );
    const tx = deserializeTinyTransaction(args.serializedTransaction, txNew);
    if (tx === undefined) throw new Error("tx is undefined");
    console.time("proved tx");
    await tx.prove();
    console.timeEnd("proved tx");
    const txJSON = tx.toJSON();
    console.timeEnd("prepared tx");
    try {
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
          console.log(
            `${memo} tx sent: hash: ${txSent.hash} status: ${txSent.status}`
          );
        } else if (this.cloud.chain === "zeko") {
          console.log("Retrying Zeko tx");
          await sleep(10000);
        } else {
          console.log(
            `${memo} tx NOT sent: hash: ${txSent?.hash} status: ${txSent?.status}`,
            txSent.errors
          );
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
        console.log(
          `${memo} tx included into block: hash: ${txIncluded.hash} status: ${txIncluded.status}`
        );
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
          } as any,
        });
      return this.stringifyJobResult({
        success:
          txSent?.hash !== undefined && txSent?.status == "pending"
            ? true
            : false,
        tx: txJSON,
        hash: txSent?.hash,
        error: String(txSent?.errors ?? ""),
      });
    } catch (error) {
      console.error("Error sending transaction", error);
      return this.stringifyJobResult({
        success: false,
        tx: txJSON,
        error: String(error),
      });
    }
  }
}

export function tinyTransactionParams(serializedTransaction: string): {
  fee: UInt64;
  sender: PublicKey;
  nonce: number;
  memo: string;
} {
  const { sender, nonce, tx, fee } = JSON.parse(serializedTransaction);
  const transaction = Mina.Transaction.fromJSON(JSON.parse(tx));
  const memo = transaction.transaction.memo;
  return {
    fee,
    sender: PublicKey.fromBase58(sender),
    nonce,
    memo,
  };
}

export function deserializeTinyTransaction(
  serializedTransaction: string,
  txNew: Mina.Transaction<false, false>
): Transaction<false, true> {
  //console.log("new transaction", txNew);
  const { tx, blindingValues, length } = JSON.parse(serializedTransaction);
  const transaction = Mina.Transaction.fromJSON(JSON.parse(tx));
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
      (
        transaction.transaction.accountUpdates[i].lazyAuthorization as any
      ).blindingValue = Field.fromJSON(blindingValues[i]);
  }
  return transaction;
}
