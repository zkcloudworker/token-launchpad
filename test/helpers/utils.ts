import { blockchain } from "zkcloudworker";

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
    useLocalCloudWorker: process.env.CLOUD !== "zkcloudworker" ? true : false,
    useRandomTokenAddress: process.env.RANDOM !== "false",
    whitelistAdmin: process.env.WHITELIST_ADMIN !== "false",
    whitelistOffer: process.env.WHITELIST_OFFER !== "false",
    whitelistBid: process.env.WHITELIST_BID !== "false",
    updateWhitelistAdmin: process.env.UPDATE_WHITELIST_ADMIN !== "false",
    updateWhitelistOffer: process.env.UPDATE_WHITELIST_OFFER !== "false",
    updateWhitelistBid: process.env.UPDATE_WHITELIST_BID !== "false",
  };
}
