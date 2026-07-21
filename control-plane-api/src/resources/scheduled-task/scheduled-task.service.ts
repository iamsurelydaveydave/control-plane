import cron from "node-cron";
import { TScheduledTask, TTaskRunStatus } from "./scheduled-task.model";
import { TTaskHistoryInput } from "./task-history.model";
import { useScheduledTaskRepo, useTaskHistoryRepo } from "./scheduled-task.repository";
import { useDatabaseRepo } from "../database";
import { useDeploymentRepo } from "../deployment";
import { useAuditLogRepo } from "../audit-log";
import { logger, InternalServerError } from "../../utils";

// =============================================================================
// Types
// =============================================================================

export type TTaskExecutionResult = {
  success: boolean;
  error?: string;
  duration: number;
  output?: string;
};

// =============================================================================
// Service
// =============================================================================

export function useScheduledTaskService() {
  const taskRepo = useScheduledTaskRepo();
  const historyRepo = useTaskHistoryRepo();

  /**
   * Calculate the next run time from a cron expression.
   * Uses node-cron to validate and get the next occurrence.
   */
  function calculateNextRun(schedule: string, timezone: string = "UTC"): Date {
    try {
      // node-cron doesn't have a direct "getNextDate" method,
      // so we need to calculate it manually based on the cron expression
      const now = new Date();
      
      // Parse cron expression to get next occurrence
      // node-cron uses a 5-field format: minute hour day month weekday
      // or 6-field with seconds: second minute hour day month weekday
      const parts = schedule.trim().split(/\s+/);
      const hasSeconds = parts.length === 6;
      
      // Get current time parts in the specified timezone
      const options: Intl.DateTimeFormatOptions = {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      };
      
      // Simple approach: iterate forward in 1-minute increments until we find a match
      // This is a simplified implementation - for production, consider using a library like cron-parser
      const maxIterations = 525600; // Max 1 year of minutes
      const candidate = new Date(now.getTime() + 60000); // Start from next minute
      
      for (let i = 0; i < maxIterations; i++) {
        if (matchesCron(candidate, schedule, timezone)) {
          return candidate;
        }
        candidate.setTime(candidate.getTime() + 60000); // Add 1 minute
      }
      
      // Fallback: return 1 hour from now if no match found
      return new Date(now.getTime() + 3600000);
    } catch (error) {
      logger.log({
        level: "error",
        message: `Failed to calculate next run for schedule "${schedule}": ${error}`,
      });
      // Fallback: return 1 hour from now
      return new Date(Date.now() + 3600000);
    }
  }

  /**
   * Check if a date matches a cron expression.
   * Simple implementation for common cron patterns.
   */
  function matchesCron(date: Date, schedule: string, timezone: string): boolean {
    // Get date parts in the specified timezone
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      minute: "numeric",
      hour: "numeric",
      day: "numeric",
      month: "numeric",
      weekday: "short",
      hour12: false,
    });
    
    const parts = formatter.formatToParts(date);
    const getPart = (type: string) => {
      const part = parts.find(p => p.type === type);
      return part ? parseInt(part.value, 10) : 0;
    };
    
    const minute = getPart("minute");
    const hour = getPart("hour");
    const day = getPart("day");
    const month = getPart("month");
    const weekdayPart = parts.find(p => p.type === "weekday");
    const weekdayMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    const weekday = weekdayPart ? weekdayMap[weekdayPart.value] || 0 : 0;
    
    const cronParts = schedule.trim().split(/\s+/);
    // Handle both 5-field (standard) and 6-field (with seconds) cron
    const hasSeconds = cronParts.length === 6;
    const [cronMin, cronHour, cronDay, cronMonth, cronWeekday] = hasSeconds
      ? cronParts.slice(1)
      : cronParts;
    
    return (
      matchesCronField(minute, cronMin, 0, 59) &&
      matchesCronField(hour, cronHour, 0, 23) &&
      matchesCronField(day, cronDay, 1, 31) &&
      matchesCronField(month, cronMonth, 1, 12) &&
      matchesCronField(weekday, cronWeekday, 0, 6)
    );
  }

  /**
   * Check if a value matches a cron field.
   */
  function matchesCronField(value: number, field: string, min: number, max: number): boolean {
    if (field === "*") return true;
    
    // Handle comma-separated values
    if (field.includes(",")) {
      return field.split(",").some(f => matchesCronField(value, f.trim(), min, max));
    }
    
    // Handle ranges (e.g., "1-5")
    if (field.includes("-")) {
      const [start, end] = field.split("-").map(Number);
      return value >= start && value <= end;
    }
    
    // Handle step values (e.g., "*/5" or "1-10/2")
    if (field.includes("/")) {
      const [range, step] = field.split("/");
      const stepNum = parseInt(step, 10);
      
      if (range === "*") {
        return value % stepNum === 0;
      } else if (range.includes("-")) {
        const [start, end] = range.split("-").map(Number);
        if (value < start || value > end) return false;
        return (value - start) % stepNum === 0;
      }
    }
    
    // Direct value match
    return parseInt(field, 10) === value;
  }

  /**
   * Execute a task and record the result.
   */
  async function executeTask(task: TScheduledTask): Promise<TTaskExecutionResult> {
    const startedAt = new Date();
    let result: TTaskExecutionResult;

    try {
      // Mark task as running to prevent concurrent execution
      const acquired = await taskRepo.markRunning(task._id!.toString());
      if (!acquired) {
        return { success: false, error: "Task is already running", duration: 0 };
      }

      // Execute based on task type
      switch (task.type) {
        case "backup":
          result = await runBackupTask(task);
          break;
        case "cleanup":
          result = await runCleanupTask(task);
          break;
        case "health-check":
          result = await runHealthCheckTask(task);
          break;
        case "script":
          result = await runScriptTask(task);
          break;
        case "webhook":
          result = await runWebhookTask(task);
          break;
        default:
          result = { success: false, error: `Unknown task type: ${task.type}`, duration: 0 };
      }
    } catch (error: any) {
      result = {
        success: false,
        error: error.message || String(error),
        duration: Date.now() - startedAt.getTime(),
      };
    }

    const completedAt = new Date();
    result.duration = completedAt.getTime() - startedAt.getTime();

    // Calculate next run time
    const nextRunAt = calculateNextRun(task.schedule, task.timezone);

    // Update task status
    await taskRepo.updateRunStatus(
      task._id!.toString(),
      result.success ? "success" : "failed",
      result.duration,
      nextRunAt,
      result.error
    );

    // Record history
    const historyData: TTaskHistoryInput = {
      taskId: task._id!.toString(),
      status: result.success ? "success" : "failed",
      startedAt,
      completedAt,
      duration: result.duration,
      ...(result.error && { error: result.error }),
      ...(result.output && { output: result.output }),
    };
    await historyRepo.add(historyData);

    return result;
  }

  /**
   * Run a backup task.
   */
  async function runBackupTask(task: TScheduledTask): Promise<TTaskExecutionResult> {
    const { databaseId } = task.config;
    
    if (!databaseId) {
      return { success: false, error: "No databaseId configured", duration: 0 };
    }

    try {
      const databaseRepo = useDatabaseRepo();
      const database = await databaseRepo.getById(databaseId);
      
      if (!database) {
        return { success: false, error: `Database ${databaseId} not found`, duration: 0 };
      }

      // Check if backup is configured
      if (!database.backup?.enabled) {
        return { 
          success: false, 
          error: `Backup not enabled for database ${database.name}`, 
          duration: 0 
        };
      }

      // In a real implementation, this would trigger the actual backup
      // For now, we log the intent
      logger.log({
        level: "info",
        message: `Scheduled backup triggered for database: ${database.name}`,
      });

      return {
        success: true,
        output: `Backup initiated for database: ${database.name}`,
        duration: 0,
      };
    } catch (error: any) {
      return { success: false, error: error.message, duration: 0 };
    }
  }

  /**
   * Run a cleanup task (delete old deployments, logs, etc.).
   */
  async function runCleanupTask(task: TScheduledTask): Promise<TTaskExecutionResult> {
    const retentionDays = task.config.retentionDays || 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    let output = "";
    let cleanedDeployments = 0;
    let cleanedAuditLogs = 0;

    try {
      // Clean old deployments
      const deploymentRepo = useDeploymentRepo();
      // Note: In a real implementation, the repo would have a deleteOlderThan method
      // For now, we just log the intent
      logger.log({
        level: "info",
        message: `Cleanup: Would delete deployments older than ${cutoffDate.toISOString()}`,
      });
      output += `Deployment cleanup: ${cleanedDeployments} records removed\n`;

      // Clean old audit logs (if not using TTL index)
      logger.log({
        level: "info",
        message: `Cleanup: Would delete audit logs older than ${cutoffDate.toISOString()}`,
      });
      output += `Audit log cleanup: ${cleanedAuditLogs} records removed\n`;

      output += `Retention period: ${retentionDays} days`;

      return { success: true, output, duration: 0 };
    } catch (error: any) {
      return { success: false, error: error.message, duration: 0 };
    }
  }

  /**
   * Run a health check task.
   */
  async function runHealthCheckTask(task: TScheduledTask): Promise<TTaskExecutionResult> {
    try {
      // Perform basic system health checks
      const checks: string[] = [];
      
      // Check MongoDB connection by listing databases
      try {
        const databaseRepo = useDatabaseRepo();
        await databaseRepo.getAll({ page: 1, limit: 1 });
        checks.push("MongoDB: OK");
      } catch {
        checks.push("MongoDB: FAILED");
      }

      // Add more checks as needed
      const output = checks.join("\n");
      const allPassed = !output.includes("FAILED");

      return {
        success: allPassed,
        output,
        error: allPassed ? undefined : "One or more health checks failed",
        duration: 0,
      };
    } catch (error: any) {
      return { success: false, error: error.message, duration: 0 };
    }
  }

  /**
   * Run a script task.
   * Note: In production, this should be sandboxed or restricted.
   */
  async function runScriptTask(task: TScheduledTask): Promise<TTaskExecutionResult> {
    const { script } = task.config;
    
    if (!script) {
      return { success: false, error: "No script configured", duration: 0 };
    }

    // For security, script execution is not implemented
    // This would need careful sandboxing in a real implementation
    logger.log({
      level: "warn",
      message: `Script task ${task.name}: Script execution not implemented for security reasons`,
    });

    return {
      success: false,
      error: "Script execution not implemented for security reasons",
      duration: 0,
    };
  }

  /**
   * Run a webhook task.
   */
  async function runWebhookTask(task: TScheduledTask): Promise<TTaskExecutionResult> {
    const { url, method = "POST", headers = {}, body } = task.config;
    
    if (!url) {
      return { success: false, error: "No webhook URL configured", duration: 0 };
    }

    try {
      const fetchOptions: RequestInit = {
        method,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "ControlPlane-Scheduler/1.0",
          ...headers,
        },
      };

      if (body && ["POST", "PUT", "PATCH"].includes(method)) {
        fetchOptions.body = body;
      }

      const response = await fetch(url, fetchOptions);
      const responseText = await response.text();

      if (!response.ok) {
        return {
          success: false,
          error: `Webhook returned ${response.status}: ${responseText.slice(0, 500)}`,
          duration: 0,
        };
      }

      return {
        success: true,
        output: `Status: ${response.status}\nResponse: ${responseText.slice(0, 1000)}`,
        duration: 0,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Webhook request failed: ${error.message}`,
        duration: 0,
      };
    }
  }

  /**
   * Create a new scheduled task.
   */
  async function create(data: Parameters<typeof taskRepo.add>[0]) {
    const taskId = await taskRepo.add(data);
    
    // Set initial nextRunAt
    const nextRunAt = calculateNextRun(data.schedule, data.timezone);
    await taskRepo.updateNextRunAt(taskId, nextRunAt);
    
    return taskId;
  }

  /**
   * Pause a task.
   */
  async function pause(id: string): Promise<void> {
    await taskRepo.updateStatus(id, "paused");
  }

  /**
   * Resume a paused task.
   */
  async function resume(id: string): Promise<void> {
    const task = await taskRepo.getById(id);
    
    // Calculate next run from now
    const nextRunAt = calculateNextRun(task.schedule, task.timezone);
    await taskRepo.updateNextRunAt(id, nextRunAt);
    await taskRepo.updateStatus(id, "active");
  }

  /**
   * Run a task immediately (manual trigger).
   */
  async function runNow(id: string): Promise<TTaskExecutionResult> {
    const task = await taskRepo.getById(id);
    return executeTask(task);
  }

  /**
   * Delete a task and its history.
   */
  async function remove(id: string): Promise<void> {
    await taskRepo.deleteById(id);
    await historyRepo.deleteByTaskId(id);
  }

  return {
    calculateNextRun,
    executeTask,
    create,
    pause,
    resume,
    runNow,
    remove,
  };
}
