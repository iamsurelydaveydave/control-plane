import { useAlertRepo } from "./alert.repository";
import { useNodeRepo } from "../node/node.repository";
import { useDatabaseRepo } from "../database/database.repository";
import { useClusterRepo } from "../cluster/cluster.repository";
import { TAlertInput, TAlertSeverity, TAlertSource, modelAlert } from "./alert.model";
import { logger } from "../../utils";
import { useWebhookService } from "../webhook/webhook.service";
import os from "os";

// Deduplication window in hours
const DEDUP_HOURS = 1;

// System resource thresholds
const CPU_WARNING_THRESHOLD = 80;
const CPU_CRITICAL_THRESHOLD = 95;
const MEMORY_WARNING_THRESHOLD = 80;
const MEMORY_CRITICAL_THRESHOLD = 95;

export function useAlertService() {
  const repo = useAlertRepo();
  const nodeRepo = useNodeRepo();
  const databaseRepo = useDatabaseRepo();
  const clusterRepo = useClusterRepo();
  const webhookService = useWebhookService();

  /**
   * Create an alert with deduplication.
   * Doesn't create if an identical alert (same title, source, sourceId) exists within DEDUP_HOURS.
   */
  async function createAlert(data: TAlertInput): Promise<string | null> {
    // Check for recent duplicate alerts
    const recentAlerts = await repo.getRecentBySource(data.source, data.sourceId, DEDUP_HOURS);
    
    const isDuplicate = recentAlerts.some(
      (alert) => alert.title === data.title && alert.source === data.source && alert.sourceId === data.sourceId
    );

    if (isDuplicate) {
      logger.log({
        level: "debug",
        message: `Skipping duplicate alert: ${data.title} (source: ${data.source}, sourceId: ${data.sourceId})`,
      });
      return null;
    }

    const alertData = modelAlert(data);
    const alertId = await repo.add(alertData);

    // Trigger webhook notification
    webhookService.trigger("alert.created", {
      alertId,
      title: data.title,
      message: data.message,
      severity: data.severity,
      source: data.source,
      sourceId: data.sourceId,
      createdAt: new Date().toISOString(),
    });

    logger.log({
      level: "info",
      message: `Alert created: ${data.title} (${data.severity})`,
    });

    return alertId;
  }

  /**
   * Check database health and create alerts for unhealthy databases.
   */
  async function checkDatabaseHealth(): Promise<{ checked: number; alerts: number }> {
    let alertsCreated = 0;
    const healthyDatabaseIds: string[] = [];

    try {
      // Get all databases (unpaginated for health check)
      const databases = await databaseRepo.getAll({ page: 1, limit: 1000 });

      for (const db of databases.items) {
        const dbId = db._id?.toString();
        if (!dbId) continue;

        // Check if database is in unhealthy state
        if (db.status === "failed" || db.status === "unknown") {
          const alert = await createAlert({
            title: `Database ${db.name} is ${db.status}`,
            message: `Database "${db.name}" is in ${db.status} state. Check the database logs for more details.`,
            severity: db.status === "failed" ? "critical" : "warning",
            source: "database",
            sourceId: dbId,
            metadata: {
              databaseName: db.name,
              databaseType: db.type,
              status: db.status,
            },
          });
          if (alert) alertsCreated++;
        } else if (db.status === "stopped") {
          const alert = await createAlert({
            title: `Database ${db.name} is stopped`,
            message: `Database "${db.name}" is currently stopped.`,
            severity: "info",
            source: "database",
            sourceId: dbId,
            metadata: {
              databaseName: db.name,
              databaseType: db.type,
              status: db.status,
            },
          });
          if (alert) alertsCreated++;
        } else if (db.status === "running") {
          // Database is healthy - mark for auto-resolve
          healthyDatabaseIds.push(dbId);
        }
      }

      // Auto-resolve alerts for now-healthy databases
      if (healthyDatabaseIds.length > 0) {
        const resolved = await repo.autoResolveMany("database", healthyDatabaseIds);
        if (resolved > 0) {
          // Trigger webhook for resolved alerts
          for (const dbId of healthyDatabaseIds) {
            webhookService.trigger("alert.resolved", {
              source: "database",
              sourceId: dbId,
              resolvedAt: new Date().toISOString(),
              autoResolved: true,
            });
          }
          logger.log({
            level: "info",
            message: `Auto-resolved ${resolved} database alerts for healthy databases`,
          });
        }
      }

      return { checked: databases.items.length, alerts: alertsCreated };
    } catch (error) {
      logger.log({
        level: "error",
        message: `Database health check failed: ${error}`,
      });
      return { checked: 0, alerts: 0 };
    }
  }

  /**
   * Check node health and create alerts for offline/not-ready nodes.
   */
  async function checkNodeHealth(): Promise<{ checked: number; alerts: number }> {
    let alertsCreated = 0;
    const healthyNodeIds: string[] = [];

    try {
      const nodes = await nodeRepo.getAll();

      for (const node of nodes) {
        const nodeId = node._id?.toString();
        if (!nodeId) continue;

        if (node.status === "offline" || node.status === "failed") {
          const alert = await createAlert({
            title: `Node ${node.name} is ${node.status}`,
            message: `Node "${node.name}" (${node.host || "unknown host"}) is ${node.status}. ${node.statusMessage || ""}`,
            severity: "critical",
            source: "node",
            sourceId: nodeId,
            metadata: {
              nodeName: node.name,
              nodeHost: node.host,
              nodeRole: node.role,
              status: node.status,
              statusMessage: node.statusMessage,
            },
          });
          if (alert) alertsCreated++;
        } else if (node.status === "not-ready") {
          const alert = await createAlert({
            title: `Node ${node.name} is not ready`,
            message: `Node "${node.name}" (${node.host || "unknown host"}) is in not-ready state. Check node conditions.`,
            severity: "warning",
            source: "node",
            sourceId: nodeId,
            metadata: {
              nodeName: node.name,
              nodeHost: node.host,
              nodeRole: node.role,
              status: node.status,
              conditions: node.conditions,
            },
          });
          if (alert) alertsCreated++;
        } else if (node.status === "ready") {
          // Node is healthy - mark for auto-resolve
          healthyNodeIds.push(nodeId);
        }
      }

      // Auto-resolve alerts for now-healthy nodes
      if (healthyNodeIds.length > 0) {
        const resolved = await repo.autoResolveMany("node", healthyNodeIds);
        if (resolved > 0) {
          // Trigger webhook for resolved alerts
          for (const nodeId of healthyNodeIds) {
            webhookService.trigger("alert.resolved", {
              source: "node",
              sourceId: nodeId,
              resolvedAt: new Date().toISOString(),
              autoResolved: true,
            });
          }
          logger.log({
            level: "info",
            message: `Auto-resolved ${resolved} node alerts for healthy nodes`,
          });
        }
      }

      return { checked: nodes.length, alerts: alertsCreated };
    } catch (error) {
      logger.log({
        level: "error",
        message: `Node health check failed: ${error}`,
      });
      return { checked: 0, alerts: 0 };
    }
  }

  /**
   * Check cluster health status.
   */
  async function checkClusterHealth(): Promise<{ checked: number; alerts: number }> {
    let alertsCreated = 0;
    const healthyClusterIds: string[] = [];

    try {
      const clusters = await clusterRepo.getAll();

      for (const cluster of clusters) {
        const clusterId = cluster._id?.toString();
        if (!clusterId) continue;

        if (cluster.status === "unreachable") {
          const alert = await createAlert({
            title: `Cluster ${cluster.name} is unreachable`,
            message: `Cluster "${cluster.name}" (${cluster.type}) is unreachable. Check network connectivity and API server.`,
            severity: "critical",
            source: "cluster",
            sourceId: clusterId,
            metadata: {
              clusterName: cluster.name,
              clusterType: cluster.type,
              apiServerUrl: cluster.apiServerUrl,
              status: cluster.status,
            },
          });
          if (alert) alertsCreated++;
        } else if (cluster.status === "unknown") {
          const alert = await createAlert({
            title: `Cluster ${cluster.name} status unknown`,
            message: `Cluster "${cluster.name}" (${cluster.type}) status is unknown. Sync may have failed.`,
            severity: "warning",
            source: "cluster",
            sourceId: clusterId,
            metadata: {
              clusterName: cluster.name,
              clusterType: cluster.type,
              status: cluster.status,
            },
          });
          if (alert) alertsCreated++;
        } else if (cluster.status === "connected") {
          // Cluster is healthy - mark for auto-resolve
          healthyClusterIds.push(clusterId);
        }
      }

      // Auto-resolve alerts for now-healthy clusters
      if (healthyClusterIds.length > 0) {
        const resolved = await repo.autoResolveMany("cluster", healthyClusterIds);
        if (resolved > 0) {
          // Trigger webhook for resolved alerts
          for (const clusterId of healthyClusterIds) {
            webhookService.trigger("alert.resolved", {
              source: "cluster",
              sourceId: clusterId,
              resolvedAt: new Date().toISOString(),
              autoResolved: true,
            });
          }
          logger.log({
            level: "info",
            message: `Auto-resolved ${resolved} cluster alerts for healthy clusters`,
          });
        }
      }

      return { checked: clusters.length, alerts: alertsCreated };
    } catch (error) {
      logger.log({
        level: "error",
        message: `Cluster health check failed: ${error}`,
      });
      return { checked: 0, alerts: 0 };
    }
  }

  /**
   * Check system resources (CPU, memory) and create alerts for high usage.
   */
  async function checkSystemResources(): Promise<{ alerts: number }> {
    let alertsCreated = 0;

    try {
      // Get CPU load (1-minute average as percentage)
      const cpus = os.cpus();
      const loadAvg = os.loadavg()[0]; // 1-minute load average
      const cpuPercent = Math.round((loadAvg / cpus.length) * 100);

      // Get memory usage
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const memPercent = Math.round((usedMem / totalMem) * 100);

      // CPU alerts
      if (cpuPercent >= CPU_CRITICAL_THRESHOLD) {
        const alert = await createAlert({
          title: "Critical CPU usage",
          message: `CPU usage is at ${cpuPercent}%, which exceeds the critical threshold of ${CPU_CRITICAL_THRESHOLD}%.`,
          severity: "critical",
          source: "system",
          sourceId: "cpu",
          metadata: {
            cpuPercent,
            loadAverage: loadAvg,
            cpuCount: cpus.length,
            threshold: CPU_CRITICAL_THRESHOLD,
          },
        });
        if (alert) alertsCreated++;
      } else if (cpuPercent >= CPU_WARNING_THRESHOLD) {
        const alert = await createAlert({
          title: "High CPU usage",
          message: `CPU usage is at ${cpuPercent}%, which exceeds the warning threshold of ${CPU_WARNING_THRESHOLD}%.`,
          severity: "warning",
          source: "system",
          sourceId: "cpu",
          metadata: {
            cpuPercent,
            loadAverage: loadAvg,
            cpuCount: cpus.length,
            threshold: CPU_WARNING_THRESHOLD,
          },
        });
        if (alert) alertsCreated++;
      } else {
        // CPU is healthy - auto-resolve any existing alerts
        const resolved = await repo.autoResolve("system", "cpu");
        if (resolved > 0) {
          webhookService.trigger("alert.resolved", {
            source: "system",
            sourceId: "cpu",
            resolvedAt: new Date().toISOString(),
            autoResolved: true,
          });
        }
      }

      // Memory alerts
      if (memPercent >= MEMORY_CRITICAL_THRESHOLD) {
        const alert = await createAlert({
          title: "Critical memory usage",
          message: `Memory usage is at ${memPercent}%, which exceeds the critical threshold of ${MEMORY_CRITICAL_THRESHOLD}%.`,
          severity: "critical",
          source: "system",
          sourceId: "memory",
          metadata: {
            memPercent,
            totalMem: Math.round(totalMem / 1024 / 1024 / 1024 * 100) / 100,
            usedMem: Math.round(usedMem / 1024 / 1024 / 1024 * 100) / 100,
            freeMem: Math.round(freeMem / 1024 / 1024 / 1024 * 100) / 100,
            threshold: MEMORY_CRITICAL_THRESHOLD,
          },
        });
        if (alert) alertsCreated++;
      } else if (memPercent >= MEMORY_WARNING_THRESHOLD) {
        const alert = await createAlert({
          title: "High memory usage",
          message: `Memory usage is at ${memPercent}%, which exceeds the warning threshold of ${MEMORY_WARNING_THRESHOLD}%.`,
          severity: "warning",
          source: "system",
          sourceId: "memory",
          metadata: {
            memPercent,
            totalMem: Math.round(totalMem / 1024 / 1024 / 1024 * 100) / 100,
            usedMem: Math.round(usedMem / 1024 / 1024 / 1024 * 100) / 100,
            freeMem: Math.round(freeMem / 1024 / 1024 / 1024 * 100) / 100,
            threshold: MEMORY_WARNING_THRESHOLD,
          },
        });
        if (alert) alertsCreated++;
      } else {
        // Memory is healthy - auto-resolve any existing alerts
        const resolved = await repo.autoResolve("system", "memory");
        if (resolved > 0) {
          webhookService.trigger("alert.resolved", {
            source: "system",
            sourceId: "memory",
            resolvedAt: new Date().toISOString(),
            autoResolved: true,
          });
        }
      }

      return { alerts: alertsCreated };
    } catch (error) {
      logger.log({
        level: "error",
        message: `System resource check failed: ${error}`,
      });
      return { alerts: 0 };
    }
  }

  /**
   * Run all health checks.
   */
  async function runAllHealthChecks(): Promise<{
    database: { checked: number; alerts: number };
    node: { checked: number; alerts: number };
    cluster: { checked: number; alerts: number };
    system: { alerts: number };
    totalAlerts: number;
  }> {
    const [database, node, cluster, system] = await Promise.all([
      checkDatabaseHealth(),
      checkNodeHealth(),
      checkClusterHealth(),
      checkSystemResources(),
    ]);

    const totalAlerts = database.alerts + node.alerts + cluster.alerts + system.alerts;

    return { database, node, cluster, system, totalAlerts };
  }

  return {
    createAlert,
    checkDatabaseHealth,
    checkNodeHealth,
    checkClusterHealth,
    checkSystemResources,
    runAllHealthChecks,
  };
}
