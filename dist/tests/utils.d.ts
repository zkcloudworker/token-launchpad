import { Mina } from "o1js";
import { blockchain } from "zkcloudworker";
export declare function processArguments(): {
    chain: blockchain;
    compile: boolean;
    deploy: boolean;
    transfer: boolean;
    mint: boolean;
    useLocalCloudWorker: boolean;
    useRandomTokenAddress: boolean;
};
export declare function sendTx(tx: Mina.Transaction<false, true> | Mina.Transaction<true, true>, description?: string, wait?: boolean): Promise<Mina.PendingTransaction | Mina.RejectedTransaction | undefined>;
export declare function getTxStatusFast(params: {
    hash: string;
}): Promise<{
    success: boolean;
    result?: boolean;
    error?: string;
}>;
