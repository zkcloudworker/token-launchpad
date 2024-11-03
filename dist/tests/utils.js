"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTxStatusFast = exports.sendTx = exports.processArguments = void 0;
const o1js_1 = require("o1js");
const zkcloudworker_1 = require("zkcloudworker");
let chain = "local";
function processArguments() {
    function getArgument(arg) {
        const argument = process.argv.find((a) => a.startsWith("--" + arg));
        return argument?.split("=")[1];
    }
    const chainName = getArgument("chain") ?? "local";
    const shouldDeploy = getArgument("deploy") ?? "true";
    const shouldMint = getArgument("mint") ?? "true";
    const shouldTransfer = getArgument("transfer") ?? "true";
    const shouldCompile = getArgument("compile") ?? "true";
    const cloud = getArgument("cloud") ?? "local";
    const random = getArgument("random") ?? "true";
    if (chainName !== "local" &&
        chainName !== "devnet" &&
        chainName !== "lightnet" &&
        chainName !== "mainnet" &&
        chainName !== "zeko")
        throw new Error("Invalid chain name");
    chain = chainName;
    return {
        chain,
        compile: shouldCompile === "true",
        deploy: shouldDeploy === "true",
        transfer: shouldTransfer === "true",
        mint: shouldMint === "true",
        useLocalCloudWorker: cloud
            ? cloud === "local"
            : chainName === "local" || chainName === "lightnet",
        useRandomTokenAddress: random === "true",
    };
}
exports.processArguments = processArguments;
async function sendTx(tx, description, wait) {
    try {
        let txSent;
        let sent = false;
        while (!sent) {
            txSent = await tx.safeSend();
            if (txSent.status == "pending") {
                sent = true;
                console.log(`${description ?? ""} tx sent: hash: ${txSent.hash} status: ${txSent.status}`);
            }
            else if (chain === "zeko") {
                console.log("Retrying Zeko tx");
                await (0, zkcloudworker_1.sleep)(10000);
            }
            else {
                console.log(`${description ?? ""} tx NOT sent: hash: ${txSent?.hash} status: ${txSent?.status}`, txSent.errors);
                return undefined;
            }
        }
        if (txSent === undefined)
            throw new Error("txSent is undefined");
        if (txSent.errors.length > 0) {
            console.error(`${description ?? ""} tx error: hash: ${txSent.hash} status: ${txSent.status}  errors: ${txSent.errors}`);
        }
        if (txSent.status === "pending" && wait !== false) {
            console.log(`Waiting for tx inclusion...`);
            const txIncluded = await txSent.safeWait();
            console.log(`${description ?? ""} tx included into block: hash: ${txIncluded.hash} status: ${txIncluded.status}`);
            return undefined;
        }
        else
            return txSent;
    }
    catch (error) {
        if (chain !== "zeko")
            console.error("Error sending tx", error);
    }
    if (chain !== "local")
        await (0, zkcloudworker_1.sleep)(10000);
}
exports.sendTx = sendTx;
async function getTxStatusFast(params) {
    if (chain === "local" || chain === "zeko")
        return { success: true, result: true };
    const { hash } = params;
    try {
        const txStatus = await (0, o1js_1.checkZkappTransaction)(hash);
        return {
            success: true,
            result: txStatus?.success ?? false,
        };
    }
    catch (error) {
        console.error("getTxStatusFast error while getting tx status - catch", hash, error);
        return { success: false, error: error?.message ?? "Cannot get tx status" };
    }
}
exports.getTxStatusFast = getTxStatusFast;
