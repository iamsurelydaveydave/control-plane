import * as k8sLib from "@kubernetes/client-node";
import { PassThrough, Readable } from "stream";
import { useKubernetesService } from "./kubernetes.service";
import { logger } from "../utils";
import { BadRequestError, NotFoundError, InternalServerError } from "../utils/error";
import fs from "fs";
import path from "path";
import readline from "readline";

// =============================================================================
// Types
// =============================================================================

export const logLevels = ["debug", "info", "warn", "error"] as const;
export type TLogLevel = (typeof logLevels)[number];

export const logSources = ["app", "database", "system", "operator"] as const;
export type TLogSource = (typeof logSources)[number];

export type TLogEntry = {
  timestamp: Date;
  level: TLogLevel;
  source: TLogSource;
  sourceId?: string;
  sourceName?: string;
  message: string;
  metadata?: Record<string, any>;
};

export type TLogQuery = {
  source?: TLogSource;
  sourceId?: string;
  level?: TLogLevel;
  search?: string;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
};

export type TLogOptions = {
  tailLines?: number;
  sinceSeconds?: number;
  container?: string;
  podName?: string;
};

export type TLogResult = {
  logs: TLogEntry[];
  source: TLogSource;
  sourceId?: string;
  sourceName?: string;
  podName?: string;
};

// =============================================================================
// Constants
// =============================================================================

const CP_APPS_NAMESPACE = "cp-apps";
const CP_DATABASES_NAMESPACE = "cp-databases";
const PERCONA_OPERATOR_LABEL = "app.kubernetes.io/name=percona-server-mongodb-operator";
const DEFAULT_TAIL_LINES = 100;
const MAX_TAIL_LINES = 5000;
const SYSTEM_LOG_DIR = path.join(process.cwd(), "logs");

// =============================================================================
// Service
// =============================================================================

