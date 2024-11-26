import { Cloud, zkCloudWorker, initBlockchain } from "zkcloudworker";
import { initializeBindings } from "o1js";
import { TokenLauncherWorker } from "./src/worker.js";

export async function zkcloudworker(cloud: Cloud): Promise<zkCloudWorker> {
  console.log(`chain: ${cloud.chain}`);
  console.log("wallet:", process.env.WALLET);

  await initializeBindings();
  await initBlockchain(cloud.chain);
  return new TokenLauncherWorker(cloud);
}
