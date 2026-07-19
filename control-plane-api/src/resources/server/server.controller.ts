import { Request, Response, NextFunction } from "express";
import { Client, ConnectConfig } from "ssh2";
import Joi from "joi";
import { useServerRepo } from "./server.repository";
import { TServer, schemaServerCreate, schemaServerUpdate } from "./server.model";
import { BadRequestError, NotFoundError, logger } from "../../utils";
import { useSSHKeyRepo } from "../ssh-key/ssh-key.repository";
import { useSSHService } from "../../services";

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

      // Get system resources via SSH
      const result = await sshService.getSystemResources({
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
          server: {
            ...server,
            status: "offline",
            lastHealthCheck: new Date(),
          },
        });
        return;
      }

      // Update server with status, resources, and health check timestamp
      const updateData: Partial<typeof server> = {
        status: "online",
        lastHealthCheck: new Date(),
      };

      if (result.resources) {
        updateData.resources = {
          cpuCores: result.resources.cpuCores,
          memoryMb: result.resources.memoryMb,
          diskGb: result.resources.diskGb,
        };
      }

      await repo.updateById(id, updateData);

      // Get updated server
      const updatedServer = await repo.getById(id);

      res.json({
        success: true,
        serverInfo: result.serverInfo,
        resources: result.resources,
        server: updatedServer,
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
   * Bootstrap a server for Kamal deployments
   * Installs Docker, starts kamal-proxy, and configures firewall
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
      const PULL_TIMEOUT_MS = 120000; // 2 min for image pull

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
      };

      const steps: TBootstrapStep[] = [];

      try {
        // Step 1: Check if Docker is installed
        logger.log({ level: "info", message: `Bootstrapping server ${server.host}: checking Docker` });
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

          steps.push({ name: "docker", status: "installed", output: "Docker installed via official script" });
        } else {
          steps.push({ name: "docker", status: "installed", output: dockerCheck.stdout });
        }

        // Step 2: Ensure Docker is enabled and running
        await execCommand(conn, "systemctl enable docker && systemctl start docker");

        // Step 3: Pull kamal-proxy image
        logger.log({ level: "info", message: `Pulling kamal-proxy on ${server.host}` });
        const pullResult = await execCommand(
          conn,
          "docker pull basecamp/kamal-proxy:latest",
          PULL_TIMEOUT_MS
        );

        if (pullResult.code !== 0) {
          conn.end();
          next(new BadRequestError(`Failed to pull kamal-proxy: ${pullResult.stderr}`));
          return;
        }

        // Step 4: Check if kamal-proxy container exists and is running
        const psResult = await execCommand(
          conn,
          "docker ps -a --filter name=kamal-proxy --format '{{.Status}}'"
        );

        const isRunning = psResult.stdout.toLowerCase().includes("up");

        if (!isRunning) {
          // Remove existing stopped container if any
          await execCommand(conn, "docker rm -f kamal-proxy 2>/dev/null || true");

          // Start kamal-proxy
          logger.log({ level: "info", message: `Starting kamal-proxy on ${server.host}` });
          const runResult = await execCommand(
            conn,
            "docker run -d --name kamal-proxy --restart unless-stopped --network host -v kamal-proxy-config:/home/kamal-proxy/.config/kamal-proxy basecamp/kamal-proxy:latest"
          );

          if (runResult.code !== 0) {
            conn.end();
            next(new BadRequestError(`Failed to start kamal-proxy: ${runResult.stderr}`));
            return;
          }

          steps.push({ name: "kamal-proxy", status: "running", output: "Started kamal-proxy container" });
        } else {
          steps.push({ name: "kamal-proxy", status: "running", output: "kamal-proxy already running" });
        }

        // Step 5: Configure firewall (UFW) — open ports 80 and 443 if UFW is active
        const ufwStatus = await execCommand(conn, "ufw status 2>/dev/null || echo inactive");
        const ufwActive = ufwStatus.stdout.includes("Status: active");

        if (ufwActive) {
          await execCommand(conn, "ufw allow 80/tcp && ufw allow 443/tcp");
          steps.push({ name: "firewall", status: "configured", output: "Opened ports 80 and 443 in UFW" });
        } else {
          steps.push({ name: "firewall", status: "configured", output: "UFW not active, no changes needed" });
        }

        conn.end();

        // Update server record
        await repo.updateById(id, {
          dockerInstalled: true,
          kamalProxyRunning: true,
          bootstrappedAt: new Date(),
          status: "online",
        });

        logger.log({ level: "info", message: `Server ${server.host} bootstrapped successfully` });

        res.json({
          success: true,
          steps,
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
  };
}
