import {
  fetchMinaAccount,
  accountBalanceMina,
  FungibleTokenTransactionType,
  blockchain,
  fungibleTokenVerificationKeys,
  Whitelist,
  WhitelistedAddressList,
} from "zkcloudworker";
import {
  FungibleToken,
  WhitelistedFungibleToken,
  FungibleTokenAdmin,
  FungibleTokenWhitelistedAdmin,
} from "./token.js";
import { FungibleTokenOfferContract, offerVerificationKeys } from "./offer.js";
import {
  PublicKey,
  Mina,
  AccountUpdate,
  UInt64,
  UInt8,
  Bool,
  Transaction,
  Struct,
  VerificationKey,
  Field,
} from "o1js";

export async function buildTokenDeployTransaction(params: {
  chain: blockchain;
  fee: UInt64;
  sender: PublicKey;
  nonce: number;
  memo: string;
  tokenAddress: PublicKey;
  adminContractAddress: PublicKey;
  adminAddress: PublicKey;
  uri: string;
  symbol: string;
  developerAddress?: PublicKey;
  developerFee?: UInt64;
  provingKey: PublicKey;
  provingFee: UInt64;
  decimals: UInt8;
  whitelist?: WhitelistedAddressList;
}): Promise<Transaction<false, false>> {
  const {
    fee,
    sender,
    nonce,
    memo,
    tokenAddress,
    adminContractAddress,
    uri,
    symbol,
    developerAddress,
    developerFee,
    provingKey,
    provingFee,
    decimals,
    chain,
    whitelist,
  } = params;
  const vk =
    fungibleTokenVerificationKeys[chain === "mainnet" ? "mainnet" : "testnet"];
  if (!vk || !vk.admin.hash || !vk.admin.data)
    throw new Error("Cannot get admin verification key");
  if (!vk.token.hash || !vk.token.data)
    throw new Error("Cannot get token verification key");
  const adminVerificationKey = {
    hash: Field(vk.admin.hash),
    data: vk.admin.data,
  };
  const tokenVerificationKey = {
    hash: Field(vk.token.hash),
    data: vk.token.data,
  };
  await fetchMinaAccount({
    publicKey: sender,
    force: true,
  });

  if (!Mina.hasAccount(sender)) {
    throw new Error("Sender does not have account");
  }

  console.log("Sender balance:", await accountBalanceMina(sender));
  const whitelistedAddresses = whitelist
    ? Whitelist.create({ list: whitelist, name: symbol })
    : undefined;

  // const FungibleToken = FungibleTokenContract(FungibleTokenAdmin);
  const zkToken = new FungibleToken(tokenAddress);
  const zkAdmin = new FungibleTokenAdmin(adminContractAddress);

  const tx = await Mina.transaction({ sender, fee, memo, nonce }, async () => {
    const feeAccountUpdate = AccountUpdate.createSigned(sender);
    feeAccountUpdate.balance.subInPlace(3_000_000_000);
    feeAccountUpdate.send({
      to: provingKey,
      amount: provingFee,
    });
    if (developerAddress && developerFee) {
      feeAccountUpdate.send({
        to: developerAddress,
        amount: developerFee,
      });
    }
    await zkAdmin.deploy({
      adminPublicKey: sender,
      verificationKey: adminVerificationKey,
    });
    zkAdmin.account.zkappUri.set(uri);
    await zkToken.deploy({
      symbol,
      src: uri,
      verificationKey: tokenVerificationKey,
    });
    await zkToken.initialize(
      adminContractAddress,
      decimals,
      // We can set `startPaused` to `Bool(false)` here, because we are doing an atomic deployment
      // If you are not deploying the admin and token contracts in the same transaction,
      // it is safer to start the tokens paused, and resume them only after verifying that
      // the admin contract has been deployed
      Bool(false)
    );
  });
  return tx;
}

