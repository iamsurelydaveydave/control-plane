import cron from "node-cron";
import { logger } from "../utils";
import { useScheduledTaskRepo } from "../resources/scheduled-task/scheduled-task.repository";
import { useScheduledTaskService } from "../resources/scheduled-task/scheduled-task.service";

let isRunning = false;

/**
 * Task scheduler worker.
 * Runs every minute to check for due tasks and execute them.
 */
export function startTaskSchedulerWorker() {
  logger.log({
    level: "info",
    message: "Starting task scheduler worker (every minute)",
  });

  // Run every minute
  cron.schedule("* * * * *", async () => {
    if (isRunning) {
      logger.log({
        level: "debug",
        message: "Task scheduler already running, skipping",
      });
      return;
    }

    isRunning = true;
    try {
      const taskRepo = useScheduledTaskRepo();
      const taskService = useScheduledTaskService();
      
      const dueTasks = await taskRepo.getDue();

      if (dueTasks.length === 0) {
        logger.log({
          level: "debug",
          message: "No due tasks found",
        });
        isRunning = false;
        return;
      }

      logger.log({
        level: "info",
        message: `Found ${dueTasks.length} due task(s) to execute`,
      });

      // Execute tasks in parallel but don't block the main loop
      const executions = dueTasks.map(async (task) => {
        try {
          logger.log({
            level: "info",
            message: `Executing scheduled task: ${task.name} (${task.type})`,
          });
          
          const result = await taskService.executeTask(task);
          
          if (result.success) {
            logger.log({
              level: "info",
              message: `Task ${task.name} completed successfully in ${result.duration}ms`,
            });
          } else {
            logger.log({
              level: "warn",
              message: `Task ${task.name} failed: ${result.error}`,
            });
          }
        } catch (err) {
          logger.log({
            level: "error",
            message: `Error executing task ${task.name}: ${err}`,
          });
        }
      });

      // Wait for all tasks to complete (with timeout)
      await Promise.race([
        Promise.allSettled(executions),
        new Promise((resolve) => setTimeout(resolve, 55000)), // 55s timeout to leave buffer for next minute
      ]);
    } catch (error) {
      logger.log({
        level: "error",
        message: `Task scheduler error: ${error}`,
      });
    } finally {
      isRunning = false;
    }
  });
}
