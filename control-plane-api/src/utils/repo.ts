import { useAtlas } from "./atlas";
import { useCache } from "./cache";
import { logger } from "./logger";

export function useRepo(namespace_collection: string) {
  const db = useAtlas.getDb();
  if (!db) {
    throw new Error("Unable to connect to server.");
  }

  const collection = db.collection(namespace_collection);

  const { getCache, setCache, delNamespace, delCache } = useCache(namespace_collection);

  function delCachedData() {
    return delNamespace()
      .then(() => {
        logger.log({
          level: "info",
          message: `Cache namespace cleared for ${namespace_collection}`,
        });
      })
      .catch((err) => {
        logger.log({
          level: "error",
          message: `Failed to clear cache namespace for ${namespace_collection}: ${err.message}`,
        });
      });
  }

  return {
    collection,
    getCache,
    setCache,
    delCache,
    delNamespace,
    delCachedData,
  };
}