export async function buildTokenTransaction(params: {
  txType: FungibleTokenTransactionType;
  chain: blockchain;
  fee: UInt64;
  sender: PublicKey;
  nonce: number;
  memo: string;
  tokenAddress: PublicKey;
  from: PublicKey;
  to: PublicKey;
  amount: UInt64;
  price?: UInt64;
  developerAddress?: PublicKey;
  developerFee?: UInt64;
  provingKey: PublicKey;
  provingFee: UInt64;
}): Promise<Transaction<false, false>> {
  const {
    txType,
    chain,
    fee,
    sender,
    nonce,
    memo,
    tokenAddress,
    from,
    to,
    amount,
    price,
    developerAddress,
    developerFee,
    provingKey,
    provingFee,
  } = params;
  console.log(txType, "tx for", tokenAddress.toBase58());
  const zkToken = new FungibleToken(tokenAddress);
  const tokenId = zkToken.deriveTokenId();
  console.log("Sender:", sender.toBase58());

  // direction of the transaction is how the token is moving
  if (
    txType === "offer" ||
    txType === "mint" ||
    txType === "transfer" ||
    txType === "sell"
  ) {
    if (sender.toBase58() != from.toBase58()) throw new Error("Invalid sender");
  }
  if (
    txType === "bid" ||
    txType === "buy" ||
    txType === "withdrawOffer" ||
    txType === "withdrawBid" // direction is money direction as no token is moving
  ) {
    if (sender.toBase58() != to.toBase58()) throw new Error("Invalid sender");
  }

  await fetchMinaAccount({
    publicKey: sender,
    force: true,
  });

  if (!Mina.hasAccount(sender)) {
    console.error("Sender does not have account");
    throw new Error("Sender does not have account");
  }

  const { tokenSymbol, adminContractAddress, adminAddress } =
    await getTokenSymbolAndAdmin({
      tokenAddress,
    });

  if (txType === "mint" && adminAddress.toBase58() !== sender.toBase58())
    throw new Error("Invalid sender for mint");

  await fetchMinaAccount({
    publicKey: tokenAddress,
    tokenId,
    force: true,
  });
  await fetchMinaAccount({
    publicKey: from,
    tokenId,
    force: (
      [
        "offer",
        "sell",
        "transfer",
        "withdrawOffer",
      ] satisfies FungibleTokenTransactionType[] as FungibleTokenTransactionType[]
    ).includes(txType),
  });

  await fetchMinaAccount({
    publicKey: to,
    tokenId,
    force: (
      [
        "sell",
      ] satisfies FungibleTokenTransactionType[] as FungibleTokenTransactionType[]
    ).includes(txType),
  });

  const isNewAccount = Mina.hasAccount(to, tokenId) === false;
  const offerContract = new FungibleTokenOfferContract(
    txType === "offer" ? to : from,
    tokenId
  );
  const offerContractDeployment = new FungibleTokenOfferContract(to, tokenId);
  const vk = offerVerificationKeys[chain === "mainnet" ? "mainnet" : "testnet"];
  if (!vk || !vk.hash || !vk.data)
    throw new Error("Cannot get offer verification key");
  const offerVerificationKey = FungibleTokenOfferContract._verificationKey ?? {
    hash: Field(vk.hash),
    data: vk.data,
  };

  console.log("Sender balance:", await accountBalanceMina(sender));
  console.log("New account:", isNewAccount);

  const tx = await Mina.transaction({ sender, fee, memo, nonce }, async () => {
    const feeAccountUpdate = AccountUpdate.createSigned(sender);
    if (isNewAccount) {
      feeAccountUpdate.balance.subInPlace(1_000_000_000);
    }
    feeAccountUpdate.send({
      to: provingKey,
      amount: provingFee,
    });
    if (developerAddress && developerFee) {
      feeAccountUpdate.send({
        to: developerAddress,
        amount: developerFee,
      });
    }
    switch (txType) {
      case "mint":
        await zkToken.mint(to, amount);
        break;

      case "transfer":
        await zkToken.transfer(from, to, amount);
        break;

      case "offer":
        if (price === undefined) throw new Error("Error: Price is required");
        if (isNewAccount) {
          await offerContractDeployment.deploy({
            verificationKey: offerVerificationKey,
            whitelist: Whitelist.empty(),
          });
          offerContract.account.zkappUri.set(`Offer for ${tokenSymbol}`);
          await offerContract.initialize(sender, tokenAddress, amount, price);
          await zkToken.approveAccountUpdates([
            offerContractDeployment.self,
            offerContract.self,
          ]);
        } else {
          await offerContract.offer(amount, price);
          await zkToken.approveAccountUpdate(offerContract.self);
        }

        break;

      case "buy":
        await offerContract.buy(amount);
        await zkToken.approveAccountUpdate(offerContract.self);
        break;

      case "withdrawOffer":
        await offerContract.withdraw(amount);
        await zkToken.approveAccountUpdate(offerContract.self);
        break;

      default:
        throw new Error(`Unknown transaction type: ${txType}`);
    }
  });
  return tx;
}

export async function getTokenSymbolAndAdmin(params: {
  tokenAddress: PublicKey;
}): Promise<{
  adminContractAddress: PublicKey;
  adminAddress: PublicKey;
  tokenSymbol: string;
}> {
  const { tokenAddress } = params;
  class FungibleTokenState extends Struct({
    decimals: UInt8,
    admin: PublicKey,
    paused: Bool,
  }) {}
  const FungibleTokenStateSize = FungibleTokenState.sizeInFields();
  class FungibleTokenAdminState extends Struct({
    adminPublicKey: PublicKey,
  }) {}
  const FungibleTokenAdminStateSize = FungibleTokenAdminState.sizeInFields();

  await fetchMinaAccount({ publicKey: tokenAddress, force: true });
  if (!Mina.hasAccount(tokenAddress)) {
    throw new Error("Token contract account not found");
  }

  const account = Mina.getAccount(tokenAddress);
  if (account.zkapp?.appState === undefined) {
    throw new Error("Token contract state not found");
  }

  const state = FungibleTokenState.fromFields(
    account.zkapp?.appState.slice(0, FungibleTokenStateSize)
  );
  const tokenSymbol = account.tokenSymbol;
  const adminContractPublicKey = state.admin;
  await fetchMinaAccount({
    publicKey: adminContractPublicKey,
    force: true,
  });
  if (!Mina.hasAccount(adminContractPublicKey)) {
    throw new Error("Admin contract account not found");
  }

  const adminContract = Mina.getAccount(adminContractPublicKey);
  const adminAddress0 = adminContract.zkapp?.appState[0];
  const adminAddress1 = adminContract.zkapp?.appState[1];
  if (adminAddress0 === undefined || adminAddress1 === undefined) {
    throw new Error("Cannot fetch admin address from admin contract");
  }
  const adminAddress = PublicKey.fromFields([adminAddress0, adminAddress1]);

  return {
    adminContractAddress: adminContractPublicKey,
    adminAddress: adminAddress,
    tokenSymbol,
  };
}
