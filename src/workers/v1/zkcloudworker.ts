import {
  Cloud,
  zkCloudWorker,
  initBlockchain,
  sleep,
  TokenAPI,
  FungibleTokenDeployParams,
  LocalCloud,
} from "./lib";
import { initializeBindings, setNumberOfWorkers } from "o1js_v1";
import { TokenLauncherWorker } from "./worker";
import packageJson from "../../../package.json";

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

export async function zkcloudworkerV1(args: any): Promise<string> {
  const { command, chain, data } = args?.data;
  console.log("args:", { command, chain, data: data.slice(0, 50) });
  if (!command || !chain || !data) {
    throw new Error("command, chain, and data are required");
  }
  setNumberOfWorkers(2);
  const api = new TokenAPI({
    jwt: "local",
    zkcloudworker,
    chain,
  });
  if (command === "deploy") {
    const params = JSON.parse(data) as FungibleTokenDeployParams;
    const jobId = await api.sendDeployTransaction(params);
    console.log("deploy jobId:", jobId);
    if (jobId === undefined) throw new Error("Deploy jobId is undefined");
    const result = (await api.waitForJobResult({
      jobId,
      printLogs: true,
    })) as any;
    console.log("deploy result:", {
      result: result.slice(0, 50),
    });
    try {
      const json = JSON.parse(result);
      console.log({
        success: json.success,
        hash: json.hash,
      });
    } catch (e) {}
    return result ?? "error";
  }

  return "unknown command";
}
