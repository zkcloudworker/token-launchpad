import { REDIS_URL } from "../env.json";
export const connection = {
  url: REDIS_URL,
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
};
