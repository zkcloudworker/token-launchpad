// import { Mina, checkZkappTransaction } from "o1js";
import { blockchain, sleep } from "zkcloudworker";
// import fs from "fs/promises";

let chain: blockchain = "local" as blockchain;

export function processArguments(): {
  chain: blockchain;
  compile: boolean;
  deploy: boolean;
  transfer: boolean;
  mint: boolean;
  buy: boolean;
  sell: boolean;
  withdrawBid: boolean;
  withdrawOffer: boolean;
  whitelistAdmin: boolean;
  whitelistOffer: boolean;
  whitelistBid: boolean;
  updateWhitelistAdmin: boolean;
  updateWhitelistOffer: boolean;
  updateWhitelistBid: boolean;
  useLocalCloudWorker: boolean;
  useRandomTokenAddress: boolean;
} {
  const chainName = process.env.CHAIN;
  if (
    chainName !== "local" &&
    chainName !== "devnet" &&
    chainName !== "lightnet" &&
    chainName !== "mainnet" &&
    chainName !== "zeko"
  )
    throw new Error("Invalid chain name");
  chain = chainName as blockchain;

  return {
    chain,
    compile: process.env.COMPILE === "false" ? false : true,
    deploy: process.env.DEPLOY !== "false",
    transfer: process.env.TRANSFER !== "false",
    mint: process.env.MINT !== "false",
    buy: process.env.BUY !== "false",
    sell: process.env.SELL !== "false",
    withdrawBid: process.env.WITHDRAW_BID !== "false",
    withdrawOffer: process.env.WITHDRAW_OFFER !== "false",
    useLocalCloudWorker:
      process.env.LOCAL_CLOUD_WORKER === "false" ? false : true,
    useRandomTokenAddress: process.env.RANDOM !== "false",
    whitelistAdmin: process.env.WHITELIST_ADMIN !== "false",
    whitelistOffer: process.env.WHITELIST_OFFER !== "false",
    whitelistBid: process.env.WHITELIST_BID !== "false",
    updateWhitelistAdmin: process.env.UPDATE_WHITELIST_ADMIN !== "false",
    updateWhitelistOffer: process.env.UPDATE_WHITELIST_OFFER !== "false",
    updateWhitelistBid: process.env.UPDATE_WHITELIST_BID !== "false",
  };
}

// export async function sendTx(
//   tx: Mina.Transaction<false, true> | Mina.Transaction<true, true>,
//   description?: string,
//   wait?: boolean
// ) {
//   try {
//     let txSent;
//     let sent = false;
//     while (!sent) {
//       txSent = await tx.safeSend();
//       if (txSent.status == "pending") {
//         sent = true;
//         console.log(
//           `${description ?? ""} tx sent: hash: ${txSent.hash} status: ${
//             txSent.status
//           }`
//         );
//       } else if (chain === "zeko") {
//         console.log("Retrying Zeko tx");
//         await sleep(10000);
//       } else {
//         console.log(
//           `${description ?? ""} tx NOT sent: hash: ${txSent?.hash} status: ${
//             txSent?.status
//           }`,
//           txSent.errors
//         );
//         return undefined;
//       }
//     }
//     if (txSent === undefined) throw new Error("txSent is undefined");
//     if (txSent.errors.length > 0) {
//       console.error(
//         `${description ?? ""} tx error: hash: ${txSent.hash} status: ${
//           txSent.status
//         }  errors: ${txSent.errors}`
//       );
//     }

//     if (txSent.status === "pending" && wait !== false) {
//       console.log(`Waiting for tx inclusion...`);
//       const txIncluded = await txSent.safeWait();
//       console.log(
//         `${description ?? ""} tx included into block: hash: ${
//           txIncluded.hash
//         } status: ${txIncluded.status}`
//       );
//       return undefined;
//     } else return txSent;
//   } catch (error) {
//     if (chain !== "zeko") console.error("Error sending tx", error);
//   }
//   if (chain !== "local") await sleep(10000);
// }

// export async function getTxStatusFast(params: {
//   hash: string;
// }): Promise<{ success: boolean; result?: boolean; error?: string }> {
//   console.log("getTxStatusFast", params);
//   if (chain === "local" || chain === "zeko")
//     return { success: true, result: true };
//   const { hash } = params;

//   try {
//     const txStatus = await checkZkappTransaction(hash);
//     console.log("txStatus", txStatus);
//     return {
//       success: true,
//       result: txStatus?.success ?? false,
//     };
//   } catch (error: any) {
//     console.error(
//       "getTxStatusFast error while getting tx status - catch",
//       hash,
//       error
//     );
//     return { success: false, error: error?.message ?? "Cannot get tx status" };
//   }
// }

// export async function writeFile(params: { type: string; data: string }) {
//   const { type, data } = params;
//   await fs.writeFile(`./${type}.json`, data);
// }
