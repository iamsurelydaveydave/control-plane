import { Client, ConnectConfig } from "ssh2";
import { EventEmitter } from "events";
import { useServerRepo } from "./server.repository";
import { useSSHKeyRepo } from "../ssh-key/ssh-key.repository";
import { TSetupStep, TSetupStatus, TServerStatus, TServerResources } from "./server.model";
import { BadRequestError, NotFoundError, logger } from "../../utils";

const CONNECT_TIMEOUT_MS = 30_000;
const COMMAND_TIMEOUT_MS = 30_000;
const INSTALL_TIMEOUT_MS = 300_000;

// ── Per-server SSE emitters ───────────────────────────────────────────────────

const setupEmitters = new Map<string, EventEmitter>();

export type TSetupStreamData = {
  setupStatus: TSetupStatus;
  setupLog: TSetupStep[];
  status: TServerStatus;
  resources?: TServerResources;
  dockerInstalled?: boolean;
  setupCompletedAt?: Date;
};

/**
 * Returns (or creates) the EventEmitter for a server's active setup.
 * Emits:
 *   "update" (TSetupStreamData) — after each step change
 *   "done"   (TSetupStreamData) — once, when setup finishes (success or failure)
 */
export function getSetupEmitter(serverId: string): EventEmitter {
  if (!setupEmitters.has(serverId)) {
    setupEmitters.set(serverId, new EventEmitter());
  }
  return setupEmitters.get(serverId)!;
}

