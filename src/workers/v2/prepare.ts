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
  zkCloudWorker,
  FungibleTokenDeployParams,
  blockchain,
} from "zkcloudworker";
import {
  testKeys as devnetKeys,
  tokenContractKey,
  adminContractKey,
  wallet,
} from "./config";

const { TestPublicKey } = Mina;
type TestPublicKey = Mina.TestPublicKey;
const chain = "devnet" as blockchain;

export async function prepare() {
  const symbol = "TEST";
  const name = "Test Token";
  const src = "https://minatokens.com";
  let keys: TestPublicKey[];
  let admin: TestPublicKey;
  let user1: TestPublicKey;
  let user2: TestPublicKey;
  let user3: TestPublicKey;
  let user4: TestPublicKey;
  const useRandomTokenAddress = true;

  let tokenKey = useRandomTokenAddress
    ? TestPublicKey.random()
    : tokenContractKey;
  let adminKey = useRandomTokenAddress
    ? TestPublicKey.random()
    : adminContractKey;
  const MINT_FEE = 1e8;
  const ISSUE_FEE = 1e9;
  const TRANSFER_FEE = 1e8;

  keys = devnetKeys;
  if (keys.length < 6) throw new Error("Invalid keys");
  let topup: TestPublicKey;
  [admin, user1, user2, user3, user4, topup] = keys;

  const version = "v1";
  console.log("deploying contract");
  console.time("deployed");

  //  We don't need to compile, just testing that compilation is working
  const cache: Cache = Cache.FileSystem("./cache");
  console.log("compiling v2");
  console.time("compiled");
  await FungibleTokenAdmin.compile({ cache });
  await FungibleToken.compile({ cache });
  console.timeEnd("compiled");

  // Change verification keys to match the previous o1js version
  const vk =
    fungibleTokenVerificationKeys[
      version === "v1"
        ? chain === "mainnet"
          ? "mainnet_v1"
          : "testnet_v1"
        : chain === "mainnet"
        ? "mainnet"
        : "testnet"
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
    { sender: admin, fee: 300_000_000, memo, nonce },
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

  const data: FungibleTokenDeployParams = {
    serializedTransaction,
    signedData,
    adminContractPublicKey: adminKey.toBase58(),
    tokenPublicKey: tokenKey.toBase58(),
    adminPublicKey: admin.toBase58(),
    chain,
    symbol,
    uri: src,
    sendTransaction: true,
  };
  return JSON.stringify(data);
}
