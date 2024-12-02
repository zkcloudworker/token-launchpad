import {
  zkCloudWorker,
  Cloud,
  sleep,
  fetchMinaAccount,
  accountBalanceMina,
  transactionParams,
  parseTransactionPayloads,
  TinyContract,
  TransactionMetadata,
} from "zkcloudworker";
import {
  TransactionPayloads,
  DeployTransaction,
  TokenTransaction,
  FungibleTokenTransactionType,
  JobResult,
} from "@minatokens/api";
import {
  FungibleToken,
  AdvancedFungibleToken,
  tokenContracts,
  tokenVerificationKeys,
  buildTokenDeployTransaction,
  buildTokenTransaction,
  LAUNCH_FEE,
  TRANSACTION_FEE,
} from "@minatokens/token";
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
const WALLET = process.env.WALLET;

interface TinyTransactionParams {
  chain: string;
  contractAddress: string;
  serializedTransaction: string;
  sender: string;
  value: number;
  sendTransaction: boolean;
}
export class TokenLauncherWorker extends zkCloudWorker {
  static verificationKeys: {
    [key: string]: VerificationKey;
  } = {};
  // static contractVerificationKey: VerificationKey | undefined = undefined;
  // static contractAdminVerificationKey: VerificationKey | undefined = undefined;
  // static offerVerificationKey: VerificationKey | undefined = undefined;
  // static bidVerificationKey: VerificationKey | undefined = undefined;
  // static whitelistedAdminVerificationKey: VerificationKey | undefined =
  //   undefined;
  // static whitelistedFungibleTokenVerificationKey: VerificationKey | undefined =
  //   undefined;
  readonly cache: Cache;

  constructor(cloud: Cloud) {
    super(cloud);
    this.cache = Cache.FileSystem(this.cloud.cache);
  }

