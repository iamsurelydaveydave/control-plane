import os from "os";
import { useK8sService, TK8sResource } from "./k8s.service";
import { useRepo } from "../utils/repo";
import { makeCacheKey } from "../utils/make-cache-key";
import { InternalServerError } from "../utils/error";
import { logger } from "../utils";

// =============================================================================
// Types
// =============================================================================

export type TSystemMetrics = {
  hostname: string;
  platform: string;
  arch: string;
  uptime: number;
  cpu: {
    cores: number;
    model: string;
    loadAverage: number[];
    usagePercent: number;
  };
  memory: {
    total: number;       // bytes
    free: number;        // bytes
    used: number;        // bytes
    usagePercent: number;
  };
  process: {
    uptime: number;
    memoryUsed: number;  // bytes
    memoryTotal: number; // bytes
  };
};

export type TClusterMetrics = {
  available: boolean;
  nodes: {
    total: number;
    ready: number;
    items: Array<{
      name: string;
      status: "Ready" | "NotReady" | "Unknown";
      cpu?: { capacity: string; usage?: string; usagePercent?: number };
      memory?: { capacity: string; usage?: string; usagePercent?: number };
      pods?: { capacity: number; running: number };
    }>;
  };
  pods: {
    total: number;
    running: number;
    pending: number;
    failed: number;
  };
  totals?: {
    cpuCapacity: string;
    cpuUsage?: string;
    memoryCapacity: string;
    memoryUsage?: string;
  };
};

export type TResourceMetrics = {
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  items: Array<{
    _id: string;
    name: string;
    type: string;
    status: string;
  }>;
};

export type TAppMetrics = {
  total: number;
  byStatus: Record<string, number>;
  items: Array<{
    _id: string;
    name: string;
    status: string;
    serverCount: number;
    deployedAt?: string;
  }>;
};

export type TMetricsOverview = {
  timestamp: string;
  system: {
    cpuUsagePercent: number;
    memoryUsagePercent: number;
    uptime: number;
  };
  cluster: {
    available: boolean;
    nodesTotal: number;
    nodesReady: number;
    podsRunning: number;
  };
  resources: {
    total: number;
    running: number;
  };
  apps: {
    total: number;
    running: number;
  };
};

// =============================================================================
// Node metrics type (from metrics-server)
// =============================================================================

type TK8sNodeMetrics = TK8sResource & {
  timestamp: string;
  window: string;
  usage: {
    cpu: string;    // e.g., "250m"
    memory: string; // e.g., "1024Mi"
  };
};

type TK8sPodMetrics = TK8sResource & {
  timestamp: string;
  window: string;
  containers: Array<{
    name: string;
    usage: { cpu: string; memory: string };
  }>;
};

// =============================================================================
// Helpers
// =============================================================================

const CACHE_TTL = 30; // 30 seconds for metrics

/**
 * Parse K8s CPU quantity to millicores
 */
function parseCpuToMillicores(cpu: string): number {
  if (!cpu) return 0;
  if (cpu.endsWith("m")) {
    return parseInt(cpu.slice(0, -1), 10);
  }
  if (cpu.endsWith("n")) {
    return Math.round(parseInt(cpu.slice(0, -1), 10) / 1_000_000);
  }
  // Plain number = cores
  return parseInt(cpu, 10) * 1000;
}

/**
 * Parse K8s memory quantity to bytes
 */
function parseMemoryToBytes(memory: string): number {
  if (!memory) return 0;
  const units: Record<string, number> = {
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    K: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
  };
  for (const [suffix, multiplier] of Object.entries(units)) {
    if (memory.endsWith(suffix)) {
      return parseInt(memory.slice(0, -suffix.length), 10) * multiplier;
    }
  }
  return parseInt(memory, 10);
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)}Ki`;
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 ** 2)}Mi`;
  return `${Math.round(bytes / 1024 ** 3)}Gi`;
}

