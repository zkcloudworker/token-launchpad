import { Cloud, zkCloudWorker, initBlockchain } from "zkcloudworker";
import { initializeBindings } from "o1js";
import { TokenLauncherWorker } from "./src/worker";
import packageJson from "./package.json";

export async function zkcloudworker(cloud: Cloud): Promise<zkCloudWorker> {
  console.log(
    `starting token launcher version ${
      packageJson.version ?? "unknown"
    } on chain ${cloud.chain}`
  );
  await initializeBindings();
  await initBlockchain(cloud.chain);
  return new TokenLauncherWorker(cloud);
}
