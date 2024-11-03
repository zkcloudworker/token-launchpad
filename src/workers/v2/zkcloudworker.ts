import {
  Cloud,
  zkCloudWorker,
  initBlockchain,
  sleep,
  TokenAPI,
  FungibleTokenDeployParams,
  LocalCloud,
} from "zkcloudworker";
import { initializeBindings, setNumberOfWorkers } from "o1js";
import { TokenLauncherWorker } from "./worker";
import packageJson from "../../../package.json";
import { prepare } from "./prepare";

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

export async function zkcloudworkerV2(args: any): Promise<string> {
  const { command, chain, data } = args?.data;
  console.log("args:", { command, chain, data: data.slice(0, 50) });
  if (!command || !chain || !data) {
    throw new Error("command, chain, and data are required");
  }
  setNumberOfWorkers(2);

  if (command === "deploy") {
    const api = new TokenAPI({
      jwt: "local",
      zkcloudworker,
      chain,
    });
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
  } else if (command === "prepare") {
    await initializeBindings();
    await initBlockchain(chain);
    const result = await prepare();
    console.log("prepare result:", {
      result: result.slice(0, 50),
    });
    return result;
  }

  return "unknown command";
}
