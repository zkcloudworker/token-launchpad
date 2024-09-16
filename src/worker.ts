import {
  zkCloudWorker,
  Cloud,
  fee,
  sleep,
  fetchMinaAccount,
  accountBalanceMina,
} from "zkcloudworker";
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
} from "o1js";
import { FungibleToken } from "./FungibleToken";
import { FungibleTokenAdmin } from "./FungibleTokenAdmin";
import { WALLET } from "../env.json";
const MINT_FEE = 1e8;
const ISSUE_FEE = 1e9;

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
    if (this.cloud.args === undefined)
      throw new Error("this.cloud.args is undefined");
    const args = JSON.parse(this.cloud.args);

    switch (this.cloud.task) {
      case "transfer":
        return await this.transferTx(args);

      case "mint":
        return await this.mintTx(args);

      case "deploy":
        return await this.deployTx(args);

      default:
        throw new Error(`Unknown task: ${this.cloud.task}`);
    }
  }

  private async deployTx(args: {
    contractPrivateKey: string;
    adminPrivateString: string;
    adminContractPrivateKey: string;
    symbol: string;
    uri: string;
  }): Promise<string> {
    if (args.adminPrivateString === undefined)
      throw new Error("args.adminPrivateString is undefined");
    if (args.adminContractPrivateKey === undefined)
      throw new Error("args.adminContractPrivateKey is undefined");
    if (args.contractPrivateKey === undefined)
      throw new Error("args.contractPrivateKey is undefined");
    if (args.uri === undefined) throw new Error("args.uri is undefined");
    if (args.symbol === undefined) throw new Error("args.symbol is undefined");

    const privateKey = PrivateKey.fromBase58(args.adminPrivateString);
    const sender = privateKey.toPublicKey();
    console.log("Admin (sender)", sender.toBase58());
    const contractPrivateKey = PrivateKey.fromBase58(args.contractPrivateKey);
    const contractAddress = contractPrivateKey.toPublicKey();
    console.log("Contract", contractAddress.toBase58());
    const adminContractPrivateKey = PrivateKey.fromBase58(
      args.adminContractPrivateKey
    );
    const adminContractPublicKey = adminContractPrivateKey.toPublicKey();
    console.log("Admin Contract", adminContractPublicKey.toBase58());
    const wallet = PublicKey.fromBase58(WALLET);
    const zkToken = new FungibleToken(contractAddress);
    const zkAdmin = new FungibleTokenAdmin(adminContractPublicKey);
    await this.compile({ compileAdmin: true });

    console.log(`Sending tx...`);
    console.time("prepared tx");
    const memo = "deploy token";

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
    const isNewWallet = Mina.hasAccount(wallet) ? false : true;

    console.log("Sender balance:", await accountBalanceMina(sender));

    const tx = await Mina.transaction(
      { sender, fee: await fee(), memo },
      async () => {
        AccountUpdate.fundNewAccount(sender, 3 + (isNewWallet ? 1 : 0));
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
    await tx.prove();
    tx.sign([privateKey, contractPrivateKey, adminContractPrivateKey]);

    if (tx === undefined) throw new Error("tx is undefined");
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
          console.log(
            `${memo} tx sent: hash: ${txSent.hash} status: ${txSent.status}`
          );
        } else if (this.cloud.chain === "zeko") {
          console.log("Retrying Zeko tx");
          await sleep(10000);
        } else {
          console.log(
            `${memo} tx NOT sent: hash: ${txSent?.hash} status: ${txSent?.status}`
          );
          return "Error sending transaction";
        }
      }
      if (this.cloud.isLocalCloud && txSent?.status === "pending") {
        const txIncluded = await txSent.safeWait();
        console.log(
          `${memo} tx included into block: hash: ${txIncluded.hash} status: ${txIncluded.status}`
        );
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
          } as any,
        });
      return txSent?.hash ?? "Error sending transaction";
    } catch (error) {
      console.error("Error sending transaction", error);
      return "Error sending transaction";
    }
  }

  private async transferTx(args: {
    amount: number;
    contractAddress: string;
    from: string;
    to: string;
  }): Promise<string> {
    if (args.amount === undefined) throw new Error("args.amount is undefined");
    if (args.contractAddress === undefined)
      throw new Error("args.contractAddress is undefined");
    if (args.from === undefined) throw new Error("args.from is undefined");
    if (args.to === undefined) throw new Error("args.to is undefined");

    const privateKey = PrivateKey.fromBase58(args.from);
    const sender = privateKey.toPublicKey();
    console.log("Sender", sender.toBase58());
    const receiver = PublicKey.fromBase58(args.to);
    console.log("Receiver", receiver.toBase58());
    const contractAddress = PublicKey.fromBase58(args.contractAddress);
    console.log("Contract", contractAddress.toBase58());
    const amount = UInt64.from(args.amount);
    console.log("Amount", amount.toBigInt().toString());
    const zkApp = new FungibleToken(contractAddress);
    await this.compile();

    console.log(`Sending tx...`);
    console.time("prepared tx");
    const memo = "send token";
    const tokenId = zkApp.deriveTokenId();

    await fetchMinaAccount({
      publicKey: contractAddress,
      force: true,
    });
    await fetchMinaAccount({
      publicKey: sender,
      force: true,
    });
    await fetchMinaAccount({
      publicKey: sender,
      tokenId,
      force: true,
    });

    await fetchMinaAccount({
      publicKey: receiver,
      tokenId,
      force: false,
    });

    const isNewAccount = Mina.hasAccount(receiver, tokenId) ? false : true;
    if (!Mina.hasAccount(contractAddress)) {
      console.error("Contract does not have account");
      return "Contract does not have account";
    }
    if (!Mina.hasAccount(sender, tokenId)) {
      console.error("Sender does not have account for this token");
      return "Sender does not have account for this token";
    }
    if (!Mina.hasAccount(sender)) {
      console.error("Sender does not have account");
      return "Sender does not have account";
    }

    console.log("Sender balance:", await accountBalanceMina(sender));

    const tx = await Mina.transaction(
      {
        sender,
        memo,
        fee: await fee(),
      },
      async () => {
        if (isNewAccount) {
          AccountUpdate.fundNewAccount(sender);
        }
        await zkApp.transfer(sender, receiver, amount);
      }
    );

    if (tx === undefined) throw new Error("tx is undefined");
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
          console.log(
            `${memo} tx sent: hash: ${txSent.hash} status: ${txSent.status}`
          );
        } else if (this.cloud.chain === "zeko") {
          console.log("Retrying Zeko tx");
          await sleep(10000);
        } else {
          console.log(
            `${memo} tx NOT sent: hash: ${txSent?.hash} status: ${txSent?.status}`
          );
          return "Error sending transaction";
        }
      }
      if (this.cloud.isLocalCloud && txSent?.status === "pending") {
        const txIncluded = await txSent.safeWait();
        console.log(
          `${memo} tx included into block: hash: ${txIncluded.hash} status: ${txIncluded.status}`
        );
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
          } as any,
        });
      return txSent?.hash ?? "Error sending transaction";
    } catch (error) {
      console.error("Error sending transaction", error);
      return "Error sending transaction";
    }
  }

  private async mintTx(args: {
    amount: number;
    contractAddress: string;
    to: string;
    adminPrivateKey: string;
  }): Promise<string> {
    if (args.amount === undefined) throw new Error("args.amount is undefined");
    if (args.contractAddress === undefined)
      throw new Error("args.contractAddress is undefined");
    if (args.adminPrivateKey === undefined)
      throw new Error("args.from is undefined");
    if (args.to === undefined) throw new Error("args.to is undefined");

    const privateKey = PrivateKey.fromBase58(args.adminPrivateKey);
    const sender = privateKey.toPublicKey();
    console.log("Sender", sender.toBase58());
    const receiver = PublicKey.fromBase58(args.to);
    console.log("Receiver", receiver.toBase58());
    const contractAddress = PublicKey.fromBase58(args.contractAddress);
    console.log("Contract", contractAddress.toBase58());
    const amount = UInt64.from(args.amount);
    console.log("Amount", amount.toBigInt().toString());
    const wallet = PublicKey.fromBase58(WALLET);
    const zkApp = new FungibleToken(contractAddress);
    await this.compile({ compileAdmin: true });

    console.log(`Sending tx...`);
    console.time("prepared tx");
    const memo = "mint token";
    const tokenId = zkApp.deriveTokenId();

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
      publicKey: sender,
      force: true,
    });
    await fetchMinaAccount({
      publicKey: wallet,
    });

    await fetchMinaAccount({
      publicKey: receiver,
      tokenId,
      force: false,
    });

    const zkAdminAddress = zkApp.admin.get();
    if (zkAdminAddress === undefined) {
      console.error("Admin address is undefined");
      return "Admin address is undefined";
    }
    await fetchMinaAccount({
      publicKey: zkAdminAddress,
      force: true,
    });

    //const zkAdmin = new FungibleTokenAdmin(zkAdminAddress);

    const isNewAccount = Mina.hasAccount(receiver, tokenId) ? false : true;
    const isNewWallet = Mina.hasAccount(wallet) ? false : true;
    const newAccountsCount = (isNewAccount ? 1 : 0) + (isNewWallet ? 1 : 0);
    if (!Mina.hasAccount(contractAddress)) {
      console.error("Contract does not have account");
      return "Contract does not have account";
    }
    if (!Mina.hasAccount(contractAddress, tokenId)) {
      console.error("Contract does not have account for this token");
      return "Contract does not have account for this token";
    }
    if (!Mina.hasAccount(sender)) {
      console.error("Sender does not have account");
      return "Sender does not have account";
    }
    if (!Mina.hasAccount(zkAdminAddress)) {
      console.error("Admin contract does not have account");
      return "Admin contract does not have account";
    }

    console.log("Sender balance:", await accountBalanceMina(sender));

    const tx = await Mina.transaction(
      {
        sender,
        memo,
        fee: await fee(),
      },
      async () => {
        if (newAccountsCount > 0) {
          AccountUpdate.fundNewAccount(sender, newAccountsCount);
        }
        const provingFee = AccountUpdate.createSigned(sender);
        provingFee.send({
          to: PublicKey.fromBase58(WALLET),
          amount: UInt64.from(MINT_FEE),
        });
        await zkApp.mint(receiver, amount);
      }
    );

    if (tx === undefined) throw new Error("tx is undefined");
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
          console.log(
            `${memo} tx sent: hash: ${txSent.hash} status: ${txSent.status}`
          );
        } else if (this.cloud.chain === "zeko") {
          console.log("Retrying Zeko tx");
          await sleep(10000);
        } else {
          console.log(
            `${memo} tx NOT sent: hash: ${txSent?.hash} status: ${txSent?.status}`
          );
          return "Error sending transaction";
        }
      }
      if (this.cloud.isLocalCloud && txSent?.status === "pending") {
        const txIncluded = await txSent.safeWait();
        console.log(
          `${memo} tx included into block: hash: ${txIncluded.hash} status: ${txIncluded.status}`
        );
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
          } as any,
        });
      return txSent?.hash ?? "Error sending transaction";
    } catch (error) {
      console.error("Error sending transaction", error);
      return "Error sending transaction";
    }
  }
}
