import { Request, Response, NextFunction } from "express";
import { useAppRepo } from "./app.repository";
import { useServerRepo } from "../server/server.repository";
import { useKamalExecutor } from "../../services/kamal.executor";
import { schemaAppCreate, schemaAppUpdate, schemaAppDeploy } from "./app.model";
import { BadRequestError, NotFoundError, generateSslipHost, isSslipHost, logBroker } from "../../utils";
import { useDNSService } from "../../services/dns.service";

export function useAppController() {
  const repo = useAppRepo();
  const serverRepo = useServerRepo();
  const kamal = useKamalExecutor();

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  async function add(req: Request, res: Response, next: NextFunction) {
    try {
      // -----------------------------------------------------------------------
      // Auto-assign a hostname when none is provided.
      // Priority: 1) explicit proxy.host  2) DNS subdomain  3) sslip.io
      // -----------------------------------------------------------------------
      const body = { ...req.body };

      if (!body.proxy?.host && Array.isArray(body.serverIds) && body.serverIds.length > 0) {
        const firstServer = await serverRepo.getById(body.serverIds[0]);
        const serverIp = firstServer?.host;

        if (serverIp) {
          const dns = useDNSService();
          const appsConfig = await dns.getAppsConfig();
          const appName = (body.name as string) || "app";

          let host: string;
          let ssl = false;

          if (appsConfig?.baseDomain) {
            // DNS configured — use the registered subdomain
            const safeName = appName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
            host = `${safeName}.${appsConfig.baseDomain}`;
            ssl  = true;
          } else {
            // No DNS — fall back to sslip.io (no SSL)
            host = generateSslipHost(appName, serverIp);
            ssl  = false;
          }

          body.proxy = {
            appPort: 3000,
            ssl,
            ...body.proxy,
            host,               // always override the empty/missing host
          };
        }
      }

      const { error, value } = schemaAppCreate.validate(body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      // Validate servers exist and are online
      for (const serverId of value.serverIds) {
        const server = await serverRepo.getById(serverId);
        if (!server) {
          next(new NotFoundError(`Server not found: ${serverId}`));
          return;
        }
      }

      const id = await repo.add(value);
      const isSslip = isSslipHost(value.proxy?.host ?? "");

      res.status(201).json({
        message: "App created",
        appId: id,
        url: value.proxy?.host
          ? `${value.proxy.ssl ? "https" : "http"}://${value.proxy.host}`
          : null,
        urlType: value.proxy?.host
          ? (isSslip ? "sslip" : "custom")
          : null,
      });
    } catch (error) {
      next(error);
    }
  }

  async function getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const app = await repo.getById(id);

      if (!app) {
        next(new NotFoundError("App not found"));
        return;
      }

      // Mask registry password in response
      const safeApp = {
        ...app,
        registry: app.registry
          ? { ...app.registry, password: "****" }
          : undefined,
      };

      res.json({ app: safeApp });
    } catch (error) {
      next(error);
    }
  }

  async function getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const { search, page, limit, status } = req.query;

      const data = await repo.getAll({
        search: search as string,
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 10,
        status: status as any,
      });

      // Mask registry passwords
      const safeItems = data.items.map((app: any) => ({
        ...app,
        registry: app.registry
          ? { ...app.registry, password: "****" }
          : undefined,
      }));

      res.json({ ...data, items: safeItems });
    } catch (error) {
      next(error);
    }
  }

  async function updateById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { error, value } = schemaAppUpdate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      await repo.updateById(id, value);
      res.json({ message: "App updated" });
    } catch (error) {
      next(error);
    }
  }

  async function deleteById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      
      const app = await repo.getById(id);
      if (!app) {
        next(new NotFoundError("App not found"));
        return;
      }

      // Stop the app if running
      if (app.status === "running") {
        await kamal.stop(id).catch(() => {});
      }

      await repo.deleteById(id);
      res.json({ message: "App deleted" });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Deployment
  // ---------------------------------------------------------------------------

  async function deploy(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { error, value } = schemaAppDeploy.validate(req.body || {});
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const app = await repo.getById(id);
      if (!app) {
        next(new NotFoundError("App not found"));
        return;
      }

      if (app.status === "deploying") {
        next(new BadRequestError("Deployment already in progress"));
        return;
      }

      const userId = req.cookies?.user;

      // Start deployment in background
      kamal
        .deploy({
          appId: id,
          version: value.version,
          force: value.force,
          triggeredBy: userId,
          onLog: (line) => logBroker.addLine(id, line),
        })
        .catch((err) => {
          logBroker.addLine(id, `[ERROR] ${err.message}`);
          logBroker.complete(id, "failed");
        });

      res.status(202).json({
        message: "Deployment started",
        status: "deploying",
      });
    } catch (error) {
      next(error);
    }
  }

  async function redeploy(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const app = await repo.getById(id);
      
      if (!app) {
        next(new NotFoundError("App not found"));
        return;
      }

      if (app.status === "deploying") {
        next(new BadRequestError("Deployment already in progress"));
        return;
      }

      const userId = req.cookies?.user;

      kamal
        .redeploy({
          appId: id,
          triggeredBy: userId,
          onLog: (line) => logBroker.addLine(id, line),
        })
        .catch((err) => {
          logBroker.addLine(id, `[ERROR] ${err.message}`);
          logBroker.complete(id, "failed");
        });

      res.status(202).json({
        message: "Redeployment started",
        status: "deploying",
      });
    } catch (error) {
      next(error);
    }
  }

  async function rollback(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const version = req.params.version || req.body?.version;

      const app = await repo.getById(id);
      if (!app) {
        next(new NotFoundError("App not found"));
        return;
      }

      const userId = req.cookies?.user;

      kamal
        .rollback({
          appId: id,
          version,
          triggeredBy: userId,
          onLog: (line) => logBroker.addLine(id, line),
        })
        .catch((err) => {
          logBroker.addLine(id, `[ERROR] ${err.message}`);
          logBroker.complete(id, "failed");
        });

      res.status(202).json({
        message: "Rollback started",
        version: version || "previous",
      });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async function stop(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const app = await repo.getById(id);
      
      if (!app) {
        next(new NotFoundError("App not found"));
        return;
      }

      const result = await kamal.stop(id);
      
      res.json({
        message: result.success ? "App stopped" : "Failed to stop app",
        success: result.success,
        error: result.success ? undefined : result.stderr,
      });
    } catch (error) {
      next(error);
    }
  }

  async function start(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const app = await repo.getById(id);
      
      if (!app) {
        next(new NotFoundError("App not found"));
        return;
      }

      const result = await kamal.start(id);
      
      res.json({
        message: result.success ? "App started" : "Failed to start app",
        success: result.success,
        error: result.success ? undefined : result.stderr,
      });
    } catch (error) {
      next(error);
    }
  }

  async function restart(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const userId = req.cookies?.user;

      // Redeploy is effectively a restart in Kamal
      kamal
        .redeploy({
          appId: id,
          triggeredBy: userId,
        })
        .catch(() => {});

      res.status(202).json({ message: "Restart initiated" });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Inspection
  // ---------------------------------------------------------------------------

  async function getLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const lines = req.query.lines ? Number(req.query.lines) : 100;

      const app = await repo.getById(id);
      if (!app) {
        next(new NotFoundError("App not found"));
        return;
      }

      const result = await kamal.getLogs(id, lines);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async function getVersion(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const app = await repo.getById(id);
      
      if (!app) {
        next(new NotFoundError("App not found"));
        return;
      }

      const version = await kamal.getVersion(id);
      res.json({ version });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------

  async function appExec(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { command } = req.body;

      if (!command) {
        next(new BadRequestError("command is required"));
        return;
      }

      const app = await repo.getById(id);
      if (!app) {
        next(new NotFoundError("App not found"));
        return;
      }

      const result = await kamal.appExec(id, command);
      res.json({
        success: result.success,
        output: result.stdout,
        error: result.stderr,
      });
    } catch (error) {
      next(error);
    }
  }

  async function getDeployments(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const app = await repo.getById(id);
      if (!app) { next(new NotFoundError("App not found")); return; }

      const limit = req.query.limit ? Math.min(Number(req.query.limit), 50) : 10;
      const { useDeploymentRepo } = await import("../deployment");
      const deploymentRepo = useDeploymentRepo();
      const deployments = await deploymentRepo.getByAppId(id, { page: 1, limit });

      res.json({ deployments: deployments.items });
    } catch (error) {
      next(error);
    }
  }

  return {
    add,
    getById,
    getAll,
    updateById,
    deleteById,
    deploy,
    redeploy,
    rollback,
    stop,
    start,
    restart,
    getLogs,
    getVersion,
    appExec,
    getDeployments,
  };
}
