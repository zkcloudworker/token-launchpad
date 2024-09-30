import { zkCloudWorker, Cloud } from "zkcloudworker";
import { VerificationKey, Cache } from "o1js";
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
}
