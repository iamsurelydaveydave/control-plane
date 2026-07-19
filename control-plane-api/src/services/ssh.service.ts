import { Client, ConnectConfig } from "ssh2";
import { logger } from "../utils";

export type TSSHConnectionParams = {
  host: string;
  port: number;
  username: string;
  privateKey: string;
};

export type TSSHServerInfo = {
  os: string;
  hostname: string;
  uptime: string;
};

export type TSSHSystemResources = {
  cpuCores: number;
  memoryMb: number;
  diskGb: number;
};

export type TSSHConnectionResult = {
  success: boolean;
  error?: string;
  serverInfo?: TSSHServerInfo;
};

export type TSSHHealthCheckResult = {
  success: boolean;
  error?: string;
  serverInfo?: TSSHServerInfo;
  resources?: TSSHSystemResources;
};

const SSH_TIMEOUT_MS = 10000;

/**
 * SSH Service
 * Handles SSH connections and command execution
 */
export function useSSHService() {
  /**
   * Execute a command over SSH and return the output
   */
  function execCommand(
    conn: Client,
    command: string
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve, reject) => {
      conn.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        let stdout = "";
        let stderr = "";

        stream.on("close", (code: number) => {
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
   * Parse uptime output to a human-readable format
   */
  function parseUptime(uptimeOutput: string): string {
    // uptime output looks like: " 14:32:10 up 45 days,  2:15,  1 user,  load average: 0.00, 0.01, 0.05"
    const match = uptimeOutput.match(/up\s+(.+?),\s+\d+\s+user/);
    if (match) {
      return match[1].trim();
    }
    // Fallback: try to extract just the uptime portion
    const simpleMatch = uptimeOutput.match(/up\s+(.+?)(?:,\s+load|$)/);
    if (simpleMatch) {
      return simpleMatch[1].trim();
    }
    return uptimeOutput.trim();
  }

  /**
   * Test SSH connection to a server
   * Connects, runs diagnostic commands, and returns server info
   */
  async function testConnection(
    params: TSSHConnectionParams
  ): Promise<TSSHConnectionResult> {
    const { host, port, username, privateKey } = params;

    const conn = new Client();

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        conn.end();
        resolve({
          success: false,
          error: `Connection timeout after ${SSH_TIMEOUT_MS / 1000} seconds`,
        });
      }, SSH_TIMEOUT_MS);

      conn.on("ready", async () => {
        clearTimeout(timeout);

        try {
          // Run diagnostic commands
          const [unameResult, hostnameResult, uptimeResult] = await Promise.all([
            execCommand(conn, "uname -a"),
            execCommand(conn, "hostname"),
            execCommand(conn, "uptime"),
          ]);

          conn.end();

          if (unameResult.code !== 0) {
            resolve({
              success: false,
              error: `Failed to execute uname: ${unameResult.stderr}`,
            });
            return;
          }

          resolve({
            success: true,
            serverInfo: {
              os: unameResult.stdout,
              hostname: hostnameResult.stdout,
              uptime: parseUptime(uptimeResult.stdout),
            },
          });
        } catch (error: any) {
          conn.end();
          resolve({
            success: false,
            error: `Command execution failed: ${error.message}`,
          });
        }
      });

      conn.on("error", (err) => {
        clearTimeout(timeout);
        conn.end();

        let errorMessage = err.message;

        // Provide more helpful error messages for common issues
        if (err.message.includes("ECONNREFUSED")) {
          errorMessage = `Connection refused to ${host}:${port}`;
        } else if (err.message.includes("ETIMEDOUT")) {
          errorMessage = `Connection timed out to ${host}:${port}`;
        } else if (err.message.includes("ENOTFOUND")) {
          errorMessage = `Host not found: ${host}`;
        } else if (err.message.includes("authentication")) {
          errorMessage = `Authentication failed for user ${username}`;
        }

        logger.log({
          level: "warn",
          message: `SSH connection failed to ${host}:${port}: ${err.message}`,
        });

        resolve({
          success: false,
          error: errorMessage,
        });
      });

      const connectConfig: ConnectConfig = {
        host,
        port,
        username,
        privateKey,
        readyTimeout: SSH_TIMEOUT_MS,
        // Disable host key verification for now (common in dev/provisioning scenarios)
        // In production, you might want to implement known_hosts checking
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

      try {
        conn.connect(connectConfig);
      } catch (error: any) {
        clearTimeout(timeout);
        resolve({
          success: false,
          error: `Failed to initiate connection: ${error.message}`,
        });
      }
    });
  }

  /**
   * Get system resources via SSH
   * Gathers CPU cores, memory, and disk info
   */
  async function getSystemResources(
    params: TSSHConnectionParams
  ): Promise<TSSHHealthCheckResult> {
    const { host, port, username, privateKey } = params;

    const conn = new Client();

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        conn.end();
        resolve({
          success: false,
          error: `Connection timeout after ${SSH_TIMEOUT_MS / 1000} seconds`,
        });
      }, SSH_TIMEOUT_MS);

      conn.on("ready", async () => {
        clearTimeout(timeout);

        try {
          // Run diagnostic and resource commands
          const [
            unameResult,
            hostnameResult,
            uptimeResult,
            cpuResult,
            memoryResult,
            diskResult,
          ] = await Promise.all([
            execCommand(conn, "uname -a"),
            execCommand(conn, "hostname"),
            execCommand(conn, "uptime"),
            execCommand(conn, "nproc"),
            execCommand(conn, "free -m | awk '/^Mem:/ {print $2}'"),
            execCommand(conn, "df -BG / | awk 'NR==2 {gsub(/G/,\"\"); print $2}'"),
          ]);

          conn.end();

          if (unameResult.code !== 0) {
            resolve({
              success: false,
              error: `Failed to execute uname: ${unameResult.stderr}`,
            });
            return;
          }

          // Parse resource values
          const cpuCores = parseInt(cpuResult.stdout, 10) || 0;
          const memoryMb = parseInt(memoryResult.stdout, 10) || 0;
          const diskGb = parseInt(diskResult.stdout, 10) || 0;

          resolve({
            success: true,
            serverInfo: {
              os: unameResult.stdout,
              hostname: hostnameResult.stdout,
              uptime: parseUptime(uptimeResult.stdout),
            },
            resources: {
              cpuCores,
              memoryMb,
              diskGb,
            },
          });
        } catch (error: any) {
          conn.end();
          resolve({
            success: false,
            error: `Command execution failed: ${error.message}`,
          });
        }
      });

      conn.on("error", (err) => {
        clearTimeout(timeout);
        conn.end();

        let errorMessage = err.message;

        // Provide more helpful error messages for common issues
        if (err.message.includes("ECONNREFUSED")) {
          errorMessage = `Connection refused to ${host}:${port}`;
        } else if (err.message.includes("ETIMEDOUT")) {
          errorMessage = `Connection timed out to ${host}:${port}`;
        } else if (err.message.includes("ENOTFOUND")) {
          errorMessage = `Host not found: ${host}`;
        } else if (err.message.includes("authentication")) {
          errorMessage = `Authentication failed for user ${username}`;
        }

        logger.log({
          level: "warn",
          message: `SSH health check failed to ${host}:${port}: ${err.message}`,
        });

        resolve({
          success: false,
          error: errorMessage,
        });
      });

      const connectConfig: ConnectConfig = {
        host,
        port,
        username,
        privateKey,
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

      try {
        conn.connect(connectConfig);
      } catch (error: any) {
        clearTimeout(timeout);
        resolve({
          success: false,
          error: `Failed to initiate connection: ${error.message}`,
        });
      }
    });
  }

  return {
    testConnection,
    getSystemResources,
    execCommand,
  };
}
