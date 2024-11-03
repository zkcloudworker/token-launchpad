import { Worker } from "bullmq";
import { zkcloudworkerV2 } from "./workers/v2/zkcloudworker";
import { connection } from "./connection";

// Create worker in a separate file
const worker = new Worker("v2", zkcloudworkerV2, {
  connection,
});

worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed:`, err);
});

console.log("Worker2 initialized");