export function useLogsService() {
  const k8sService = useKubernetesService();

  /**
   * Parse raw log string into structured log entries
   */
  function parseLogLines(
    rawLogs: string,
    source: TLogSource,
    sourceId?: string,
    sourceName?: string
  ): TLogEntry[] {
    const lines = rawLogs.split("\n").filter((line) => line.trim());
    const entries: TLogEntry[] = [];

    for (const line of lines) {
      const entry = parseLogLine(line, source, sourceId, sourceName);
      if (entry) {
        entries.push(entry);
      }
    }

    return entries;
  }

  /**
   * Parse a single log line into a structured entry
   * Handles common log formats: JSON, standard timestamps, plain text
   */
  function parseLogLine(
    line: string,
    source: TLogSource,
    sourceId?: string,
    sourceName?: string
  ): TLogEntry | null {
    if (!line.trim()) return null;

    // Try JSON format first (common in K8s)
    try {
      const json = JSON.parse(line);
      return {
        timestamp: json.timestamp || json.time || json.ts
          ? new Date(json.timestamp || json.time || json.ts)
          : new Date(),
        level: normalizeLogLevel(json.level || json.severity || "info"),
        source,
        sourceId,
        sourceName,
        message: json.message || json.msg || json.log || line,
        metadata: json.metadata || extractMetadata(json),
      };
    } catch {
      // Not JSON, try other formats
    }

    // Try ISO timestamp prefix: 2024-01-15T10:30:00.000Z [level] message
    const isoMatch = line.match(
      /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s*\[?(\w+)\]?\s*(.*)$/
    );
    if (isoMatch) {
      return {
        timestamp: new Date(isoMatch[1]),
        level: normalizeLogLevel(isoMatch[2]),
        source,
        sourceId,
        sourceName,
        message: isoMatch[3],
      };
    }

    // Try common date format: Jan 15 10:30:00 [level] message
    const commonMatch = line.match(
      /^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s*\[?(\w+)\]?\s*(.*)$/
    );
    if (commonMatch) {
      return {
        timestamp: new Date(commonMatch[1]),
        level: normalizeLogLevel(commonMatch[2]),
        source,
        sourceId,
        sourceName,
        message: commonMatch[3],
      };
    }

    // Default: plain text with current timestamp
    return {
      timestamp: new Date(),
      level: "info",
      source,
      sourceId,
      sourceName,
      message: line,
    };
  }

  /**
   * Normalize various log level strings to our standard levels
   */
  function normalizeLogLevel(level: string): TLogLevel {
    const normalized = level.toLowerCase();
    if (["debug", "trace", "verbose"].includes(normalized)) return "debug";
    if (["info", "information", "notice"].includes(normalized)) return "info";
    if (["warn", "warning"].includes(normalized)) return "warn";
    if (["error", "err", "fatal", "critical", "alert", "emergency"].includes(normalized))
      return "error";
    return "info";
  }

  /**
   * Extract metadata from a JSON log object (excluding standard fields)
   */
  function extractMetadata(json: Record<string, any>): Record<string, any> | undefined {
    const standardFields = [
      "timestamp",
      "time",
      "ts",
      "level",
      "severity",
      "message",
      "msg",
      "log",
    ];
    const metadata: Record<string, any> = {};
    let hasMetadata = false;

    for (const [key, value] of Object.entries(json)) {
      if (!standardFields.includes(key)) {
        metadata[key] = value;
        hasMetadata = true;
      }
    }

    return hasMetadata ? metadata : undefined;
  }

  /**
   * Filter logs by query parameters
   */
  function filterLogs(logs: TLogEntry[], query: TLogQuery): TLogEntry[] {
    let filtered = [...logs];

    if (query.level) {
      const levelPriority: Record<TLogLevel, number> = {
        debug: 0,
        info: 1,
        warn: 2,
        error: 3,
      };
      const minLevel = levelPriority[query.level];
      filtered = filtered.filter((log) => levelPriority[log.level] >= minLevel);
    }

    if (query.search) {
      const searchLower = query.search.toLowerCase();
      filtered = filtered.filter(
        (log) =>
          log.message.toLowerCase().includes(searchLower) ||
          log.sourceName?.toLowerCase().includes(searchLower)
      );
    }

    if (query.startTime) {
      filtered = filtered.filter((log) => log.timestamp >= query.startTime!);
    }

    if (query.endTime) {
      filtered = filtered.filter((log) => log.timestamp <= query.endTime!);
    }

    return filtered;
  }

  // ---------------------------------------------------------------------------
  // App Logs
  // ---------------------------------------------------------------------------

  /**
   * Get logs from K8s pods for an app
   */
  async function getAppLogs(
    appId: string,
    appName: string,
    options: TLogOptions = {}
  ): Promise<TLogResult[]> {
    const tailLines = Math.min(options.tailLines ?? DEFAULT_TAIL_LINES, MAX_TAIL_LINES);
    const results: TLogResult[] = [];

    try {
      // List pods for this app using label selector
      const pods = await k8sService.listPods(CP_APPS_NAMESPACE, `app=${appName}`);

      if (pods.length === 0) {
        throw new NotFoundError(`No pods found for app ${appName}`);
      }

      // If specific pod requested, filter to that one
      const targetPods = options.podName
        ? pods.filter((p) => p.metadata?.name === options.podName)
        : pods;

      if (options.podName && targetPods.length === 0) {
        throw new NotFoundError(`Pod ${options.podName} not found for app ${appName}`);
      }

      // Get logs from each pod
      for (const pod of targetPods) {
        const podName = pod.metadata?.name;
        if (!podName) continue;

        try {
          const rawLogs = await k8sService.getPodLogs(
            CP_APPS_NAMESPACE,
            podName,
            options.container ?? "app",
            tailLines
          );

          const logs = parseLogLines(rawLogs, "app", appId, appName);

          results.push({
            logs,
            source: "app",
            sourceId: appId,
            sourceName: appName,
            podName,
          });
        } catch (error: any) {
          logger.log({
            level: "warn",
            message: `[LogsService] Failed to get logs for pod ${podName}: ${error.message}`,
          });
          results.push({
            logs: [
              {
                timestamp: new Date(),
                level: "error",
                source: "app",
                sourceId: appId,
                sourceName: appName,
                message: `Failed to retrieve logs: ${error.message}`,
              },
            ],
            source: "app",
            sourceId: appId,
            sourceName: appName,
            podName,
          });
        }
      }

      return results;
    } catch (error: any) {
      if (error instanceof NotFoundError) throw error;
      logger.log({
        level: "error",
        message: `[LogsService] getAppLogs failed for ${appName}: ${error.message}`,
      });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Database Logs
  // ---------------------------------------------------------------------------

  /**
   * Get logs from PSMDB pods for a database
   */
  async function getDatabaseLogs(
    databaseId: string,
    databaseName: string,
    options: TLogOptions = {}
  ): Promise<TLogResult[]> {
    const tailLines = Math.min(options.tailLines ?? DEFAULT_TAIL_LINES, MAX_TAIL_LINES);
    const results: TLogResult[] = [];

    try {
      // List pods for this database using Percona label selector
      const pods = await k8sService.listPods(
        CP_DATABASES_NAMESPACE,
        `app.kubernetes.io/instance=${databaseName}`
      );

      if (pods.length === 0) {
        throw new NotFoundError(`No pods found for database ${databaseName}`);
      }

      // If specific pod requested, filter to that one
      const targetPods = options.podName
        ? pods.filter((p) => p.metadata?.name === options.podName)
        : pods;

      if (options.podName && targetPods.length === 0) {
        throw new NotFoundError(`Pod ${options.podName} not found for database ${databaseName}`);
      }

      // Get logs from each pod
      for (const pod of targetPods) {
        const podName = pod.metadata?.name;
        if (!podName) continue;

        try {
          // PSMDB pods typically have 'mongod' container
          const rawLogs = await k8sService.getPodLogs(
            CP_DATABASES_NAMESPACE,
            podName,
            options.container ?? "mongod",
            tailLines
          );

          const logs = parseLogLines(rawLogs, "database", databaseId, databaseName);

          results.push({
            logs,
            source: "database",
            sourceId: databaseId,
            sourceName: databaseName,
            podName,
          });
        } catch (error: any) {
          logger.log({
            level: "warn",
            message: `[LogsService] Failed to get logs for pod ${podName}: ${error.message}`,
          });
          results.push({
            logs: [
              {
                timestamp: new Date(),
                level: "error",
                source: "database",
                sourceId: databaseId,
                sourceName: databaseName,
                message: `Failed to retrieve logs: ${error.message}`,
              },
            ],
            source: "database",
            sourceId: databaseId,
            sourceName: databaseName,
            podName,
          });
        }
      }

      return results;
    } catch (error: any) {
      if (error instanceof NotFoundError) throw error;
      logger.log({
        level: "error",
        message: `[LogsService] getDatabaseLogs failed for ${databaseName}: ${error.message}`,
      });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // System Logs
  // ---------------------------------------------------------------------------

  /**
   * Get control-plane API logs from file
   */
  async function getSystemLogs(options: TLogOptions = {}): Promise<TLogResult> {
    const tailLines = Math.min(options.tailLines ?? DEFAULT_TAIL_LINES, MAX_TAIL_LINES);
    const logs: TLogEntry[] = [];

    const logFilePath = path.join(SYSTEM_LOG_DIR, "combined.log");

    try {
      // Check if log file exists
      if (!fs.existsSync(logFilePath)) {
        return {
          logs: [
            {
              timestamp: new Date(),
              level: "info",
              source: "system",
              message: "No system logs available (file logging may be disabled)",
            },
          ],
          source: "system",
          sourceName: "control-plane-api",
        };
      }

      // Read last N lines from log file
      const fileContent = await readLastLines(logFilePath, tailLines);
      const parsedLogs = parseLogLines(fileContent, "system", undefined, "control-plane-api");
      logs.push(...parsedLogs);

      return {
        logs,
        source: "system",
        sourceName: "control-plane-api",
      };
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `[LogsService] getSystemLogs failed: ${error.message}`,
      });
      throw new InternalServerError(`Failed to read system logs: ${error.message}`);
    }
  }

  /**
   * Read last N lines from a file
   */
  async function readLastLines(filePath: string, numLines: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const lines: string[] = [];
      const stream = fs.createReadStream(filePath, { encoding: "utf8" });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      rl.on("line", (line) => {
        lines.push(line);
        if (lines.length > numLines) {
          lines.shift();
        }
      });

      rl.on("close", () => {
        resolve(lines.join("\n"));
      });

      rl.on("error", reject);
    });
  }

  // ---------------------------------------------------------------------------
  // Operator Logs
  // ---------------------------------------------------------------------------

  /**
   * Get Percona operator logs
   */
  async function getOperatorLogs(options: TLogOptions = {}): Promise<TLogResult[]> {
    const tailLines = Math.min(options.tailLines ?? DEFAULT_TAIL_LINES, MAX_TAIL_LINES);
    const results: TLogResult[] = [];

    try {
      // List Percona operator pods
      const pods = await k8sService.listPods(CP_DATABASES_NAMESPACE, PERCONA_OPERATOR_LABEL);

      if (pods.length === 0) {
        throw new NotFoundError("No Percona operator pods found");
      }

      // If specific pod requested, filter to that one
      const targetPods = options.podName
        ? pods.filter((p) => p.metadata?.name === options.podName)
        : pods;

      if (options.podName && targetPods.length === 0) {
        throw new NotFoundError(`Pod ${options.podName} not found for Percona operator`);
      }

      for (const pod of targetPods) {
        const podName = pod.metadata?.name;
        if (!podName) continue;

        try {
          // Operator container name varies, try common names
          const containerName = options.container ?? "percona-server-mongodb-operator";
          const rawLogs = await k8sService.getPodLogs(
            CP_DATABASES_NAMESPACE,
            podName,
            containerName,
            tailLines
          );

          const logs = parseLogLines(rawLogs, "operator", undefined, "percona-psmdb-operator");

          results.push({
            logs,
            source: "operator",
            sourceName: "percona-psmdb-operator",
            podName,
          });
        } catch (error: any) {
          logger.log({
            level: "warn",
            message: `[LogsService] Failed to get logs for pod ${podName}: ${error.message}`,
          });
          results.push({
            logs: [
              {
                timestamp: new Date(),
                level: "error",
                source: "operator",
                sourceName: "percona-psmdb-operator",
                message: `Failed to retrieve logs: ${error.message}`,
              },
            ],
            source: "operator",
            sourceName: "percona-psmdb-operator",
            podName,
          });
        }
      }

      return results;
    } catch (error: any) {
      if (error instanceof NotFoundError) throw error;
      logger.log({
        level: "error",
        message: `[LogsService] getOperatorLogs failed: ${error.message}`,
      });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Search Logs
  // ---------------------------------------------------------------------------

  /**
   * Search across all log sources
   */
  async function searchLogs(
    query: TLogQuery,
    apps: Array<{ id: string; name: string }>,
    databases: Array<{ id: string; name: string }>
  ): Promise<TLogEntry[]> {
    const limit = query.limit ?? 500;
    const allLogs: TLogEntry[] = [];
    const options: TLogOptions = { tailLines: limit };

    const sources = query.source ? [query.source] : logSources;

    // Gather logs from specified sources
    const promises: Promise<void>[] = [];

    if (sources.includes("app")) {
      for (const app of apps) {
        // Skip if sourceId specified and doesn't match
        if (query.sourceId && query.sourceId !== app.id) continue;

        promises.push(
          getAppLogs(app.id, app.name, options)
            .then((results) => {
              for (const result of results) {
                allLogs.push(...result.logs);
              }
            })
            .catch((error) => {
              logger.log({
                level: "warn",
                message: `[LogsService] searchLogs: failed to get app logs for ${app.name}: ${error.message}`,
              });
            })
        );
      }
    }

    if (sources.includes("database")) {
      for (const db of databases) {
        // Skip if sourceId specified and doesn't match
        if (query.sourceId && query.sourceId !== db.id) continue;

        promises.push(
          getDatabaseLogs(db.id, db.name, options)
            .then((results) => {
              for (const result of results) {
                allLogs.push(...result.logs);
              }
            })
            .catch((error) => {
              logger.log({
                level: "warn",
                message: `[LogsService] searchLogs: failed to get database logs for ${db.name}: ${error.message}`,
              });
            })
        );
      }
    }

    if (sources.includes("system") && !query.sourceId) {
      promises.push(
        getSystemLogs(options)
          .then((result) => {
            allLogs.push(...result.logs);
          })
          .catch((error) => {
            logger.log({
              level: "warn",
              message: `[LogsService] searchLogs: failed to get system logs: ${error.message}`,
            });
          })
      );
    }

    if (sources.includes("operator") && !query.sourceId) {
      promises.push(
        getOperatorLogs(options)
          .then((results) => {
            for (const result of results) {
              allLogs.push(...result.logs);
            }
          })
          .catch((error) => {
            logger.log({
              level: "warn",
              message: `[LogsService] searchLogs: failed to get operator logs: ${error.message}`,
            });
          })
      );
    }

    await Promise.all(promises);

    // Apply filters
    let filtered = filterLogs(allLogs, query);

    // Sort by timestamp descending (most recent first)
    filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply limit
    return filtered.slice(0, limit);
  }

  // ---------------------------------------------------------------------------
  // Streaming Logs
  // ---------------------------------------------------------------------------

  /**
   * Create SSE stream for live app logs
   */
  async function streamAppLogs(
    appName: string,
    options: TLogOptions = {}
  ): Promise<{ stream: Readable; cleanup: () => void }> {
    try {
      // Get first pod for streaming
      const pods = await k8sService.listPods(CP_APPS_NAMESPACE, `app=${appName}`);

      if (pods.length === 0) {
        throw new NotFoundError(`No pods found for app ${appName}`);
      }

      const targetPod = options.podName
        ? pods.find((p) => p.metadata?.name === options.podName)
        : pods[0];

      if (!targetPod?.metadata?.name) {
        throw new NotFoundError(
          options.podName
            ? `Pod ${options.podName} not found for app ${appName}`
            : `No valid pod found for app ${appName}`
        );
      }

      const podName = targetPod.metadata.name;
      const container = options.container ?? "app";

      // Create streaming log watch using K8s API
      const kc = k8sService.getKubeConfig();
      if (!kc) {
        throw new InternalServerError("Kubernetes client not initialized");
      }

      const log = new k8sLib.Log(kc);
      const passThrough = new PassThrough();

      const logStream = await log.log(
        CP_APPS_NAMESPACE,
        podName,
        container,
        passThrough,
        {
          follow: true,
          tailLines: options.tailLines ?? 50,
          timestamps: true,
        }
      );

      const cleanup = () => {
        try {
          passThrough.destroy();
          if (logStream && typeof (logStream as any).abort === "function") {
            (logStream as any).abort();
          }
        } catch {
          // Ignore cleanup errors
        }
      };

      return { stream: passThrough, cleanup };
    } catch (error: any) {
      if (error instanceof NotFoundError) throw error;
      logger.log({
        level: "error",
        message: `[LogsService] streamAppLogs failed for ${appName}: ${error.message}`,
      });
      throw new InternalServerError(`Failed to stream logs: ${error.message}`);
    }
  }

  /**
   * Create SSE stream for live database logs
   */
  async function streamDatabaseLogs(
    databaseName: string,
    options: TLogOptions = {}
  ): Promise<{ stream: Readable; cleanup: () => void }> {
    try {
      // Get first pod for streaming
      const pods = await k8sService.listPods(
        CP_DATABASES_NAMESPACE,
        `app.kubernetes.io/instance=${databaseName}`
      );

      if (pods.length === 0) {
        throw new NotFoundError(`No pods found for database ${databaseName}`);
      }

      const targetPod = options.podName
        ? pods.find((p) => p.metadata?.name === options.podName)
        : pods[0];

      if (!targetPod?.metadata?.name) {
        throw new NotFoundError(
          options.podName
            ? `Pod ${options.podName} not found for database ${databaseName}`
            : `No valid pod found for database ${databaseName}`
        );
      }

      const podName = targetPod.metadata.name;
      const container = options.container ?? "mongod";

      // Create streaming log watch using K8s API
      const kc = k8sService.getKubeConfig();
      if (!kc) {
        throw new InternalServerError("Kubernetes client not initialized");
      }

      const log = new k8sLib.Log(kc);
      const passThrough = new PassThrough();

      const logStream = await log.log(
        CP_DATABASES_NAMESPACE,
        podName,
        container,
        passThrough,
        {
          follow: true,
          tailLines: options.tailLines ?? 50,
          timestamps: true,
        }
      );

      const cleanup = () => {
        try {
          passThrough.destroy();
          if (logStream && typeof (logStream as any).abort === "function") {
            (logStream as any).abort();
          }
        } catch {
          // Ignore cleanup errors
        }
      };

      return { stream: passThrough, cleanup };
    } catch (error: any) {
      if (error instanceof NotFoundError) throw error;
      logger.log({
        level: "error",
        message: `[LogsService] streamDatabaseLogs failed for ${databaseName}: ${error.message}`,
      });
      throw new InternalServerError(`Failed to stream logs: ${error.message}`);
    }
  }

  return {
    // Log retrieval
    getAppLogs,
    getDatabaseLogs,
    getSystemLogs,
    getOperatorLogs,
    searchLogs,
    // Streaming
    streamAppLogs,
    streamDatabaseLogs,
    // Utilities
    parseLogLines,
    filterLogs,
  };
}