// =============================================================================
// Service
// =============================================================================

export function useMetricsService() {
  const k8s = useK8sService();

  // Repos for counting resources
  const addonRepo = useRepo("cp_addons");
  const appRepo = useRepo("cp_apps");

  /**
   * Get system metrics (CPU, memory, disk of the control plane server)
   */
  async function getSystemMetrics(): Promise<TSystemMetrics> {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    // Calculate CPU usage from idle time (approximation)
    const cpuUsage = cpus.reduce((acc, cpu) => {
      const times = cpu.times as { user: number; nice: number; sys: number; idle: number; irq: number };
      const total = times.user + times.nice + times.sys + times.idle + times.irq;
      const idle = times.idle;
      return acc + ((total - idle) / total) * 100;
    }, 0) / cpus.length;

    return {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      uptime: os.uptime(),
      cpu: {
        cores: cpus.length,
        model: cpus[0]?.model || "Unknown",
        loadAverage: os.loadavg(),
        usagePercent: Math.round(cpuUsage * 100) / 100,
      },
      memory: {
        total: totalMem,
        free: freeMem,
        used: usedMem,
        usagePercent: Math.round((usedMem / totalMem) * 10000) / 100,
      },
      process: {
        uptime: Math.round(process.uptime()),
        memoryUsed: process.memoryUsage().heapUsed,
        memoryTotal: process.memoryUsage().heapTotal,
      },
    };
  }

  /**
   * Get K8s cluster metrics
   */
  async function getClusterMetrics(): Promise<TClusterMetrics> {
    const cacheKey = makeCacheKey("metrics", { tag: "cluster" });
    const cached = await addonRepo.getCache<TClusterMetrics>(cacheKey);
    if (cached) return cached;

    const k8sEnabled = process.env.K8S_ENABLED === "true";
    if (!k8sEnabled) {
      return {
        available: false,
        nodes: { total: 0, ready: 0, items: [] },
        pods: { total: 0, running: 0, pending: 0, failed: 0 },
      };
    }

    try {
      const available = await k8s.isAvailable();
      if (!available) {
        return {
          available: false,
          nodes: { total: 0, ready: 0, items: [] },
          pods: { total: 0, running: 0, pending: 0, failed: 0 },
        };
      }

      // Get nodes
      const nodes = await k8s.getNodes();

      // Try to get node metrics from metrics-server
      let nodeMetrics: TK8sNodeMetrics[] = [];
      try {
        const metricsResponse = await k8s.request<{ items: TK8sNodeMetrics[] }>(
          "GET",
          "/apis/metrics.k8s.io/v1beta1/nodes"
        );
        nodeMetrics = metricsResponse.items || [];
      } catch (err) {
        // metrics-server not available
        logger.log({ level: "debug", message: "[Metrics] metrics-server not available for nodes" });
      }

      // Build node items with metrics
      const nodeItems = nodes.map((node) => {
        const conditions = (node.status as any)?.conditions || [];
        const readyCondition = conditions.find((c: any) => c.type === "Ready");
        const isReady = readyCondition?.status === "True";

        const capacity = (node.status as any)?.capacity || {};
        const allocatable = (node.status as any)?.allocatable || {};

        // Find matching metrics
        const metrics = nodeMetrics.find((m) => m.metadata.name === node.metadata.name);

        let cpuData: { capacity: string; usage?: string; usagePercent?: number } | undefined;
        let memoryData: { capacity: string; usage?: string; usagePercent?: number } | undefined;

        if (allocatable.cpu) {
          const cpuCapacityMc = parseCpuToMillicores(allocatable.cpu);
          cpuData = { capacity: allocatable.cpu };

          if (metrics?.usage?.cpu) {
            const cpuUsageMc = parseCpuToMillicores(metrics.usage.cpu);
            cpuData.usage = metrics.usage.cpu;
            cpuData.usagePercent = Math.round((cpuUsageMc / cpuCapacityMc) * 10000) / 100;
          }
        }

        if (allocatable.memory) {
          const memCapacityBytes = parseMemoryToBytes(allocatable.memory);
          memoryData = { capacity: allocatable.memory };

          if (metrics?.usage?.memory) {
            const memUsageBytes = parseMemoryToBytes(metrics.usage.memory);
            memoryData.usage = metrics.usage.memory;
            memoryData.usagePercent = Math.round((memUsageBytes / memCapacityBytes) * 10000) / 100;
          }
        }

        return {
          name: node.metadata.name,
          status: isReady ? "Ready" : "NotReady" as "Ready" | "NotReady" | "Unknown",
          cpu: cpuData,
          memory: memoryData,
          pods: allocatable.pods
            ? { capacity: parseInt(allocatable.pods, 10), running: 0 }
            : undefined,
        };
      });

      const readyNodes = nodeItems.filter((n) => n.status === "Ready").length;

      // Get all pods in all namespaces
      let podsTotal = 0;
      let podsRunning = 0;
      let podsPending = 0;
      let podsFailed = 0;

      try {
        const podsResponse = await k8s.request<{ items: TK8sResource[] }>(
          "GET",
          "/api/v1/pods"
        );
        const pods = podsResponse.items || [];
        podsTotal = pods.length;

        for (const pod of pods) {
          const phase = (pod.status as any)?.phase;
          if (phase === "Running") podsRunning++;
          else if (phase === "Pending") podsPending++;
          else if (phase === "Failed") podsFailed++;
        }

        // Count pods per node
        for (const nodeItem of nodeItems) {
          if (nodeItem.pods) {
            nodeItem.pods.running = pods.filter(
              (p) => (p.spec as any)?.nodeName === nodeItem.name && (p.status as any)?.phase === "Running"
            ).length;
          }
        }
      } catch (err) {
        logger.log({ level: "warn", message: "[Metrics] Failed to list pods" });
      }

      // Calculate totals
      let totalCpuCapacityMc = 0;
      let totalCpuUsageMc = 0;
      let totalMemCapacityBytes = 0;
      let totalMemUsageBytes = 0;

      for (const node of nodeItems) {
        if (node.cpu?.capacity) {
          totalCpuCapacityMc += parseCpuToMillicores(node.cpu.capacity);
        }
        if (node.cpu?.usage) {
          totalCpuUsageMc += parseCpuToMillicores(node.cpu.usage);
        }
        if (node.memory?.capacity) {
          totalMemCapacityBytes += parseMemoryToBytes(node.memory.capacity);
        }
        if (node.memory?.usage) {
          totalMemUsageBytes += parseMemoryToBytes(node.memory.usage);
        }
      }

      const result: TClusterMetrics = {
        available: true,
        nodes: {
          total: nodes.length,
          ready: readyNodes,
          items: nodeItems,
        },
        pods: {
          total: podsTotal,
          running: podsRunning,
          pending: podsPending,
          failed: podsFailed,
        },
        totals:
          totalCpuCapacityMc > 0
            ? {
                cpuCapacity: `${totalCpuCapacityMc}m`,
                cpuUsage: totalCpuUsageMc > 0 ? `${totalCpuUsageMc}m` : undefined,
                memoryCapacity: formatBytes(totalMemCapacityBytes),
                memoryUsage: totalMemUsageBytes > 0 ? formatBytes(totalMemUsageBytes) : undefined,
              }
            : undefined,
      };

      addonRepo.setCache(cacheKey, result, CACHE_TTL);
      return result;
    } catch (err: any) {
      logger.log({ level: "error", message: `[Metrics] Cluster metrics error: ${err.message}` });
      return {
        available: false,
        nodes: { total: 0, ready: 0, items: [] },
        pods: { total: 0, running: 0, pending: 0, failed: 0 },
      };
    }
  }

  /**
   * Get resource (addons) metrics summary
   */
  async function getResourceMetrics(): Promise<TResourceMetrics> {
    const cacheKey = makeCacheKey("metrics", { tag: "resources" });
    const cached = await addonRepo.getCache<TResourceMetrics>(cacheKey);
    if (cached) return cached;

    try {
      const resources = await addonRepo.collection
        .find({})
        .project({ name: 1, type: 1, status: 1 })
        .toArray();

      const byType: Record<string, number> = {};
      const byStatus: Record<string, number> = {};

      const items = resources.map((resource) => {
        const type = resource.type || "unknown";
        const status = resource.status || "unknown";

        byType[type] = (byType[type] || 0) + 1;
        byStatus[status] = (byStatus[status] || 0) + 1;

        return {
          _id: resource._id.toString(),
          name: resource.name,
          type,
          status,
        };
      });

      const result: TResourceMetrics = {
        total: resources.length,
        byType,
        byStatus,
        items,
      };

      addonRepo.setCache(cacheKey, result, CACHE_TTL);
      return result;
    } catch (err: any) {
      logger.log({ level: "error", message: `[Metrics] Resource metrics error: ${err.message}` });
      throw new InternalServerError("Failed to get resource metrics");
    }
  }

  /**
   * Get app metrics summary
   */
  async function getAppMetrics(): Promise<TAppMetrics> {
    const cacheKey = makeCacheKey("metrics", { tag: "apps" });
    const cached = await appRepo.getCache<TAppMetrics>(cacheKey);
    if (cached) return cached;

    try {
      const apps = await appRepo.collection
        .find({})
        .project({ name: 1, status: 1, serverIds: 1, deployedAt: 1 })
        .toArray();

      const byStatus: Record<string, number> = {};

      const items = apps.map((app) => {
        const status = app.status || "unknown";
        byStatus[status] = (byStatus[status] || 0) + 1;

        return {
          _id: app._id.toString(),
          name: app.name,
          status,
          serverCount: (app.serverIds || []).length,
          deployedAt: app.deployedAt,
        };
      });

      const result: TAppMetrics = {
        total: apps.length,
        byStatus,
        items,
      };

      appRepo.setCache(cacheKey, result, CACHE_TTL);
      return result;
    } catch (err: any) {
      logger.log({ level: "error", message: `[Metrics] App metrics error: ${err.message}` });
      throw new InternalServerError("Failed to get app metrics");
    }
  }

  /**
   * Get overview metrics for dashboard
   */
  async function getOverview(): Promise<TMetricsOverview> {
    const cacheKey = makeCacheKey("metrics", { tag: "overview" });
    const cached = await addonRepo.getCache<TMetricsOverview>(cacheKey);
    if (cached) return cached;

    const [system, cluster, resources, apps] = await Promise.all([
      getSystemMetrics(),
      getClusterMetrics(),
      getResourceMetrics(),
      getAppMetrics(),
    ]);

    const runningResourceCount = resources.byStatus["running"] || 0;
    const runningAppCount = apps.byStatus["running"] || 0;

    const result: TMetricsOverview = {
      timestamp: new Date().toISOString(),
      system: {
        cpuUsagePercent: system.cpu.usagePercent,
        memoryUsagePercent: system.memory.usagePercent,
        uptime: system.uptime,
      },
      cluster: {
        available: cluster.available,
        nodesTotal: cluster.nodes.total,
        nodesReady: cluster.nodes.ready,
        podsRunning: cluster.pods.running,
      },
      resources: {
        total: resources.total,
        running: runningResourceCount,
      },
      apps: {
        total: apps.total,
        running: runningAppCount,
      },
    };

    addonRepo.setCache(cacheKey, result, CACHE_TTL);
    return result;
  }

  return {
    getSystemMetrics,
    getClusterMetrics,
    getResourceMetrics,
    getAppMetrics,
    getOverview,
  };
}
