import { Worker } from "bullmq";
import { zkcloudworkerV1 } from "./workers/v1/zkcloudworker";
import { connection } from "./connection";

// Create worker in a separate file
const worker = new Worker("v1", zkcloudworkerV1, {
  connection,
});

worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed:`, err);
});

console.log("Worker1 initialized");
