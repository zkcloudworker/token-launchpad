import {
  AccountUpdate,
  assert,
  Bool,
  DeployArgs,
  method,
  Permissions,
  Provable,
  PublicKey,
  SmartContract,
  State,
  state,
  VerificationKey,
  Field,
  UInt64,
} from "o1js";
import { Whitelist } from "./whitelist";
import {
  FungibleTokenAdminBase
  FungibleToken,
  Storage,
  loadIndexedMerkleMap,
  createIpfsURL,
} from "zkcloudworker";

// TODO: check Gregor's code for generating contracts

export interface WhitelistedFungibleTokenAdminDeployProps
  extends Exclude<DeployArgs, undefined> {
  adminPublicKey: PublicKey;
  /** The root hash of the Merkle tree representing the whitelist. */
  whitelistRoot: Field;
  /** Off-chain storage information, typically an IPFS hash pointing to the whitelist data. */
  storage: Storage;
}

/** A contract that grants permissions for administrative actions on a token.
 *
 * We separate this out into a dedicated contract. That way, when issuing a token, a user can
 * specify their own rules for administrative actions, without changing the token contract itself.
 *
 * The advantage is that third party applications that only use the token in a non-privileged way
 * can integrate against the unchanged token contract.
 */
export class WhitelistedFungibleTokenAdmin
  extends SmartContract
  implements FungibleTokenAdminBase
{
  @state(PublicKey) adminPublicKey = State<PublicKey>();
  @state(Field) whitelistRoot = State<Field>();
  @state(Storage) storage = State<Storage>();

  async deploy(props: WhitelistedFungibleTokenAdminDeployProps) {
    await super.deploy(props);
    this.adminPublicKey.set(props.adminPublicKey);
    this.whitelistRoot.set(props.whitelistRoot);
    this.storage.set(props.storage);
    this.account.permissions.set({
      ...Permissions.default(),
      setVerificationKey:
        Permissions.VerificationKey.impossibleDuringCurrentVersion(),
      setPermissions: Permissions.impossible(),
    });
  }

  /** Update the verification key.
   * Note that because we have set the permissions for setting the verification key to `impossibleDuringCurrentVersion()`, this will only be possible in case of a protocol update that requires an update.
   */
  @method
  async updateVerificationKey(vk: VerificationKey) {
    this.account.verificationKey.set(vk);
  }

  private async ensureAdminSignature() {
    const admin = await Provable.witnessAsync(PublicKey, async () => {
      let pk = await this.adminPublicKey.fetch();
      assert(pk !== undefined, "could not fetch admin public key");
      return pk;
    });
    this.adminPublicKey.requireEquals(admin);
    return AccountUpdate.createSigned(admin);
  }

  @method.returns(Bool)
  public async canMint(accountUpdate: AccountUpdate) {
    accountUpdate.body.useFullCommitment = Bool(true);
    const publicKey = accountUpdate.body.publicKey;
    const amount = accountUpdate.body.balanceChange;
    amount.isPositive().assertTrue();
    const amountUInt64 = amount.magnitude;
    const isWhitelisted = await this.isWhitelisted(publicKey, amountUInt64);
    return isWhitelisted;
  }

  @method.returns(Bool)
  public async canChangeAdmin(_admin: PublicKey) {
    await this.ensureAdminSignature();
    return Bool(true);
  }

  @method.returns(Bool)
  public async canPause(): Promise<Bool> {
    await this.ensureAdminSignature();
    return Bool(true);
  }

  @method.returns(Bool)
  public async canResume(): Promise<Bool> {
    await this.ensureAdminSignature();
    return Bool(true);
  }

    /**
   * Checks if a given address is whitelisted for a specific amount.
   * @param address The public key of the address to check.
   * @param amount The amount to check against the whitelist.
   * @returns A `Bool` indicating whether the address is whitelisted for the amount.
   */
    async isWhitelisted(address: PublicKey, amount: UInt64): Promise<Bool> {
      const whitelistRoot = this.whitelistRoot.getAndRequireEquals();
      const storage = this.storage.getAndRequireEquals();
      const map = await Provable.witnessAsync(Whitelist, async () => {
        if (whitelistRoot.equals(Field(0)).toBoolean()) return new Whitelist();
        else
          return await loadIndexedMerkleMap({
            url: createIpfsURL({ hash: storage.toString() }),
            type: Whitelist,
          });
      });
      map.root
        .equals(whitelistRoot)
        .or(whitelistRoot.equals(Field(0)))
        .assertTrue();
      const key = Poseidon.hash(address.toFields());
      const amountValue = map.getOption(key).orElse(Field(0));
      amountValue.assertLessThanOrEqual(Field(UInt64.MAXINT().value));
      const maxAmount = UInt64.Unsafe.fromField(amountValue);
      return amount.lessThanOrEqual(maxAmount).or(whitelistRoot.equals(Field(0)));
    }
}