export function useServerService() {
  const repo = useServerRepo();
  const sshKeyRepo = useSSHKeyRepo();

  function execSSHCommand(
    conn: Client,
    command: string,
    timeoutMs = COMMAND_TIMEOUT_MS
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Command timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);

      conn.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          reject(err);
          return;
        }

        let stdout = "";
        let stderr = "";

        stream.on("close", (code: number) => {
          clearTimeout(timer);
          resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code });
        });
        stream.on("data", (data: Buffer) => { stdout += data.toString(); });
        stream.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
      });
    });
  }

  function connectSSH(
    host: string,
    port: number,
    username: string,
    privateKey: string
  ): Promise<Client> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      const timer = setTimeout(() => {
        conn.end();
        reject(new Error(`SSH connection timeout to ${host}:${port}`));
      }, CONNECT_TIMEOUT_MS);

      conn.on("ready", () => {
        clearTimeout(timer);
        resolve(conn);
      });

      conn.on("error", (err) => {
        clearTimeout(timer);
        conn.end();
        reject(err);
      });

      const config: ConnectConfig = {
        host,
        port,
        username,
        privateKey,
        readyTimeout: CONNECT_TIMEOUT_MS,
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

      conn.connect(config);
    });
  }

  async function setupServer(serverId: string): Promise<void> {
    const server = await repo.getById(serverId);
    if (!server) throw new NotFoundError("Server not found");
    if (!server.sshKeyId) throw new BadRequestError("Server has no SSH key configured");

    const sshKey = await sshKeyRepo.getById(server.sshKeyId);
    if (!sshKey) throw new NotFoundError("SSH key not found");

    await repo.updateById(serverId, {
      status: "provisioning",
      setupStatus: "running",
      setupStartedAt: new Date(),
      setupLog: [],
    });

    const steps: TSetupStep[] = [];
    const emitter = getSetupEmitter(serverId);

    // Upsert a step by name, persist to DB, and broadcast to SSE listeners
    async function persistStep(step: TSetupStep): Promise<void> {
      const idx = steps.findIndex((s) => s.name === step.name);
      if (idx >= 0) {
        steps[idx] = step;
      } else {
        steps.push(step);
      }
      await repo.updateById(serverId, { setupLog: [...steps] }).catch(() => {});
      emitter.emit("update", {
        setupStatus: "running",
        setupLog: [...steps],
        status: "provisioning",
      } satisfies TSetupStreamData);
    }

    let conn: Client | null = null;

    try {
      logger.log({ level: "info", message: `[setup] Connecting to ${server.host}` });
      conn = await connectSSH(server.host, server.sshPort, server.sshUser, sshKey.privateKey);

      // ── Step 1: Docker ──────────────────────────────────────────────────
      const t1 = Date.now();
      await persistStep({ name: "docker", label: "Check Docker", status: "running" });
      const dockerCheck = await execSSHCommand(conn, "docker --version");

      if (dockerCheck.code === 0) {
        await persistStep({
          name: "docker",
          label: "Check Docker",
          status: "success",
          output: `Already installed: ${dockerCheck.stdout}`,
          duration: Date.now() - t1,
        });
      } else {
        await persistStep({ name: "docker", label: "Install Docker", status: "running" });
        logger.log({ level: "info", message: `[setup] Installing Docker on ${server.host}` });

        const installResult = await execSSHCommand(
          conn,
          "curl -fsSL https://get.docker.com | sh",
          INSTALL_TIMEOUT_MS
        );

        if (installResult.code !== 0) {
          await persistStep({
            name: "docker",
            label: "Install Docker",
            status: "failed",
            error: installResult.stderr || "Installation script exited with non-zero code",
            duration: Date.now() - t1,
          });
          throw new Error(`Docker installation failed: ${installResult.stderr}`);
        }

        await persistStep({
          name: "docker",
          label: "Install Docker",
          status: "success",
          output: "Installed successfully via official script",
          duration: Date.now() - t1,
        });
      }

      // ── Step 2: Docker service ──────────────────────────────────────────
      const t2 = Date.now();
      await persistStep({ name: "docker_service", label: "Enable Docker service", status: "running" });
      await execSSHCommand(conn, "systemctl enable docker && systemctl start docker");
      await persistStep({
        name: "docker_service",
        label: "Enable Docker service",
        status: "success",
        output: "Docker service enabled and started",
        duration: Date.now() - t2,
      });

      // ── Step 3: Firewall ────────────────────────────────────────────────
      const t3 = Date.now();
      await persistStep({ name: "firewall", label: "Configure firewall", status: "running" });
      const ufwResult = await execSSHCommand(conn, "ufw status 2>/dev/null || echo inactive");
      const ufwActive = ufwResult.stdout.includes("Status: active");

      if (ufwActive) {
        await execSSHCommand(conn, "ufw allow 22/tcp");
        await execSSHCommand(conn, "ufw allow 80/tcp");
        await execSSHCommand(conn, "ufw allow 443/tcp");
        await execSSHCommand(conn, "ufw allow 3000:3100/tcp");
        await persistStep({
          name: "firewall",
          label: "Configure firewall",
          status: "success",
          output: "Opened ports 22, 80, 443, 3000–3100",
          duration: Date.now() - t3,
        });
      } else {
        await persistStep({
          name: "firewall",
          label: "Configure firewall",
          status: "skipped",
          output: "UFW not active — no changes needed",
          duration: Date.now() - t3,
        });
      }

      // ── Step 4: System info ─────────────────────────────────────────────
      const t4 = Date.now();
      await persistStep({ name: "system_info", label: "Gather system info", status: "running" });
      const [cpuResult, memResult, diskResult] = await Promise.all([
        execSSHCommand(conn, "nproc"),
        execSSHCommand(conn, "free -m | awk '/^Mem:/ {print $2}'"),
        execSSHCommand(conn, "df -BG / | awk 'NR==2 {gsub(/G/,\"\"); print $2}'"),
      ]);

      const resources = {
        cpuCores: parseInt(cpuResult.stdout, 10) || 0,
        memoryMb: parseInt(memResult.stdout, 10) || 0,
        diskGb: parseInt(diskResult.stdout, 10) || 0,
      };

      await persistStep({
        name: "system_info",
        label: "Gather system info",
        status: "success",
        output: `${resources.cpuCores} CPU cores · ${resources.memoryMb} MB RAM · ${resources.diskGb} GB disk`,
        duration: Date.now() - t4,
      });

      conn.end();
      conn = null;

      await repo.updateById(serverId, {
        status: "online",
        setupStatus: "success",
        setupCompletedAt: new Date(),
        dockerInstalled: true,
        bootstrappedAt: new Date(),
        lastHealthCheck: new Date(),
        resources,
      });

      const doneData: TSetupStreamData = {
        setupStatus: "success",
        setupLog: [...steps],
        status: "online",
        dockerInstalled: true,
        resources,
        setupCompletedAt: new Date(),
      };
      emitter.emit("update", doneData);
      emitter.emit("done", doneData);
      setupEmitters.delete(serverId);

      logger.log({ level: "info", message: `[setup] Server ${server.host} setup complete` });
    } catch (err: any) {
      if (conn) {
        try { conn.end(); } catch { /* ignore */ }
      }

      logger.log({
        level: "error",
        message: `[setup] Server ${server.host} setup failed: ${err.message}`,
      });

      await repo.updateById(serverId, {
        status: "offline",
        setupStatus: "failed",
        setupCompletedAt: new Date(),
        setupLog: [...steps],
      }).catch(() => {});

      const failData: TSetupStreamData = {
        setupStatus: "failed",
        setupLog: [...steps],
        status: "offline",
        setupCompletedAt: new Date(),
      };
      emitter.emit("update", failData);
      emitter.emit("done", failData);
      setupEmitters.delete(serverId);
    }
  }

  return { setupServer };
}
