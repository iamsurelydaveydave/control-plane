import { Request, Response, NextFunction } from "express";
import { Client, ConnectConfig } from "ssh2";
import Joi from "joi";
import { useServerRepo } from "./server.repository";
import { TServer, THealthCheck, schemaServerCreate, schemaServerUpdate } from "./server.model";
import { BadRequestError, NotFoundError, logger } from "../../utils";
import { useSSHKeyRepo } from "../ssh-key/ssh-key.repository";
import { useSSHService } from "../../services";
import { useServerService, getSetupEmitter } from "./server.service";
import { useAppRepo } from "../app/app.repository";
import { useDatabaseRepo } from "../database/database.repository";

// Validation schema for test-connection endpoint
const schemaTestConnection = Joi.object({
  host: Joi.string().required(),
  sshUser: Joi.string().required(),
  sshPort: Joi.number().default(22),
  sshKeyId: Joi.string().required(),
});

export function useServerController() {
  const repo = useServerRepo();
  const sshKeyRepo = useSSHKeyRepo();
  const sshService = useSSHService();
  const serverService = useServerService();
  const appRepo = useAppRepo();
  const databaseRepo = useDatabaseRepo();

  async function add(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaServerCreate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      // Check if validation is requested
      const shouldValidate = req.query.validate === "true";

      if (shouldValidate) {
        // Require sshKeyId for validation
        if (!value.sshKeyId) {
          next(new BadRequestError("sshKeyId is required when validate=true"));
          return;
        }

        // Fetch the SSH key
        const sshKey = await sshKeyRepo.getById(value.sshKeyId);
        if (!sshKey) {
          next(new NotFoundError("SSH key not found"));
          return;
        }

        // Test the connection
        const result = await sshService.testConnection({
          host: value.host,
          port: value.sshPort,
          username: value.sshUser,
          privateKey: sshKey.privateKey,
        });

        if (!result.success) {
          next(new BadRequestError(`SSH connection failed: ${result.error}`));
          return;
        }
      }

      const id = await repo.add(value);
      res.status(201).json({ message: "Server created", serverId: id });
    } catch (error) {
      next(error);
    }
  }

  async function getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const server = await repo.getById(id);

      if (!server) {
        next(new BadRequestError("Server not found"));
        return;
      }

      res.json({ server });
    } catch (error) {
      next(error);
    }
  }

  async function getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const { search, page, limit, status, tag } = req.query;

      const data = await repo.getAll({
        search: search as string,
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 10,
        status: status as any,
        tag: tag as string,
      });

      res.json(data);
    } catch (error) {
      next(error);
    }
  }

  async function updateById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { error, value } = schemaServerUpdate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      await repo.updateById(id, value);
      res.json({ message: "Server updated" });
    } catch (error) {
      next(error);
    }
  }

  async function deleteById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      const appCount = await appRepo.countByServerId(id);
      if (appCount > 0) {
        next(new BadRequestError(
          `Cannot delete server with ${appCount} deployed app${appCount === 1 ? "" : "s"}. Remove or reassign apps first.`
        ));
        return;
      }

      const dbCount = await databaseRepo.countByServerId(id);
      if (dbCount > 0) {
        next(new BadRequestError(
          `Cannot delete server with ${dbCount} database${dbCount === 1 ? "" : "s"}. Remove databases first.`
        ));
        return;
      }

      await repo.deleteById(id);
      res.json({ message: "Server deleted" });
    } catch (error) {
      next(error);
    }
  }

  async function getStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const server = await repo.getById(id);

      if (!server) {
        next(new BadRequestError("Server not found"));
        return;
      }

      res.json({
        status: server.status,
        lastHealthCheck: server.lastHealthCheck,
        resources: server.resources,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Validate SSH connection for an existing server
   * Uses the server's configured sshKeyId to test connectivity
   */
  async function validateConnection(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const server = await repo.getById(id);

      if (!server) {
        next(new NotFoundError("Server not found"));
        return;
      }

      if (!server.sshKeyId) {
        next(new BadRequestError("Server does not have an SSH key configured"));
        return;
      }

      // Fetch the SSH key
      const sshKey = await sshKeyRepo.getById(server.sshKeyId);
      if (!sshKey) {
        next(new NotFoundError("SSH key not found"));
        return;
      }

      // Test the connection
      const result = await sshService.testConnection({
        host: server.host,
        port: server.sshPort,
        username: server.sshUser,
        privateKey: sshKey.privateKey,
      });

      if (!result.success) {
        // Update status to offline on failed connection
        await repo.updateById(id, {
          status: "offline",
          lastHealthCheck: new Date(),
        });

        res.json({
          success: false,
          error: result.error,
        });
        return;
      }

      // Update status to online on successful connection
      await repo.updateById(id, {
        status: "online",
        lastHealthCheck: new Date(),
      });

      res.json({
        success: true,
        serverInfo: result.serverInfo,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Check server health - tests SSH connection and gathers system resources
   * Updates server status, lastHealthCheck, and resources in the database
   */
  async function checkHealth(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const server = await repo.getById(id);

      if (!server) {
        next(new NotFoundError("Server not found"));
        return;
      }

      if (!server.sshKeyId) {
        next(new BadRequestError("Server does not have an SSH key configured"));
        return;
      }

      // Fetch the SSH key
      const sshKey = await sshKeyRepo.getById(server.sshKeyId);
      if (!sshKey) {
        next(new NotFoundError("SSH key not found"));
        return;
      }

      const checkStartTime = Date.now();

      const result = await sshService.getSystemResources({
        host: server.host,
        port: server.sshPort,
        username: server.sshUser,
        privateKey: sshKey.privateKey,
      });

      const durationMs = Date.now() - checkStartTime;

      const newCheck: THealthCheck = {
        timestamp: new Date(),
        status: result.success ? "online" : "offline",
        resources: result.success && result.resources ? result.resources : undefined,
        serverInfo: result.success ? result.serverInfo : undefined,
        error: result.success ? undefined : result.error,
        durationMs,
      };

      const healthChecks = [newCheck, ...(server.healthChecks ?? [])].slice(0, 20);

      if (!result.success) {
        await repo.updateById(id, {
          status: "offline",
          lastHealthCheck: new Date(),
          healthChecks,
        });

        res.json({
          success: false,
          error: result.error,
          healthChecks,
        });
        return;
      }

      const updateData: Partial<TServer> = {
        status: "online",
        lastHealthCheck: new Date(),
        healthChecks,
      };

      if (result.resources) {
        updateData.resources = {
          cpuCores: result.resources.cpuCores,
          memoryMb: result.resources.memoryMb,
          diskGb: result.resources.diskGb,
        };
      }

      await repo.updateById(id, updateData);

      res.json({
        success: true,
        serverInfo: result.serverInfo,
        resources: result.resources,
        healthChecks,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Test SSH connection before adding a server
   * Allows testing connection parameters without persisting the server
   */
  async function testConnection(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaTestConnection.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const { host, sshUser, sshPort, sshKeyId } = value;

      // Fetch the SSH key
      const sshKey = await sshKeyRepo.getById(sshKeyId);
      if (!sshKey) {
        next(new NotFoundError("SSH key not found"));
        return;
      }

      // Test the connection
      const result = await sshService.testConnection({
        host,
        port: sshPort,
        username: sshUser,
        privateKey: sshKey.privateKey,
      });

      if (!result.success) {
        res.json({
          success: false,
          error: result.error,
        });
        return;
      }

      res.json({
        success: true,
        serverInfo: result.serverInfo,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Bootstrap a server for deployments
   * Installs Docker and configures firewall
   * 
   * Note: This is a simplified bootstrap that only sets up Docker.
   * Caddy runs on the control plane host as the centralized reverse proxy,
   * so we don't need kamal-proxy on each server.
   */
  async function bootstrap(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const server = await repo.getById(id);

      if (!server) {
        next(new NotFoundError("Server not found"));
        return;
      }

      if (!server.sshKeyId) {
        next(new BadRequestError("Server does not have an SSH key configured"));
        return;
      }

      // Fetch the SSH key
      const sshKey = await sshKeyRepo.getById(server.sshKeyId);
      if (!sshKey) {
        next(new NotFoundError("SSH key not found"));
        return;
      }

      // Connect to server
      const conn = new Client();
      const SSH_TIMEOUT_MS = 30000;
      const INSTALL_TIMEOUT_MS = 300000; // 5 min for Docker install

      function execCommand(
        connection: Client,
        command: string,
        timeoutMs: number = SSH_TIMEOUT_MS
      ): Promise<{ stdout: string; stderr: string; code: number }> {
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error(`Command timed out after ${timeoutMs / 1000}s`));
          }, timeoutMs);

          connection.exec(command, (err, stream) => {
            if (err) {
              clearTimeout(timeout);
              reject(err);
              return;
            }

            let stdout = "";
            let stderr = "";

            stream.on("close", (code: number) => {
              clearTimeout(timeout);
              resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code });
            });

            stream.on("data", (data: Buffer) => {
              stdout += data.toString();
            });

            stream.stderr.on("data", (data: Buffer) => {
              stderr += data.toString();
            });
          });
        });
      }

      // Promisified connect
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          conn.end();
          reject(new Error(`SSH connection timeout to ${server.host}`));
        }, SSH_TIMEOUT_MS);

        conn.on("ready", () => {
          clearTimeout(timeout);
          resolve();
        });

        conn.on("error", (err) => {
          clearTimeout(timeout);
          conn.end();
          reject(err);
        });

        const connectConfig: ConnectConfig = {
          host: server.host,
          port: server.sshPort,
          username: server.sshUser,
          privateKey: sshKey.privateKey,
          readyTimeout: SSH_TIMEOUT_MS,
          algorithms: {
            serverHostKey: [
              "ssh-ed25519",
              "ecdsa-sha2-nistp256",
              "ecdsa-sha2-nistp384",
              "ecdsa-sha2-nistp521",
              "rsa-sha2-512",
              "rsa-sha2-256",
              "ssh-rsa",
            ],
          },
        };

        conn.connect(connectConfig);
      });

      type TBootstrapStep = {
        name: string;
        status: string;
        output?: string;
        duration?: number;
      };

      const steps: TBootstrapStep[] = [];

      try {
        // Step 1: Check if Docker is installed
        logger.log({ level: "info", message: `Bootstrapping server ${server.host}: checking Docker` });
        const dockerStartTime = Date.now();
        const dockerCheck = await execCommand(conn, "docker --version");

        if (dockerCheck.code !== 0) {
          // Install Docker
          logger.log({ level: "info", message: `Installing Docker on ${server.host}` });
          const installResult = await execCommand(
            conn,
            "curl -fsSL https://get.docker.com | sh",
            INSTALL_TIMEOUT_MS
          );

          if (installResult.code !== 0) {
            conn.end();
            next(new BadRequestError(`Docker installation failed: ${installResult.stderr}`));
            return;
          }

          steps.push({ 
            name: "docker", 
            status: "installed", 
            output: "Docker installed via official script",
            duration: Date.now() - dockerStartTime,
          });
        } else {
          steps.push({ 
            name: "docker", 
            status: "already_installed", 
            output: dockerCheck.stdout,
            duration: Date.now() - dockerStartTime,
          });
        }

        // Step 2: Ensure Docker is enabled and running
        const serviceStartTime = Date.now();
        await execCommand(conn, "systemctl enable docker && systemctl start docker");
        steps.push({
          name: "docker_service",
          status: "running",
          output: "Docker service enabled and started",
          duration: Date.now() - serviceStartTime,
        });

        // Step 3: Configure firewall (UFW) — open common ports if UFW is active
        const firewallStartTime = Date.now();
        const ufwStatus = await execCommand(conn, "ufw status 2>/dev/null || echo inactive");
        const ufwActive = ufwStatus.stdout.includes("Status: active");

        if (ufwActive) {
          // Open ports 22 (SSH), 80 (HTTP), 443 (HTTPS), and 3000-3100 (app ports)
          await execCommand(conn, "ufw allow 22/tcp");
          await execCommand(conn, "ufw allow 80/tcp");
          await execCommand(conn, "ufw allow 443/tcp");
          await execCommand(conn, "ufw allow 3000:3100/tcp"); // App port range
          steps.push({ 
            name: "firewall", 
            status: "configured", 
            output: "Opened ports 22, 80, 443, and 3000-3100 in UFW",
            duration: Date.now() - firewallStartTime,
          });
        } else {
          steps.push({ 
            name: "firewall", 
            status: "skipped", 
            output: "UFW not active, no changes needed",
            duration: Date.now() - firewallStartTime,
          });
        }

        // Step 4: Gather system info
        const infoStartTime = Date.now();
        const [cpuResult, memResult, diskResult] = await Promise.all([
          execCommand(conn, "nproc"),
          execCommand(conn, "free -m | awk '/^Mem:/ {print $2}'"),
          execCommand(conn, "df -BG / | awk 'NR==2 {gsub(/G/,\"\"); print $2}'"),
        ]);

        const resources = {
          cpuCores: parseInt(cpuResult.stdout, 10) || undefined,
          memoryMb: parseInt(memResult.stdout, 10) || undefined,
          diskGb: parseInt(diskResult.stdout, 10) || undefined,
        };

        steps.push({
          name: "system_info",
          status: "gathered",
          output: `CPU: ${resources.cpuCores} cores, RAM: ${resources.memoryMb}MB, Disk: ${resources.diskGb}GB`,
          duration: Date.now() - infoStartTime,
        });

        conn.end();

        // Update server record
        await repo.updateById(id, {
          dockerInstalled: true,
          bootstrappedAt: new Date(),
          status: "online",
          lastHealthCheck: new Date(),
          resources,
        });

        logger.log({ level: "info", message: `Server ${server.host} bootstrapped successfully` });

        const totalDuration = steps.reduce((sum, s) => sum + (s.duration || 0), 0);

        res.json({
          success: true,
          steps,
          totalDuration,
          server: {
            id,
            host: server.host,
            status: "online",
            dockerInstalled: true,
            resources,
          },
        });
      } catch (error: any) {
        conn.end();
        logger.log({ level: "error", message: `Bootstrap failed for ${server.host}: ${error.message}` });
        next(new BadRequestError(`Bootstrap failed: ${error.message}`));
      }
    } catch (error) {
      next(error);
    }
  }

  async function setup(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const server = await repo.getById(id);

      if (!server) {
        next(new NotFoundError("Server not found"));
        return;
      }

      if (!server.sshKeyId) {
        next(new BadRequestError("Server does not have an SSH key configured"));
        return;
      }

      if (server.setupStatus === "running") {
        res.json({
          message: "Server setup is already in progress",
          setupStatus: "running",
        });
        return;
      }

      serverService.setupServer(id).catch((err: Error) => {
        logger.log({ level: "error", message: `[setup] Unhandled error: ${err.message}` });
      });

      res.json({
        message: "Server setup started",
        setupStatus: "running",
      });
    } catch (error) {
      next(error);
    }
  }

  async function getSetupStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const server = await repo.getById(id);

      if (!server) {
        next(new NotFoundError("Server not found"));
        return;
      }

      res.json({
        setupStatus: server.setupStatus ?? "idle",
        setupLog: server.setupLog ?? [],
        setupStartedAt: server.setupStartedAt,
        setupCompletedAt: server.setupCompletedAt,
        status: server.status,
        dockerInstalled: server.dockerInstalled ?? false,
        resources: server.resources,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * SSE stream for real-time setup progress.
   * Sends the current state immediately, then pushes "update" and "done" events
   * as the setup service emits them. Closes automatically when setup finishes.
   */
  async function setupStream(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const server = await repo.getById(id);

      if (!server) {
        next(new NotFoundError("Server not found"));
        return;
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
      res.flushHeaders();

      function send(eventName: string, data: object) {
        res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
      }

      // Send current state immediately so the client hydrates without a round-trip
      const snapshot = {
        setupStatus: server.setupStatus ?? "idle",
        setupLog: server.setupLog ?? [],
        status: server.status,
        resources: server.resources,
        dockerInstalled: server.dockerInstalled ?? false,
        setupCompletedAt: server.setupCompletedAt,
      };
      send("update", snapshot);

      // If setup is already finished (or never started), send done and close
      if (server.setupStatus !== "running") {
        send("done", snapshot);
        res.end();
        return;
      }

      const emitter = getSetupEmitter(id);

      function onUpdate(data: object) {
        send("update", data);
      }

      function onDone(data: object) {
        send("update", data);
        send("done", data);
        res.end();
      }

      emitter.on("update", onUpdate);
      emitter.once("done", onDone);

      req.on("close", () => {
        emitter.off("update", onUpdate);
        emitter.off("done", onDone);
      });
    } catch (error) {
      next(error);
    }
  }

  /** List apps deployed to a specific server. */
  async function getServerApps(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const server = await repo.getById(id);
      if (!server) {
        next(new NotFoundError("Server not found"));
        return;
      }
      const items = await appRepo.getByServerId(id);
      res.json({ items, total: items.length });
    } catch (error) {
      next(error);
    }
  }

  /** List databases hosted on a specific server. */
  async function getServerDatabases(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const server = await repo.getById(id);
      if (!server) {
        next(new NotFoundError("Server not found"));
        return;
      }
      const items = await databaseRepo.getByServerId(id);
      res.json({ items, total: items.length });
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
    getStatus,
    validateConnection,
    checkHealth,
    testConnection,
    bootstrap,
    setup,
    getSetupStatus,
    setupStream,
    getServerApps,
    getServerDatabases,
  };
}
