import { zkCloudWorker, Cloud } from "zkcloudworker";
import { VerificationKey, PublicKey, Mina, Cache, UInt64, Transaction } from "o1js";
export declare class TokenLauncherWorker extends zkCloudWorker {
    static contractVerificationKey: VerificationKey | undefined;
    static contractAdminVerificationKey: VerificationKey | undefined;
    readonly cache: Cache;
    constructor(cloud: Cloud);
    private compile;
    create(transaction: string): Promise<string | undefined>;
    merge(proof1: string, proof2: string): Promise<string | undefined>;
    execute(transactions: string[]): Promise<string | undefined>;
    private stringifyJobResult;
    private deployTx;
    private mintTx;
    private transferTx;
    private tinyTx;
}
export declare function tinyTransactionParams(serializedTransaction: string): {
    fee: UInt64;
    sender: PublicKey;
    nonce: number;
    memo: string;
};
export declare function deserializeTinyTransaction(serializedTransaction: string, txNew: Mina.Transaction<false, false>): Transaction<false, true>;
