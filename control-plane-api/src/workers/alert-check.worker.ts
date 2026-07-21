import cron from "node-cron";
import { logger } from "../utils";
import { useAlertService } from "../resources/alert/alert.service";

let isRunning = false;

export function startAlertCheckWorker() {
  logger.log({ level: "info", message: "Starting alert check worker (every 60s)" });

  // Run every 60 seconds
  cron.schedule("*/60 * * * * *", async () => {
    if (isRunning) {
      logger.log({ level: "debug", message: "Alert check already running, skipping" });
      return;
    }

    isRunning = true;
    try {
      const alertService = useAlertService();
      const results = await alertService.runAllHealthChecks();

      const summary = [
        `DB: ${results.database.checked} checked, ${results.database.alerts} alerts`,
        `Nodes: ${results.node.checked} checked, ${results.node.alerts} alerts`,
        `Clusters: ${results.cluster.checked} checked, ${results.cluster.alerts} alerts`,
        `System: ${results.system.alerts} alerts`,
      ].join("; ");

      if (results.totalAlerts > 0) {
        logger.log({
          level: "info",
          message: `Alert check: ${results.totalAlerts} new alerts. ${summary}`,
        });
      } else {
        logger.log({
          level: "debug",
          message: `Alert check complete: ${summary}`,
        });
      }
    } catch (error) {
      logger.log({
        level: "error",
        message: `Alert check failed: ${error}`,
      });
    } finally {
      isRunning = false;
    }
  });
}
