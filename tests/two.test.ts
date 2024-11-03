import { describe, expect, it } from "@jest/globals";
import { Queue, Worker, QueueEvents } from "bullmq";
import { fork } from "child_process";
import { connection } from "../src/connection";
const deploy = true;

describe("Token Launchpad Worker with two o1js versions", () => {
  let myQueue1: Queue;
  let queueEvents1: QueueEvents;
  let myQueue2: Queue;
  let queueEvents2: QueueEvents;
  let workerProcess1: any;
  let workerProcess2: any;

  beforeAll(async () => {
    console.log("initializing workers");
    console.time("workers initialized");

    myQueue1 = new Queue("v1", {
      connection,
      defaultJobOptions: {
        removeOnComplete: {
          age: 3600, // Keep completed jobs for 1 hour
          count: 100, // Or keep the last 100 jobs
        },
        removeOnFail: {
          age: 86400, // Keep failed jobs for 1 day
        },
      },
    });
    myQueue1.drain(true);

    queueEvents1 = new QueueEvents("v1", {
      connection,
    });
    queueEvents1.on("completed", (job) => {
      console.log(
        `v1 job ${job.jobId} has completed and returned ${job.returnvalue.slice(
          0,
          50
        )}`
      );
    });

    myQueue2 = new Queue("v2", {
      connection,
      defaultJobOptions: {
        removeOnComplete: {
          age: 3600, // Keep completed jobs for 1 hour
          count: 100, // Or keep the last 100 jobs
        },
        removeOnFail: {
          age: 86400, // Keep failed jobs for 1 day
        },
      },
    });
    myQueue2.drain(true);

    queueEvents2 = new QueueEvents("v2", {
      connection,
    });
    queueEvents2.on("completed", (job) => {
      console.log(
        `v2 job ${job.jobId} has completed and returned ${job.returnvalue.slice(
          0,
          50
        )}`
      );
    });
    // worker2 = new Worker("v2", zkcloudworkerV2, {
    //   connection: {
    //     url: REDIS_URL,
    //   },
    // });
    // let workerProcess: any;

    // Spawn workers in a separate processes
    workerProcess1 = fork("./src/worker1.ts", [], {
      execArgv: ["-r", "ts-node/register"],
    });
    workerProcess2 = fork("./src/worker2.ts", [], {
      execArgv: ["-r", "ts-node/register"],
    });

    console.timeEnd("workers initialized");
  });

  if (deploy) {
    const version = "v1";
    it(`should deploy contract ${version}`, async () => {
      const jobPrepare = await myQueue2.add(
        `prepare`,
        {
          command: "prepare",
          chain: "devnet",
          data: JSON.stringify({}),
        },
        {
          removeOnComplete: 10,
          removeOnFail: 10,
        }
      );

      const resultPrepare = await jobPrepare.waitUntilFinished(queueEvents2);
      console.log("resultPrepare:", resultPrepare.slice(0, 50));

      const jobDeploy = await myQueue1.add(
        `deploy`,
        {
          command: "deploy",
          chain: "devnet",
          data: resultPrepare,
        },
        {
          removeOnComplete: 10,
          removeOnFail: 10,
        }
      );

      // await worker2.close();
      // await sleep(10000);
      // worker1 = new Worker("v1", zkcloudworkerV1, {
      //   connection: {
      //     url: REDIS_URL,
      //   },
      // });
      const result = await jobDeploy.waitUntilFinished(queueEvents1);
      console.log("result:", result.slice(0, 50));

      expect(result).toBeDefined();
      if (result === undefined) throw new Error("Deploy result is undefined");
      const resultJSON = JSON.parse(result);
      expect(resultJSON.success).toBe(true);
      const hash = resultJSON.hash;
      expect(hash).toBeDefined();
      if (hash === undefined) throw new Error("Deploy hash is undefined");
      console.log("deploy hash:", hash);
    });
  }

  afterAll(async () => {
    console.log("closing workers");
    queueEvents1.removeAllListeners();
    queueEvents2.removeAllListeners();
    await queueEvents1.close();
    await queueEvents2.close();
    await myQueue1.drain(true);
    await myQueue1.close();
    await myQueue2.drain(true);
    await myQueue2.close();
    // await worker1.close();
    // await worker2.close();
    workerProcess1.kill();
    workerProcess2.kill();
    console.log("workers closed");
    // Wait for the processes to exit
    await new Promise<void>((resolve) => {
      let exited = 0;
      workerProcess1.on("exit", () => {
        exited += 1;
        if (exited === 2) resolve();
      });
      workerProcess2.on("exit", () => {
        exited += 1;
        if (exited === 2) resolve();
      });
      console.log("workers exited");
    });
    await sleep(10000);
  });
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
