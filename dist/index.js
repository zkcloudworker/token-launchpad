"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.zkcloudworker = void 0;
const zkcloudworker_1 = require("zkcloudworker");
const o1js_1 = require("o1js");
const worker_1 = require("./src/worker");
const package_json_1 = __importDefault(require("./package.json"));
async function zkcloudworker(cloud) {
    console.log(`starting token launcher version ${package_json_1.default.version ?? "unknown"} on chain ${cloud.chain}`);
    await (0, o1js_1.initializeBindings)();
    await (0, zkcloudworker_1.initBlockchain)(cloud.chain);
    return new worker_1.TokenLauncherWorker(cloud);
}
exports.zkcloudworker = zkcloudworker;
