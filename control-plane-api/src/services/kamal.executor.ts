import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ObjectId } from "mongodb";
import { useKamalGenerator } from "./kamal.generator";
import { useAppRepo } from "../resources/app";
import { useServerRepo } from "../resources/server";
import { useSecretRepo } from "../resources/secret";
import { useSSHKeyRepo } from "../resources/ssh-key";
import { useDeploymentRepo } from "../resources/deployment";
import { logger, InternalServerError, NotFoundError, BadRequestError, logBroker } from "../utils";

// =============================================================================
// Types
// =============================================================================

export type TKamalCommand =
  | "deploy"
  | "redeploy"
  | "rollback"
  | "app stop"
  | "app start"
  | "app logs"
  | "app version"
  | "app details"
  | "app exec"
  | "proxy boot"
  | "proxy reboot"
  | "proxy stop"
  | "proxy details";

export type TKamalExecOptions = {
  appId: string;
  command: TKamalCommand;
  args?: string[];
  env?: Record<string, string>;
  version?: string; // For rollback
  timeout?: number; // ms
  onLog?: (line: string) => void;
};

export type TKamalExecResult = {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
};

export type TDeployOptions = {
  appId: string;
  version?: string;      // Specific version/tag to deploy
  force?: boolean;       // Force deploy even if same version
  triggeredBy: string;   // User ID
  onLog?: (line: string) => void;
};

export type TDeployResult = {
  success: boolean;
  deploymentId?: string;
  version?: string;
  error?: string;
  logs: string[];
  duration: number;
};

// =============================================================================
// Constants
// =============================================================================

const KAMAL_TIMEOUT_MS = 600000; // 10 minutes for deployments
const KAMAL_DIR = path.join(os.tmpdir(), "control-plane-kamal");

// =============================================================================
// Kamal Executor Service
// =============================================================================

