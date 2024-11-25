import {
  zkCloudWorker,
  Cloud,
  sleep,
  fetchMinaAccount,
  accountBalanceMina,
  // FungibleToken,
  // FungibleTokenAdmin,
  FungibleTokenDeployParams,
  FungibleTokenTransactionParams,
  FungibleTokenJobResult,
  transactionParams,
  deserializeTransaction,
  TinyContract,
  FungibleTokenTransactionType,
  fungibleTokenVerificationKeys,
  blockchain,
} from "zkcloudworker";
import {
  FungibleToken,
  WhitelistedFungibleToken,
  FungibleTokenAdmin,
  FungibleTokenWhitelistedAdmin,
} from "./token.js";
import { FungibleTokenOfferContract, offerVerificationKeys } from "./offer.js";
import {
  VerificationKey,
  PublicKey,
  Mina,
  Cache,
  UInt64,
  UInt8,
  Field,
  Transaction,
} from "o1js";
// import { WALLET } from "../env.json";
const WALLET: string = process.env.WALLET!;
import { buildTokenTransaction, buildTokenDeployTransaction } from "./build.js";
import { LAUNCH_FEE, TRANSACTION_FEE } from "./fee.js";

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
  static offerVerificationKey: VerificationKey | undefined = undefined;
  readonly cache: Cache;

  constructor(cloud: Cloud) {
    super(cloud);
    this.cache = Cache.FileSystem(this.cloud.cache);
  }

  private async compile(
    params: { compileAdmin?: boolean; compileOffer?: boolean } = {}
  ): Promise<void> {
    const { compileAdmin = false, compileOffer = false } = params;
    try {
      console.time("compiled");
      if (compileAdmin === true) {
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
      if (compileOffer === true) {
        console.time("compiled FungibleTokenOfferContract");
        TokenLauncherWorker.offerVerificationKey = (
          await FungibleTokenOfferContract.compile({
            cache: this.cache,
          })
        ).verificationKey;
        console.timeEnd("compiled FungibleTokenOfferContract");
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
    if (transactions.length === 0) throw new Error("transactions is empty");
    switch (this.cloud.task) {
      case "deploy":
        return await this.deploy(transactions[0]);

      case "transfer":
      case "mint":
      case "offer":
      case "bid":
      case "sell":
      case "buy":
      case "withdrawOffer":
      case "withdrawBid":
        return await this.transaction(transactions[0]);

      case "tiny":
        return await this.tinyTx(transactions[0]);

      default:
        throw new Error(`Unknown task: ${this.cloud.task}`);
    }
  }

  private stringifyJobResult(result: FungibleTokenJobResult): string {
    return JSON.stringify(result, null, 2);
  }

  private async deploy(transaction: string): Promise<string> {
    const args: FungibleTokenDeployParams = JSON.parse(transaction);
    if (
      args.adminContractAddress === undefined ||
      args.senderAddress === undefined ||
      args.chain === undefined ||
      args.serializedTransaction === undefined ||
      args.signedData === undefined ||
      args.tokenAddress === undefined ||
      args.uri === undefined ||
      args.symbol === undefined ||
      args.sendTransaction === undefined
    ) {
      throw new Error("One or more required args are undefined");
    }

    const contractAddress = PublicKey.fromBase58(args.tokenAddress);
    console.log("Contract", contractAddress.toBase58());
    const adminContractAddress = PublicKey.fromBase58(
      args.adminContractAddress
    );
    console.log("Admin Contract", adminContractAddress.toBase58());
    const developerAddress = args.developerAddress
      ? PublicKey.fromBase58(args.developerAddress)
      : undefined;
    const developerFee = args.developerFee
      ? UInt64.from(args.developerFee)
      : undefined;
    const vk =
      fungibleTokenVerificationKeys[
        this.cloud.chain === "mainnet" ? "mainnet" : "testnet"
      ];
    if (
      !vk ||
      !vk.admin.hash ||
      !vk.admin.data ||
      !vk.token.hash ||
      !vk.token.data
    )
      throw new Error("Cannot get token verification keys");

    await this.compile({ compileAdmin: true });
    if (
      TokenLauncherWorker.contractAdminVerificationKey?.hash.toJSON() !==
        vk.admin.hash ||
      TokenLauncherWorker.contractVerificationKey?.hash.toJSON() !==
        vk.token.hash ||
      TokenLauncherWorker.contractAdminVerificationKey?.data !==
        vk.admin.data ||
      TokenLauncherWorker.contractVerificationKey?.data !== vk.token.data
    )
      throw new Error("Contract verification keys are undefined");

    console.time("prepared tx");
    const signedJson = JSON.parse(args.signedData);

    const { fee, sender, nonce, memo } = transactionParams(
      args.serializedTransaction,
      signedJson
    );
    console.log("Admin (sender)", sender.toBase58());

    if (sender.toBase58() != args.senderAddress)
      throw new Error("Invalid sender");
    if (
      TokenLauncherWorker.contractAdminVerificationKey === undefined ||
      TokenLauncherWorker.contractVerificationKey === undefined
    )
      throw new Error("Contract verification keys are undefined");
    const txNew = await buildTokenDeployTransaction({
      chain: this.cloud.chain,
      fee,
      sender,
      nonce,
      memo,
      tokenAddress: contractAddress,
      adminContractAddress,
      adminAddress: sender,
      uri: args.uri,
      symbol: args.symbol,
      decimals: UInt8.from(9),
      provingKey: PublicKey.fromBase58(WALLET),
      provingFee: UInt64.from(LAUNCH_FEE),
      developerAddress,
      developerFee,
    });
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
            adminContractAddress: adminContractAddress.toBase58(),
            symbol: args.symbol,
            uri: args.uri,
            txType: "deploy",
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

  private async transaction(transaction: string): Promise<string> {
    const args: FungibleTokenTransactionParams = JSON.parse(transaction);
    const {
      txType,
      serializedTransaction,
      signedData,
      sendTransaction,
      symbol,
    } = args;

    if (
      txType === undefined ||
      args.tokenAddress === undefined ||
      serializedTransaction === undefined ||
      signedData === undefined ||
      args.from === undefined ||
      args.to === undefined ||
      args.amount === undefined
    ) {
      throw new Error("One or more required args are undefined");
    }

    if (txType === "offer" || txType === "bid") {
      if (args.price === undefined) throw new Error("Price is required");
    }

    const tokenAddress = PublicKey.fromBase58(args.tokenAddress);
    console.log(txType, "tx for", tokenAddress.toBase58());
    const from = PublicKey.fromBase58(args.from);
    const to = PublicKey.fromBase58(args.to);
    const amount = UInt64.from(args.amount);
    const developerAddress = args.developerAddress
      ? PublicKey.fromBase58(args.developerAddress)
      : undefined;
    const developerFee = args.developerFee
      ? UInt64.from(args.developerFee)
      : undefined;
    const price = args.price ? UInt64.from(args.price) : undefined;
    const compileOffer = (
      [
        "offer",
        "buy",
        "withdrawOffer",
      ] satisfies FungibleTokenTransactionType[] as FungibleTokenTransactionType[]
    ).includes(txType);
    await this.compile({
      compileOffer,
      compileAdmin: txType === "mint",
    });
    if (compileOffer) {
      const vk =
        offerVerificationKeys[
          this.cloud.chain === "mainnet" ? "mainnet" : "testnet"
        ];
      if (!vk || !vk.hash || !vk.data)
        throw new Error("Cannot get offer verification key");
      if (
        TokenLauncherWorker.offerVerificationKey?.hash.toJSON() !== vk.hash ||
        TokenLauncherWorker.offerVerificationKey?.data !== vk.data
      )
        console.log("Invalid offer verification key");
      //throw new Error("Invalid offer verification key");
    }

    console.time("prepared tx");
    const signedJson = JSON.parse(args.signedData);
    const { fee, sender, nonce, memo } = transactionParams(
      args.serializedTransaction,
      signedJson
    );
    const txNew = await buildTokenTransaction({
      txType,
      chain: this.cloud.chain,
      fee,
      sender,
      nonce,
      memo,
      tokenAddress,
      provingKey: PublicKey.fromBase58(WALLET),
      provingFee: UInt64.from(TRANSACTION_FEE),
      from,
      to,
      amount,
      price,
      developerAddress,
      developerFee,
    });

    const tx = deserializeTransaction(
      args.serializedTransaction,
      txNew,
      signedJson
    );
    if (tx === undefined) throw new Error("tx is undefined");

    console.time("proved tx");
    console.log(`Proving ${txType} transaction...`);
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
            type: txType,
            sender: sender.toBase58(),
            tokenAddress: tokenAddress.toBase58(),
            from: from.toBase58(),
            to: to.toBase58(),
            amount: amount.toBigInt().toString(),
            price: args.price?.toString(),
            symbol,
          } as any,
        });
      return this.stringifyJobResult({
        success:
          txSent?.hash !== undefined && txSent?.status == "pending"
            ? true
            : false,
        tx: txJSON,
        hash: txSent?.hash,
        error:
          txSent?.errors && txSent?.errors?.length > 0
            ? String(txSent?.errors?.join(", "))
            : undefined,
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
