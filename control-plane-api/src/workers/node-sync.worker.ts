import cron from "node-cron";
import { logger } from "../utils";
import { useClusterRepo } from "../resources/cluster/cluster.repository";
import { useClusterService } from "../resources/cluster/cluster.service";
import { useNodeService } from "../resources/node/node.service";

let isRunning = false;

export function startNodeSyncWorker() {
  logger.log({ level: "info", message: "Starting node sync worker (every 30s)" });

  cron.schedule("*/30 * * * * *", async () => {
    if (isRunning) {
      logger.log({ level: "debug", message: "Node sync already running, skipping" });
      return;
    }

    isRunning = true;
    try {
      // Get local cluster
      const clusterRepo = useClusterRepo();
      const clusterService = useClusterService();
      const cluster = await clusterRepo.getLocalCluster();

      if (!cluster) {
        logger.log({ level: "debug", message: "No local cluster found, skipping sync" });
        return;
      }

      const clusterId = cluster._id!.toString();

      // Sync cluster status first
      await clusterService.syncClusterStatus(clusterId);

      // Sync nodes
      const nodeService = useNodeService();
      const nodes = await nodeService.syncAllNodes(clusterId);

      logger.log({
        level: "debug",
        message: `Node sync complete: ${nodes.length} nodes synced`,
      });
    } catch (error) {
      logger.log({
        level: "error",
        message: `Node sync failed: ${error}`,
      });
    } finally {
      isRunning = false;
    }
  });
}