export function useKamalExecutor() {
  const kamalGenerator = useKamalGenerator();
  const appRepo = useAppRepo();
  const serverRepo = useServerRepo();
  const secretRepo = useSecretRepo();
  const sshKeyRepo = useSSHKeyRepo();
  const deploymentRepo = useDeploymentRepo();

  // ---------------------------------------------------------------------------
  // Setup: Create working directory for an app
  // ---------------------------------------------------------------------------

  async function setupWorkDir(app: any, servers: any[], sshKeyPath: string): Promise<string> {
    const workDir = path.join(KAMAL_DIR, app.name, `deploy-${Date.now()}`);
    await fs.promises.mkdir(workDir, { recursive: true });
    await fs.promises.mkdir(path.join(workDir, ".kamal"), { recursive: true });
    await fs.promises.mkdir(path.join(workDir, "config"), { recursive: true });

    // Get secrets for the app
    const secretsMap = await secretRepo.getForApp(
      app._id.toString(),
      app.secretNames || []
    );

    // Generate Kamal config files
    const { configYaml, secretsEnv } = kamalGenerator.generateDeploymentFiles(
      app,
      servers,
      secretsMap,
      {
        sshKeyPath,
        sshUser: servers[0]?.sshUser || "root",
      }
    );

    // Write deploy.yml
    await fs.promises.writeFile(
      path.join(workDir, "config", "deploy.yml"),
      configYaml,
      "utf-8"
    );

    // Write secrets file
    await fs.promises.writeFile(
      path.join(workDir, ".kamal", "secrets"),
      secretsEnv,
      "utf-8"
    );

    logger.log({
      level: "info",
      message: `Kamal work directory created: ${workDir}`,
    });

    return workDir;
  }

  // ---------------------------------------------------------------------------
  // Cleanup: Remove working directory
  // ---------------------------------------------------------------------------

  async function cleanupWorkDir(workDir: string): Promise<void> {
    try {
      await fs.promises.rm(workDir, { recursive: true, force: true });
    } catch (err) {
      logger.log({
        level: "warn",
        message: `Failed to cleanup work dir ${workDir}: ${err}`,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Execute a Kamal command
  // ---------------------------------------------------------------------------

  async function exec(options: TKamalExecOptions): Promise<TKamalExecResult> {
    const { appId, command, args = [], env = {}, timeout = KAMAL_TIMEOUT_MS, onLog } = options;

    const startTime = Date.now();

    // Load app
    const app = await appRepo.getById(appId);
    if (!app) {
      throw new NotFoundError("App not found");
    }

    // Load servers
    const servers = await Promise.all(
      app.serverIds.map(async (id) => {
        const server = await serverRepo.getById(id);
        if (!server) {
          throw new NotFoundError(`Server not found: ${id}`);
        }
        return server;
      })
    );

    // Get SSH key
    let sshKey = null;
    if (servers[0].sshKeyId) {
      sshKey = await sshKeyRepo.getById(servers[0].sshKeyId);
    }
    if (!sshKey) {
      sshKey = await sshKeyRepo.getDefault();
    }
    if (!sshKey) {
      throw new BadRequestError("No SSH key available");
    }

    // Write SSH key to temp file
    const sshKeyPath = path.join(os.tmpdir(), `cp_kamal_key_${Date.now()}`);
    await fs.promises.writeFile(sshKeyPath, sshKey.privateKey, { mode: 0o600 });

    // Setup working directory
    const workDir = await setupWorkDir(app, servers, sshKeyPath);

    try {
      // Build kamal command
      const kamalArgs = command.split(" ").concat(args);

      if (options.version && command === "rollback") {
        kamalArgs.push(options.version);
      }

      logger.log({
        level: "info",
        message: `Executing: kamal ${kamalArgs.join(" ")} [app: ${app.name}]`,
      });

      // Execute kamal
      const result = await execKamalProcess(
        kamalArgs,
        workDir,
        {
          ...env,
          SSH_AUTH_SOCK: "",
          KAMAL_REGISTRY_PASSWORD: app.registry?.password || "",
        },
        timeout,
        onLog
      );

      const duration = Date.now() - startTime;

      logger.log({
        level: result.success ? "info" : "error",
        message: `Kamal ${command} for ${app.name} finished with code ${result.exitCode} in ${duration}ms`,
      });

      return { ...result, duration };
    } finally {
      // Cleanup
      await cleanupWorkDir(workDir);
      await fs.promises.unlink(sshKeyPath).catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------
  // Execute kamal process
  // ---------------------------------------------------------------------------

  function execKamalProcess(
    args: string[],
    cwd: string,
    env: Record<string, string>,
    timeout: number,
    onLog?: (line: string) => void
  ): Promise<TKamalExecResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const stdout: string[] = [];
      const stderr: string[] = [];

      const proc: ChildProcess = spawn("kamal", args, {
        cwd,
        env: {
          ...process.env,
          ...env,
          // Ensure Kamal can find config
          KAMAL_CONFIG_DIR: path.join(cwd, "config"),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        setTimeout(() => proc.kill("SIGKILL"), 5000);
      }, timeout);

      proc.stdout?.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n");
        for (const line of lines) {
          if (line.trim()) {
            stdout.push(line);
            if (onLog) onLog(line);
          }
        }
      });

      proc.stderr?.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n");
        for (const line of lines) {
          if (line.trim()) {
            stderr.push(line);
            if (onLog) onLog(`[ERR] ${line}`);
          }
        }
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          success: code === 0,
          exitCode: code ?? -1,
          stdout: stdout.join("\n"),
          stderr: stderr.join("\n"),
          duration: Date.now() - startTime,
        });
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        logger.log({
          level: "error",
          message: `Kamal process error: ${err.message}`,
        });
        resolve({
          success: false,
          exitCode: -1,
          stdout: stdout.join("\n"),
          stderr: err.message,
          duration: Date.now() - startTime,
        });
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Deploy: Full deployment workflow
  // ---------------------------------------------------------------------------

  async function deploy(options: TDeployOptions): Promise<TDeployResult> {
    const { appId, version, force, triggeredBy, onLog } = options;
    const logs: string[] = [];
    const startTime = Date.now();

    const log = (line: string) => {
      logs.push(line);
      logBroker.addLine(appId, line);
      if (onLog) onLog(line);
      logger.log({ level: "info", message: `[Deploy ${appId}] ${line}` });
    };

    try {
      // Load app
      const app = await appRepo.getById(appId);
      if (!app) throw new NotFoundError("App not found");

      // Determine image/version
      let targetImage = app.source.image || `${app.registry?.server}/${app.name}`;
      if (version) {
        targetImage = targetImage.includes(":") 
          ? targetImage.replace(/:.*$/, `:${version}`)
          : `${targetImage}:${version}`;
      }

      log(`Deploying ${app.name}...`);
      log(`Image: ${targetImage}`);
      log(`Servers: ${app.serverIds.length}`);

      // Update app status to deploying
      await appRepo.updateById(appId, { status: "deploying" });

      // Create deployment record
      const deploymentId = await deploymentRepo.add({
        appId: appId,
        image: targetImage,
        triggeredBy: triggeredBy || new ObjectId().toHexString(),
      });

      await deploymentRepo.updateStatus(deploymentId, "running");

      logBroker.addLine(appId, `[deploy] Starting deployment of ${app.name}...`);

      // Execute Kamal deploy
      const kamalCommand = force ? "deploy" : "deploy";
      const kamalArgs: string[] = [];

      if (version) {
        kamalArgs.push("--version", version);
      }

      const result = await exec({
        appId,
        command: kamalCommand as TKamalCommand,
        args: kamalArgs,
        onLog: log,
      });

      // Update deployment record
      await deploymentRepo.updateStatus(
        deploymentId,
        result.success ? "success" : "failed",
        logs.join("\n")
      );

      logBroker.complete(appId, result.success ? "success" : "failed");

      if (result.success) {
        // Update app status
        await appRepo.updateById(appId, {
          status: "running",
          currentVersion: version || "latest",
          currentImage: targetImage,
          deployedAt: new Date(),
        });

        log("Deployment successful!");

        return {
          success: true,
          deploymentId: deploymentId.toString(),
          version: version || "latest",
          logs,
          duration: Date.now() - startTime,
        };
      } else {
        // Update app status
        await appRepo.updateById(appId, { status: "failed" });

        log("Deployment failed!");
        log(result.stderr);

        return {
          success: false,
          deploymentId: deploymentId.toString(),
          error: result.stderr || "Deployment failed",
          logs,
          duration: Date.now() - startTime,
        };
      }
    } catch (error: any) {
      log(`Error: ${error.message}`);
      await appRepo.updateById(appId, { status: "failed" }).catch(() => {});

      return {
        success: false,
        error: error.message,
        logs,
        duration: Date.now() - startTime,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Redeploy: Redeploy current version
  // ---------------------------------------------------------------------------

  async function redeploy(options: Omit<TDeployOptions, "version">): Promise<TDeployResult> {
    const { appId, triggeredBy, onLog } = options;
    const logs: string[] = [];
    const startTime = Date.now();

    const log = (line: string) => {
      logs.push(line);
      logBroker.addLine(appId, line);
      if (onLog) onLog(line);
    };

    try {
      log("Redeploying...");

      const result = await exec({
        appId,
        command: "redeploy",
        onLog: log,
      });

      if (result.success) {
        await appRepo.updateById(appId, {
          status: "running",
          deployedAt: new Date(),
        });
      }

      logBroker.complete(appId, result.success ? "success" : "failed");

      return {
        success: result.success,
        error: result.success ? undefined : result.stderr,
        logs,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        logs,
        duration: Date.now() - startTime,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Rollback: Rollback to previous version
  // ---------------------------------------------------------------------------

  async function rollback(options: TDeployOptions): Promise<TDeployResult> {
    const { appId, version, triggeredBy, onLog } = options;
    const logs: string[] = [];
    const startTime = Date.now();

    const log = (line: string) => {
      logs.push(line);
      logBroker.addLine(appId, line);
      if (onLog) onLog(line);
    };

    try {
      log(`Rolling back${version ? ` to version ${version}` : ""}...`);

      const result = await exec({
        appId,
        command: "rollback",
        version,
        onLog: log,
      });

      if (result.success) {
        await appRepo.updateById(appId, {
          status: "running",
          currentVersion: version || "previous",
          deployedAt: new Date(),
        });
      }

      logBroker.complete(appId, result.success ? "success" : "failed");

      return {
        success: result.success,
        version: version || "previous",
        error: result.success ? undefined : result.stderr,
        logs,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        logs,
        duration: Date.now() - startTime,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Stop: Stop all containers for an app
  // ---------------------------------------------------------------------------

  async function stop(appId: string, onLog?: (line: string) => void): Promise<TKamalExecResult> {
    const result = await exec({ appId, command: "app stop", onLog });
    
    if (result.success) {
      await appRepo.updateById(appId, { status: "stopped" });
    }
    
    return result;
  }

  // ---------------------------------------------------------------------------
  // Start: Start containers for an app
  // ---------------------------------------------------------------------------

  async function start(appId: string, onLog?: (line: string) => void): Promise<TKamalExecResult> {
    const result = await exec({ appId, command: "app start", onLog });
    
    if (result.success) {
      await appRepo.updateById(appId, { status: "running" });
    }
    
    return result;
  }

  // ---------------------------------------------------------------------------
  // Logs: Get app logs
  // ---------------------------------------------------------------------------

  async function getLogs(appId: string, lines: number = 100): Promise<{ logs: string }> {
    const result = await exec({
      appId,
      command: "app logs",
      args: ["-n", String(lines)],
    });
    
    return { logs: result.stdout };
  }

  // ---------------------------------------------------------------------------
  // Version: Get current deployed version
  // ---------------------------------------------------------------------------

  async function getVersion(appId: string): Promise<string> {
    const result = await exec({
      appId,
      command: "app version",
    });
    
    return result.stdout.trim();
  }

  // ---------------------------------------------------------------------------
  // Exec: Execute command in running container
  // ---------------------------------------------------------------------------

  async function appExec(
    appId: string,
    command: string,
    onLog?: (line: string) => void
  ): Promise<TKamalExecResult> {
    return exec({
      appId,
      command: "app exec",
      args: ["--reuse", command],
      onLog,
    });
  }

  // ---------------------------------------------------------------------------
  // Proxy: Boot kamal-proxy on servers
  // ---------------------------------------------------------------------------

  async function bootProxy(appId: string, onLog?: (line: string) => void): Promise<TKamalExecResult> {
    return exec({ appId, command: "proxy boot", onLog });
  }

  // ---------------------------------------------------------------------------
  // Check if Kamal is installed
  // ---------------------------------------------------------------------------

  async function checkInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn("kamal", ["version"]);
      proc.on("close", (code) => resolve(code === 0));
      proc.on("error", () => resolve(false));
    });
  }

  return {
    exec,
    deploy,
    redeploy,
    rollback,
    stop,
    start,
    getLogs,
    getVersion,
    appExec,
    bootProxy,
    checkInstalled,
  };
}
