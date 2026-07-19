import { Client, ConnectConfig } from "ssh2";
import { ObjectId } from "mongodb";
import { TApp } from "../resources/app/app.model";
import { TInstance } from "../resources/instance/instance.model";
import { TServer } from "../resources/server/server.model";
import { TSSHKey } from "../resources/ssh-key/ssh-key.model";
import { useSSHKeyRepo } from "../resources/ssh-key/ssh-key.repository";
import { useServerRepo } from "../resources/server/server.repository";
import { logger, InternalServerError, BadRequestError } from "../utils";

const SSH_TIMEOUT_MS = 30000; // 30 seconds for docker operations
const DOCKER_PULL_TIMEOUT_MS = 120000; // 2 minutes for image pulls

export type TDockerDeployResult = {
  success: boolean;
  containerId?: string;
  error?: string;
};

export type TDockerContainerStatus = {
  running: boolean;
  containerId?: string;
  status?: string;
  error?: string;
};

/**
 * Docker Executor Service
 * Deploys and manages Docker containers on remote servers via SSH
 */
export function useDockerExecutor() {
  const sshKeyRepo = useSSHKeyRepo();
  const serverRepo = useServerRepo();

  /**
   * Execute a command over SSH
   */
  function execCommand(
    conn: Client,
    command: string,
    timeoutMs: number = SSH_TIMEOUT_MS
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Command timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);

      conn.exec(command, (err, stream) => {
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

  /**
   * Connect to a server via SSH
   */
  async function connectToServer(server: TServer): Promise<Client> {
    // Get SSH key
    let sshKey: TSSHKey | null = null;
    
    if (server.sshKeyId) {
      sshKey = await sshKeyRepo.getById(server.sshKeyId);
    }
    
    if (!sshKey) {
      sshKey = await sshKeyRepo.getDefault();
    }

    if (!sshKey) {
      throw new BadRequestError("No SSH key available for server connection");
    }

    const conn = new Client();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        conn.end();
        reject(new Error(`SSH connection timeout to ${server.host}`));
      }, SSH_TIMEOUT_MS);

      conn.on("ready", () => {
        clearTimeout(timeout);
        resolve(conn);
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
  }

  /**
   * Generate container name for an app instance
   */
  function getContainerName(appName: string, instanceId: ObjectId): string {
    // Use a consistent naming pattern: cp-<app>-<short-id>
    const shortId = instanceId.toString().slice(-8);
    const safeName = appName.toLowerCase().replace(/[^a-z0-9]/g, "-");
    return `cp-${safeName}-${shortId}`;
  }

  /**
   * Get the image to deploy from app source
   */
  function getAppImage(app: TApp): string {
    if (app.source.type === "image" && app.source.image) {
      return app.source.image;
    }
    // For git-based builds, use currentImage if available
    if (app.currentImage) {
      return app.currentImage;
    }
    throw new BadRequestError(`App ${app.name} has no image configured`);
  }

  /**
   * Get container port from app config
   */
  function getContainerPort(app: TApp): number {
    return app.proxy?.appPort || parseInt(app.env.CONTAINER_PORT || "3000", 10);
  }

  /**
   * Build docker run command
   */
  function buildDockerRunCommand(
    app: TApp,
    instance: TInstance,
    containerName: string
  ): string {
    const parts = ["docker run -d"];
    const containerPort = getContainerPort(app);
    const image = getAppImage(app);

    // Container name
    parts.push(`--name ${containerName}`);

    // Restart policy
    parts.push("--restart unless-stopped");

    // Port mapping
    parts.push(`-p ${instance.port}:${containerPort}`);

    // Resource limits
    if (app.resources?.memory) {
      parts.push(`--memory ${app.resources.memory}`);
    }
    if (app.resources?.cpus) {
      parts.push(`--cpus ${app.resources.cpus}`);
    }

    // Environment variables
    for (const [key, value] of Object.entries(app.env)) {
      // Escape special characters in values
      const escapedValue = value.replace(/"/g, '\\"').replace(/\$/g, '\\$');
      parts.push(`-e "${key}=${escapedValue}"`);
    }

    // Add instance metadata as env vars
    parts.push(`-e "INSTANCE_ID=${instance._id}"`);
    parts.push(`-e "APP_NAME=${app.name}"`);

    // Health check if configured
    if (app.healthCheck) {
      const healthPort = app.healthCheck.port || containerPort;
      parts.push(
        `--health-cmd "curl -f http://localhost:${healthPort}${app.healthCheck.path} || exit 1"`
      );
      parts.push(`--health-interval ${app.healthCheck.interval || 30}s`);
      parts.push(`--health-timeout ${app.healthCheck.timeout || 5}s`);
      parts.push(`--health-retries ${app.healthCheck.retries || 3}`);
    }

    // Labels
    if (app.labels) {
      for (const [key, value] of Object.entries(app.labels)) {
        parts.push(`--label "${key}=${value}"`);
      }
    }

    // Image
    parts.push(image);

    return parts.join(" ");
  }

  /**
   * Deploy a container on a server
   */
  async function deployContainer(
    app: TApp,
    instance: TInstance,
    server: TServer
  ): Promise<TDockerDeployResult> {
    const containerName = getContainerName(app.name, instance._id!);

    logger.log({
      level: "info",
      message: `Deploying container ${containerName} on ${server.host}:${instance.port}`,
    });

    let conn: Client | null = null;

    try {
      conn = await connectToServer(server);

      // Get the image to deploy
      const image = getAppImage(app);

      // Pull the image first
      logger.log({
        level: "debug",
        message: `Pulling image ${image} on ${server.host}`,
      });

      const pullResult = await execCommand(
        conn,
        `docker pull ${image}`,
        DOCKER_PULL_TIMEOUT_MS
      );

      if (pullResult.code !== 0) {
        throw new Error(`Failed to pull image: ${pullResult.stderr}`);
      }

      // Stop and remove existing container if exists
      await execCommand(conn, `docker stop ${containerName} 2>/dev/null || true`);
      await execCommand(conn, `docker rm ${containerName} 2>/dev/null || true`);

      // Run the container
      const runCommand = buildDockerRunCommand(app, instance, containerName);
      
      logger.log({
        level: "debug",
        message: `Running: ${runCommand}`,
      });

      const runResult = await execCommand(conn, runCommand);

      if (runResult.code !== 0) {
        throw new Error(`Failed to start container: ${runResult.stderr}`);
      }

      const containerId = runResult.stdout.trim();

      logger.log({
        level: "info",
        message: `Container ${containerName} deployed with ID ${containerId.slice(0, 12)}`,
      });

      return {
        success: true,
        containerId,
      };
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `Failed to deploy container ${containerName}: ${error.message}`,
      });

      return {
        success: false,
        error: error.message,
      };
    } finally {
      if (conn) {
        conn.end();
      }
    }
  }

  /**
   * Stop and remove a container
   */
  async function stopContainer(
    appName: string,
    instance: TInstance,
    server: TServer
  ): Promise<TDockerDeployResult> {
    const containerName = getContainerName(appName, instance._id!);

    logger.log({
      level: "info",
      message: `Stopping container ${containerName} on ${server.host}`,
    });

    let conn: Client | null = null;

    try {
      conn = await connectToServer(server);

      // Stop the container
      const stopResult = await execCommand(conn, `docker stop ${containerName}`);
      
      if (stopResult.code !== 0 && !stopResult.stderr.includes("No such container")) {
        throw new Error(`Failed to stop container: ${stopResult.stderr}`);
      }

      // Remove the container
      const rmResult = await execCommand(conn, `docker rm ${containerName}`);

      if (rmResult.code !== 0 && !rmResult.stderr.includes("No such container")) {
        throw new Error(`Failed to remove container: ${rmResult.stderr}`);
      }

      logger.log({
        level: "info",
        message: `Container ${containerName} stopped and removed`,
      });

      return { success: true };
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `Failed to stop container ${containerName}: ${error.message}`,
      });

      return {
        success: false,
        error: error.message,
      };
    } finally {
      if (conn) {
        conn.end();
      }
    }
  }

  /**
   * Restart a container
   */
  async function restartContainer(
    appName: string,
    instance: TInstance,
    server: TServer
  ): Promise<TDockerDeployResult> {
    const containerName = getContainerName(appName, instance._id!);

    logger.log({
      level: "info",
      message: `Restarting container ${containerName} on ${server.host}`,
    });

    let conn: Client | null = null;

    try {
      conn = await connectToServer(server);

      const result = await execCommand(conn, `docker restart ${containerName}`);

      if (result.code !== 0) {
        throw new Error(`Failed to restart container: ${result.stderr}`);
      }

      logger.log({
        level: "info",
        message: `Container ${containerName} restarted`,
      });

      return {
        success: true,
        containerId: result.stdout.trim(),
      };
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `Failed to restart container ${containerName}: ${error.message}`,
      });

      return {
        success: false,
        error: error.message,
      };
    } finally {
      if (conn) {
        conn.end();
      }
    }
  }

  /**
   * Check container status
   */
  async function getContainerStatus(
    appName: string,
    instance: TInstance,
    server: TServer
  ): Promise<TDockerContainerStatus> {
    const containerName = getContainerName(appName, instance._id!);

    let conn: Client | null = null;

    try {
      conn = await connectToServer(server);

      // Get container info
      const result = await execCommand(
        conn,
        `docker inspect --format '{{.State.Running}}|{{.Id}}|{{.State.Status}}' ${containerName} 2>/dev/null`
      );

      if (result.code !== 0) {
        return {
          running: false,
          status: "not found",
        };
      }

      const [running, containerId, status] = result.stdout.split("|");

      return {
        running: running === "true",
        containerId: containerId?.slice(0, 12),
        status,
      };
    } catch (error: any) {
      return {
        running: false,
        error: error.message,
      };
    } finally {
      if (conn) {
        conn.end();
      }
    }
  }

  /**
   * Get container logs
   */
  async function getContainerLogs(
    appName: string,
    instance: TInstance,
    server: TServer,
    lines: number = 100
  ): Promise<{ logs: string; error?: string }> {
    const containerName = getContainerName(appName, instance._id!);

    let conn: Client | null = null;

    try {
      conn = await connectToServer(server);

      const result = await execCommand(
        conn,
        `docker logs --tail ${lines} ${containerName} 2>&1`
      );

      return { logs: result.stdout };
    } catch (error: any) {
      return {
        logs: "",
        error: error.message,
      };
    } finally {
      if (conn) {
        conn.end();
      }
    }
  }

  /**
   * Check Docker is available on a server
   */
  async function checkDockerAvailable(server: TServer): Promise<boolean> {
    let conn: Client | null = null;

    try {
      conn = await connectToServer(server);

      const result = await execCommand(conn, "docker --version");

      return result.code === 0;
    } catch {
      return false;
    } finally {
      if (conn) {
        conn.end();
      }
    }
  }

  /**
   * Install Docker on a server (basic installation)
   */
  async function installDocker(server: TServer): Promise<TDockerDeployResult> {
    let conn: Client | null = null;

    try {
      conn = await connectToServer(server);

      logger.log({
        level: "info",
        message: `Installing Docker on ${server.host}`,
      });

      // Use Docker's official install script
      const installScript = `
        curl -fsSL https://get.docker.com -o get-docker.sh && 
        sh get-docker.sh && 
        rm get-docker.sh &&
        systemctl enable docker &&
        systemctl start docker
      `;

      const result = await execCommand(conn, installScript, 300000); // 5 minutes

      if (result.code !== 0) {
        throw new Error(`Docker installation failed: ${result.stderr}`);
      }

      logger.log({
        level: "info",
        message: `Docker installed on ${server.host}`,
      });

      return { success: true };
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `Failed to install Docker on ${server.host}: ${error.message}`,
      });

      return {
        success: false,
        error: error.message,
      };
    } finally {
      if (conn) {
        conn.end();
      }
    }
  }

  return {
    deployContainer,
    stopContainer,
    restartContainer,
    getContainerStatus,
    getContainerLogs,
    checkDockerAvailable,
    installDocker,
    getContainerName,
  };
}