  private async compile(params: {
    compileAdmin?: boolean;
    isAdvanced?: boolean;
    verificationKeyHashes: string[];
    // compileOffer?: boolean;
    // compileBid?: boolean;
  }): Promise<void> {
    const {
      compileAdmin = false,
      isAdvanced = false,
      verificationKeyHashes,
    } = params;
    try {
      console.time("compiled");
      const vk =
        tokenVerificationKeys[
          this.cloud.chain === "mainnet" ? "mainnet" : "testnet"
        ].vk;
      for (const hash of verificationKeyHashes) {
        const [key, item] =
          Object.entries(vk).find(([_, item]) => item.hash === hash) || [];
        if (!key) throw new Error(`Key not found for hash ${hash}`);
        if (!item) throw new Error(`Verification key for ${hash} not found`);
        switch (item.type) {
          case "token":
            if (isAdvanced) {
              const verificationKey = (
                await AdvancedFungibleToken.compile({
                  cache: this.cache,
                })
              ).verificationKey;
              if (verificationKey.hash.toJSON() !== hash)
                throw new Error(
                  `Verification key for ${key} (${hash}) does not match`
                );
              TokenLauncherWorker.verificationKeys.WhitelistedFungibleToken =
                verificationKey;
            } else {
              const verificationKey = (
                await FungibleToken.compile({
                  cache: this.cache,
                })
              ).verificationKey;
              if (verificationKey.hash.toJSON() !== hash)
                throw new Error(
                  `Verification key for ${key} (${hash}) does not match`
                );
              TokenLauncherWorker.verificationKeys.FungibleToken =
                verificationKey;
            }
            break;

          case "admin":
          case "user":
            const contract = tokenContracts[key];
            if (!contract) throw new Error(`Contract ${key} not found`);
            const verificationKey = (
              await contract.compile({
                cache: this.cache,
              })
            ).verificationKey;
            if (verificationKey.hash.toJSON() !== hash)
              throw new Error(
                `Verification key for ${key} (${hash}) does not match`
              );
            TokenLauncherWorker.verificationKeys[key] = verificationKey;
            break;

          case "upgrade":
            throw new Error(`Upgrade key ${key} (${hash}) not supported`);
        }
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
    const task = this.cloud.task as
      | FungibleTokenTransactionType
      | "launch"
      | "tiny";
    switch (task) {
      case "launch":
        return await this.launch(transactions[0]);

      case "transfer":
      case "mint":
      case "offer":
      case "bid":
      case "sell":
      case "buy":
      case "withdrawOffer":
      case "withdrawBid":
      case "updateBidWhitelist":
      case "updateOfferWhitelist":
      case "updateAdminWhitelist":
        return await this.transaction(transactions[0], task);

      case "tiny":
        return await this.tinyTx(transactions[0]);

      default:
        throw new Error(`Unknown task: ${this.cloud.task}`);
    }
  }

  private stringifyJobResult(result: JobResult): string {
    return JSON.stringify(result, null, 2);
  }

  private async launch(transaction: string): Promise<string> {
    const args: DeployTransaction = JSON.parse(transaction);
    if (
      args.adminContractAddress === undefined ||
      args.sender === undefined ||
      args.transaction === undefined ||
      args.signedData === undefined ||
      args.tokenAddress === undefined ||
      args.uri === undefined ||
      args.symbol === undefined
    ) {
      throw new Error("One or more required args are undefined");
    }
    const sendTransaction = args.sendTransaction ?? true;
    if (WALLET === undefined) throw new Error("WALLET is undefined");

    const contractAddress = PublicKey.fromBase58(args.tokenAddress);
    const whitelist = args.whitelist;
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

    console.time("prepared tx");
    const signedJson = JSON.parse(args.signedData);

    const { fee, sender, nonce, memo } = transactionParams(args);
    console.log("Admin (sender)", sender.toBase58());
    if (sender.toBase58() != args.sender) throw new Error("Invalid sender");

    const {
      tx: txNew,
      isAdvanced,
      verificationKeyHashes,
    } = await buildTokenDeployTransaction({
      adminType: args.adminType,
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
      whitelist: args.whitelist,
      decimals: UInt8.from(9),
      provingKey: PublicKey.fromBase58(WALLET),
      provingFee: UInt64.from(LAUNCH_FEE),
      developerAddress,
      developerFee,
    });
    const tx = parseTransactionPayloads({ payloads: args, txNew });

    if (tx === undefined) throw new Error("tx is undefined");
    await this.compile({
      compileAdmin: true,
      isAdvanced,
      verificationKeyHashes,
    });

    console.time("proved tx");
    const txProved = await tx.prove();
    const txJSON = txProved.toJSON();
    console.timeEnd("proved tx");
    console.timeEnd("prepared tx");

    try {
      if (!sendTransaction) {
        return this.stringifyJobResult({
          success: true,
          tx: txJSON,
        });
      }
      return await this.sendTokenTransaction({
        tx: txProved,
        txJSON,
        memo,
        metadata: {
          admin: sender.toBase58(),
          contractAddress: contractAddress.toBase58(),
          adminContractAddress: adminContractAddress.toBase58(),
          symbol: args.symbol,
          uri: args.uri,
          txType: "deploy",
        } as any,
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

  private async transaction(
    transaction: string,
    task: FungibleTokenTransactionType
  ): Promise<string> {
    const args: TokenTransaction = JSON.parse(transaction);
    const { txType, whitelist } = args;

    if (
      txType === undefined ||
      args.tokenAddress === undefined ||
      args.from === undefined ||
      args.to === undefined ||
      args.amount === undefined
    ) {
      throw new Error("One or more required args are undefined");
    }
    const sendTransaction = args.sendTransaction ?? true;
    if (WALLET === undefined) throw new Error("WALLET is undefined");
    if (txType !== task) throw new Error("txType does not match task");
    if (txType === "offer" || txType === "bid") {
      if (args.price === undefined) throw new Error("Price is required");
    }
    if (
      task === "sell" ||
      task === "buy" ||
      task === "offer" ||
      task === "bid"
    ) {
      if (args.amount === undefined) throw new Error("Amount is required");
    }

    const tokenAddress = PublicKey.fromBase58(args.tokenAddress);
    console.log(txType, "tx for", tokenAddress.toBase58());
    const from = PublicKey.fromBase58(args.from);
    const to = PublicKey.fromBase58(args.to);
    const amount = args.amount ? UInt64.from(args.amount) : undefined;
    const developerAddress = args.developerAddress
      ? PublicKey.fromBase58(args.developerAddress)
      : undefined;
    const developerFee = args.developerFee
      ? UInt64.from(args.developerFee)
      : undefined;
    const price = args.price ? UInt64.from(args.price) : undefined;

    console.time("prepared tx");

    const { fee, sender, nonce, memo } = transactionParams(args);

    const {
      tx: txNew,
      isAdvanced,
      verificationKeyHashes,
      symbol,
    } = await buildTokenTransaction({
      txType,
      sender,
      chain: this.cloud.chain,
      fee,
      nonce,
      memo,
      tokenAddress,
      whitelist,
      provingKey: PublicKey.fromBase58(WALLET),
      provingFee: UInt64.from(TRANSACTION_FEE),
      from,
      to,
      amount,
      price,
      developerAddress,
      developerFee,
    });

    const tx = parseTransactionPayloads({ payloads: args, txNew });
    if (tx === undefined) throw new Error("tx is undefined");

    const compileOffer = (
      [
        "offer",
        "buy",
        "withdrawOffer",
        "updateOfferWhitelist",
      ] satisfies FungibleTokenTransactionType[] as FungibleTokenTransactionType[]
    ).includes(txType);
    const compileBid = (
      [
        "bid",
        "sell",
        "withdrawBid",
        "updateBidWhitelist",
      ] satisfies FungibleTokenTransactionType[] as FungibleTokenTransactionType[]
    ).includes(txType);
    const compileAdmin = txType === "mint" || txType === "updateAdminWhitelist";
    await this.compile({
      compileAdmin,
      isAdvanced: isAdvanced && compileAdmin,
      verificationKeyHashes,
    });

    console.time("proved tx");
    console.log(`Proving ${txType} transaction...`);
    const txProved = await tx.prove();
    console.timeEnd("proved tx");
    const txJSON = txProved.toJSON();
    console.timeEnd("prepared tx");

    try {
      if (!sendTransaction) {
        return this.stringifyJobResult({
          success: true,
          tx: txJSON,
        });
      }
      return await this.sendTokenTransaction({
        tx: txProved,
        txJSON,
        memo,
        metadata: {
          type: txType,
          sender: sender.toBase58(),
          tokenAddress: tokenAddress.toBase58(),
          from: from.toBase58(),
          to: to.toBase58(),
          amount: amount?.toBigInt().toString(),
          price: args.price?.toString(),
          symbol,
        } as any,
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

  private async sendTokenTransaction(params: {
    tx: Transaction<true, true>;
    txJSON: string;
    memo: string;
    metadata: TransactionMetadata;
  }): Promise<string> {
    const { tx, txJSON, memo, metadata } = params;
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
        metadata,
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
