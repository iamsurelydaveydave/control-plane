import express from "express";
import { Request, Response, NextFunction } from "express";
import { requireAuth, requirePermission, logger } from "../utils";
import { NotFoundError, AppError } from "../utils/error";
import { useLogsService, TLogQuery, TLogLevel, TLogSource, logLevels, logSources } from "../services/logs.service";
import { useAppRepo, TApp } from "../resources/app";
import { useDatabaseRepo, TDatabaseListItem } from "../resources/database";

const router = express.Router();

// All logs routes require authentication
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseLogOptions(query: Request["query"]) {
  return {
    tailLines: query.lines ? Math.min(Number(query.lines), 5000) : 100,
    container: query.container as string | undefined,
    podName: query.pod as string | undefined,
    sinceSeconds: query.since ? Number(query.since) : undefined,
  };
}

function parseSearchQuery(query: Request["query"]): TLogQuery {
  return {
    source: logSources.includes(query.source as TLogSource)
      ? (query.source as TLogSource)
      : undefined,
    sourceId: query.sourceId as string | undefined,
    level: logLevels.includes(query.level as TLogLevel)
      ? (query.level as TLogLevel)
      : undefined,
    search: query.search as string | undefined,
    startTime: query.startTime ? new Date(query.startTime as string) : undefined,
    endTime: query.endTime ? new Date(query.endTime as string) : undefined,
    limit: query.limit ? Math.min(Number(query.limit), 1000) : 500,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/logs/apps/:id
 * Get logs from K8s pods for an app
 */
router.get(
  "/apps/:id",
  requirePermission("apps:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const appId = String(req.params.id);
      const options = parseLogOptions(req.query);

      const appRepo = useAppRepo();
      const app = await appRepo.getById(appId);

      if (!app) {
        next(new NotFoundError("App not found"));
        return;
      }

      const logsService = useLogsService();
      const results = await logsService.getAppLogs(appId, app.name, options);

      res.json({
        appId,
        appName: app.name,
        pods: results.map((r) => ({
          podName: r.podName,
          logs: r.logs,
        })),
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/logs/databases/:id
 * Get logs from PSMDB pods for a database
 */
router.get(
  "/databases/:id",
  requirePermission("databases:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const databaseId = String(req.params.id);
      const options = parseLogOptions(req.query);

      const databaseRepo = useDatabaseRepo();
      const database = await databaseRepo.getById(databaseId);

      if (!database) {
        next(new NotFoundError("Database not found"));
        return;
      }

      const logsService = useLogsService();
      const results = await logsService.getDatabaseLogs(databaseId, database.name, options);

      res.json({
        databaseId,
        databaseName: database.name,
        pods: results.map((r) => ({
          podName: r.podName,
          logs: r.logs,
        })),
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/logs/system
 * Get control-plane API logs
 */
router.get(
  "/system",
  requirePermission("settings:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const options = parseLogOptions(req.query);

      const logsService = useLogsService();
      const result = await logsService.getSystemLogs(options);

      res.json({
        source: "system",
        sourceName: result.sourceName,
        logs: result.logs,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/logs/operator
 * Get Percona operator logs
 */
router.get(
  "/operator",
  requirePermission("databases:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const options = parseLogOptions(req.query);

      const logsService = useLogsService();
      const results = await logsService.getOperatorLogs(options);

      res.json({
        source: "operator",
        pods: results.map((r) => ({
          podName: r.podName,
          logs: r.logs,
        })),
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/logs/search
 * Search across all log sources
 */
router.get(
  "/search",
  requirePermission("apps:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = parseSearchQuery(req.query);

      // Get list of apps and databases for searching
      const appRepo = useAppRepo();
      const databaseRepo = useDatabaseRepo();

      const [appsResult, databasesResult] = await Promise.all([
        appRepo.getAll({ limit: 100 }),
        databaseRepo.getAll({ limit: 100 }),
      ]);

      const apps = appsResult.items.map((app: TApp) => ({
        id: String(app._id),
        name: app.name,
      }));
      const databases = databasesResult.items.map((db: TDatabaseListItem) => ({
        id: String(db._id),
        name: db.name,
      }));

      const logsService = useLogsService();
      const logs = await logsService.searchLogs(query, apps, databases);

      res.json({
        query,
        total: logs.length,
        logs,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/logs/apps/:id/stream
 * SSE stream for live app logs
 */
router.get("/apps/:id/stream", requirePermission("apps:read"), async (req: Request, res: Response) => {
  const appId = String(req.params.id);

  try {
    const appRepo = useAppRepo();
    const app = await appRepo.getById(appId);

    if (!app) {
      res.status(404).json({ error: "App not found" });
      return;
    }

    const options = parseLogOptions(req.query);
    const logsService = useLogsService();

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Send connected event
    res.write(": connected\n\n");

    let streamResult: { stream: any; cleanup: () => void } | null = null;

    try {
      streamResult = await logsService.streamAppLogs(app.name, options);
      const { stream, cleanup } = streamResult;

      // Pipe log lines to SSE
      stream.on("data", (chunk: Buffer) => {
        if (res.writableEnded) return;
        const line = chunk.toString().trim();
        if (line) {
          res.write(`data: ${JSON.stringify({ line, timestamp: new Date().toISOString() })}\n\n`);
        }
      });

      stream.on("error", (error: Error) => {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
          res.end();
        }
      });

      stream.on("end", () => {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          res.end();
        }
      });

      // Heartbeat
      const heartbeat = setInterval(() => {
        if (!res.writableEnded) {
          res.write(": heartbeat\n\n");
        } else {
          clearInterval(heartbeat);
        }
      }, 15_000);

      // Cleanup on client disconnect
      req.on("close", () => {
        clearInterval(heartbeat);
        cleanup();
      });
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `[LogsRoute] streamAppLogs failed for ${app.name}: ${error.message}`,
      });
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
      }
    }
  } catch (error: any) {
    if (!res.headersSent) {
      res.status(error instanceof AppError ? error.statusCode : 500).json({
        error: error.message || "Internal server error",
      });
    }
  }
});

/**
 * GET /api/logs/databases/:id/stream
 * SSE stream for live database logs
 */
router.get("/databases/:id/stream", requirePermission("databases:read"), async (req: Request, res: Response) => {
  const databaseId = String(req.params.id);

  try {
    const databaseRepo = useDatabaseRepo();
    const database = await databaseRepo.getById(databaseId);

    if (!database) {
      res.status(404).json({ error: "Database not found" });
      return;
    }

    const options = parseLogOptions(req.query);
    const logsService = useLogsService();

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Send connected event
    res.write(": connected\n\n");

    let streamResult: { stream: any; cleanup: () => void } | null = null;

    try {
      streamResult = await logsService.streamDatabaseLogs(database.name, options);
      const { stream, cleanup } = streamResult;

      // Pipe log lines to SSE
      stream.on("data", (chunk: Buffer) => {
        if (res.writableEnded) return;
        const line = chunk.toString().trim();
        if (line) {
          res.write(`data: ${JSON.stringify({ line, timestamp: new Date().toISOString() })}\n\n`);
        }
      });

      stream.on("error", (error: Error) => {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
          res.end();
        }
      });

      stream.on("end", () => {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          res.end();
        }
      });

      // Heartbeat
      const heartbeat = setInterval(() => {
        if (!res.writableEnded) {
          res.write(": heartbeat\n\n");
        } else {
          clearInterval(heartbeat);
        }
      }, 15_000);

      // Cleanup on client disconnect
      req.on("close", () => {
        clearInterval(heartbeat);
        cleanup();
      });
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `[LogsRoute] streamDatabaseLogs failed for ${database.name}: ${error.message}`,
      });
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
      }
    }
  } catch (error: any) {
    if (!res.headersSent) {
      res.status(error instanceof AppError ? error.statusCode : 500).json({
        error: error.message || "Internal server error",
      });
    }
  }
});

export default router;
