import {
  AccountUpdate,
  DeployArgs,
  method,
  Permissions,
  PublicKey,
  State,
  state,
  UInt64,
  SmartContract,
  Bool,
  assert,
  Field,
} from "o1js";
import { FungibleToken, Whitelist, Storage } from "zkcloudworker";

export const offerVerificationKeys = {
  testnet: {
    hash: "4954765067587142919084688219968636509370827765119202550552552573710814437344",
    data: "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",
  },

  mainnet: {
    hash: undefined,
    data: undefined,
  },
};
export interface FungibleTokenOfferContractDeployProps
  extends Exclude<DeployArgs, undefined> {
  /** The whitelist. */
  // whitelist: Whitelist;
}
export class FungibleTokenOfferContract extends SmartContract {
  @state(UInt64) price = State<UInt64>();
  @state(PublicKey) seller = State<PublicKey>();
  @state(PublicKey) token = State<PublicKey>();
  // @state(Whitelist) whitelist = State<Whitelist>();

  async deploy(args: FungibleTokenOfferContractDeployProps) {
    await super.deploy(args);
    const verificationKey =
      args?.verificationKey ?? FungibleTokenOfferContract._verificationKey;
    assert(verificationKey !== undefined);
    // const hash =
    //   typeof verificationKey.hash === "string"
    //     ? verificationKey.hash
    //     : verificationKey.hash.toJSON();
    // const networkId = Mina.getNetworkId();
    // assert(networkId === "mainnet" || networkId === "testnet");
    // assert(hash === offerVerificationKeys[networkId].hash);
    // assert(verificationKey.data === offerVerificationKeys[networkId].data);
    // this.whitelist.set(args.whitelist);
    this.account.permissions.set({
      ...Permissions.default(),
      send: Permissions.proof(),
      setVerificationKey:
        Permissions.VerificationKey.impossibleDuringCurrentVersion(),
      setPermissions: Permissions.impossible(),
    });
  }

  events = {
    offer: UInt64,
    withdraw: UInt64,
    buy: UInt64,
  };

  @method async initialize(token: PublicKey, amount: UInt64, price: UInt64) {
    this.account.provedState.requireEquals(Bool(false));
    const tokenContract = new FungibleToken(token);
    const tokenId = tokenContract.deriveTokenId();
    tokenId.assertEquals(this.tokenId);
    const seller = this.sender.getUnconstrained();
    const sellerUpdate = AccountUpdate.createSigned(seller);
    sellerUpdate.body.useFullCommitment = Bool(true);
    await tokenContract.transfer(seller, this.address, amount);

    this.seller.set(seller);
    this.price.set(price);
    this.token.set(token);
    this.emitEvent("offer", amount);
  }

  @method async offer(amount: UInt64, price: UInt64) {
    const seller = this.seller.getAndRequireEquals();
    const token = this.token.getAndRequireEquals();
    const tokenContract = new FungibleToken(token);
    const tokenId = tokenContract.deriveTokenId();
    tokenId.assertEquals(this.tokenId);

    const balance = this.account.balance.getAndRequireEquals();
    const oldPrice = this.price.getAndRequireEquals();
    // Price can be changed only when the balance is 0
    price
      .equals(oldPrice)
      .or(balance.equals(UInt64.from(0)))
      .assertTrue();
    this.price.set(price);

    const sender = this.sender.getUnconstrained();
    const senderUpdate = AccountUpdate.createSigned(sender);
    senderUpdate.body.useFullCommitment = Bool(true);
    sender.assertEquals(seller);

    await tokenContract.transfer(sender, this.address, amount);
    this.emitEvent("offer", amount);
  }

  @method async withdraw(amount: UInt64) {
    amount.equals(UInt64.from(0)).assertFalse();
    this.account.balance.requireBetween(amount, UInt64.MAXINT());

    const seller = this.seller.getAndRequireEquals();
    const token = this.token.getAndRequireEquals();
    const tokenContract = new FungibleToken(token);
    const tokenId = tokenContract.deriveTokenId();
    tokenId.assertEquals(this.tokenId);

    const sender = this.sender.getUnconstrained();
    const senderUpdate = AccountUpdate.createSigned(sender, tokenId);
    senderUpdate.body.useFullCommitment = Bool(true);
    sender.assertEquals(seller);

    let offerUpdate = this.send({ to: senderUpdate, amount });
    offerUpdate.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    offerUpdate.body.useFullCommitment = Bool(true);
    this.emitEvent("withdraw", amount);
  }

  @method async buy(amount: UInt64) {
    amount.equals(UInt64.from(0)).assertFalse();
    this.account.balance.requireBetween(amount, UInt64.MAXINT());
    const seller = this.seller.getAndRequireEquals();
    const token = this.token.getAndRequireEquals();
    const tokenContract = new FungibleToken(token);
    const tokenId = tokenContract.deriveTokenId();
    tokenId.assertEquals(this.tokenId);
    const price = this.price.getAndRequireEquals();
    const totalPriceField = price.value
      .mul(amount.value)
      .div(Field(1_000_000_000));
    totalPriceField.assertLessThan(
      UInt64.MAXINT().value,
      "totalPrice overflow"
    );
    const totalPrice = UInt64.Unsafe.fromField(totalPriceField);

    const buyer = this.sender.getUnconstrained();
    const buyerUpdate = AccountUpdate.createSigned(buyer);
    buyerUpdate.send({ to: seller, amount: totalPrice });
    buyerUpdate.body.useFullCommitment = Bool(true);

    let offerUpdate = this.send({ to: buyer, amount });
    offerUpdate.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    offerUpdate.body.useFullCommitment = Bool(true);

    // const whitelist = this.whitelist.getAndRequireEquals();
    // const whitelistedAmount = await whitelist.getWhitelistedAmount(buyer);
    // amount.assertLessThanOrEqual(whitelistedAmount.assertSome());

    this.emitEvent("buy", amount);
  }
}
