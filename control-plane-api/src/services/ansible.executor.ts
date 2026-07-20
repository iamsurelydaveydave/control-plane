import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { logger } from "../utils";

export type TAnsibleExecOptions = {
  playbook: string;
  inventory?: string;
  extraVars?: Record<string, any>;
  tags?: string[];
  limit?: string;
  verbose?: boolean;
  checkMode?: boolean;
};

export type TAnsibleExecResult = {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
};

export type TLogCallback = (line: string) => void;

const ANSIBLE_DIR = path.join(__dirname, "../../ansible");

/**
 * Ansible Executor Service
 * Executes Ansible playbooks and streams output
 */
export function useAnsibleExecutor() {
  /**
   * Generate a dynamic inventory file from server data
   */
  function generateInventory(
    servers: Array<{
      host: string;
      sshUser: string;
      sshPort: number;
      privateIp?: string;
      role?: string;
      vars?: Record<string, any>;
    }>,
    groups?: Record<string, string[]>
  ): string {
    const lines: string[] = [];

    // Group servers by role if groups not provided
    const serverGroups: Record<string, typeof servers> = {};

    if (groups) {
      // Use explicit group definitions
      for (const [groupName, hostnames] of Object.entries(groups)) {
        serverGroups[groupName] = servers.filter((s) =>
          hostnames.includes(s.host)
        );
      }
    } else {
      // Group by role
      for (const server of servers) {
        const role = server.role || "default";
        if (!serverGroups[role]) {
          serverGroups[role] = [];
        }
        serverGroups[role].push(server);
      }
    }

    // Generate inventory content
    for (const [groupName, groupServers] of Object.entries(serverGroups)) {
      lines.push(`[${groupName}]`);
      for (const server of groupServers) {
        const hostVars = [
          `ansible_host=${server.host}`,
          `ansible_user=${server.sshUser}`,
          `ansible_port=${server.sshPort}`,
        ];

        if (server.privateIp) {
          hostVars.push(`private_ip=${server.privateIp}`);
        }

        if (server.vars) {
          for (const [key, value] of Object.entries(server.vars)) {
            hostVars.push(`${key}=${JSON.stringify(value)}`);
          }
        }

        // Use host as the inventory hostname
        const hostname = server.host.replace(/\./g, "_");
        lines.push(`${hostname} ${hostVars.join(" ")}`);
      }
      lines.push("");
    }

    // Add children groups if multiple roles
    const roleNames = Object.keys(serverGroups);
    if (roleNames.length > 1) {
      lines.push("[all:children]");
      for (const role of roleNames) {
        lines.push(role);
      }
      lines.push("");
    }

    // Add common variables
    lines.push("[all:vars]");
    lines.push("ansible_python_interpreter=/usr/bin/python3");

    return lines.join("\n");
  }

  /**
   * Write inventory to a temporary file
   */
  async function writeInventoryFile(content: string): Promise<string> {
    const tmpDir = os.tmpdir();
    const filename = `cp_inventory_${Date.now()}.ini`;
    const filepath = path.join(tmpDir, filename);

    await fs.promises.writeFile(filepath, content, "utf-8");
    logger.log({
      level: "info",
      message: `Inventory written to ${filepath}`,
    });

    return filepath;
  }

  /**
   * Write extra vars to a temporary JSON file
   */
  async function writeExtraVarsFile(
    vars: Record<string, any>
  ): Promise<string> {
    const tmpDir = os.tmpdir();
    const filename = `cp_vars_${Date.now()}.json`;
    const filepath = path.join(tmpDir, filename);

    await fs.promises.writeFile(filepath, JSON.stringify(vars, null, 2), "utf-8");
    logger.log({
      level: "info",
      message: `Extra vars written to ${filepath}`,
    });

    return filepath;
  }

  /**
   * Execute an Ansible playbook
   */
  async function execPlaybook(
    options: TAnsibleExecOptions,
    onLog?: TLogCallback
  ): Promise<TAnsibleExecResult> {
    const startTime = Date.now();

    const playbookPath = options.playbook.startsWith("/")
      ? options.playbook
      : path.join(ANSIBLE_DIR, "playbooks", options.playbook);

    // Verify playbook exists
    if (!fs.existsSync(playbookPath)) {
      throw new Error(`Playbook not found: ${playbookPath}`);
    }

    // Build command arguments
    const args: string[] = [playbookPath];

    // Add inventory
    if (options.inventory) {
      args.push("-i", options.inventory);
    }

    // Add extra vars file
    let varsFile: string | null = null;
    if (options.extraVars && Object.keys(options.extraVars).length > 0) {
      varsFile = await writeExtraVarsFile(options.extraVars);
      args.push("-e", `@${varsFile}`);
    }

    // Add tags
    if (options.tags && options.tags.length > 0) {
      args.push("--tags", options.tags.join(","));
    }

    // Add limit
    if (options.limit) {
      args.push("--limit", options.limit);
    }

    // Add verbosity
    if (options.verbose) {
      args.push("-vv");
    }

    // Check mode (dry run)
    if (options.checkMode) {
      args.push("--check");
    }

    logger.log({
      level: "info",
      message: `Executing: ansible-playbook ${args.join(" ")}`,
    });

    return new Promise((resolve) => {
      const stdout: string[] = [];
      const stderr: string[] = [];

      const proc: ChildProcess = spawn("ansible-playbook", args, {
        cwd: ANSIBLE_DIR,
        env: {
          ...process.env,
          ANSIBLE_CONFIG: path.join(ANSIBLE_DIR, "ansible.cfg"),
          ANSIBLE_FORCE_COLOR: "true",
          PYTHONUNBUFFERED: "1",
        },
      });

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
            if (onLog) onLog(`[STDERR] ${line}`);
          }
        }
      });

      proc.on("close", async (code) => {
        const duration = Date.now() - startTime;

        // Cleanup temp files
        if (varsFile) {
          fs.unlink(varsFile, () => {});
        }

        const result: TAnsibleExecResult = {
          success: code === 0,
          exitCode: code ?? -1,
          stdout: stdout.join("\n"),
          stderr: stderr.join("\n"),
          duration,
        };

        logger.log({
          level: result.success ? "info" : "error",
          message: `Ansible playbook finished with code ${code} in ${duration}ms`,
        });

        resolve(result);
      });

      proc.on("error", (err) => {
        const duration = Date.now() - startTime;

        logger.log({
          level: "error",
          message: `Ansible playbook error: ${err.message}`,
        });

        resolve({
          success: false,
          exitCode: -1,
          stdout: stdout.join("\n"),
          stderr: err.message,
          duration,
        });
      });
    });
  }

  /**
   * Check if Ansible is installed
   */
  async function checkAnsibleInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn("ansible-playbook", ["--version"]);
      proc.on("close", (code) => resolve(code === 0));
      proc.on("error", () => resolve(false));
    });
  }

  return {
    generateInventory,
    writeInventoryFile,
    writeExtraVarsFile,
    execPlaybook,
    checkAnsibleInstalled,
    ANSIBLE_DIR,
  };
}
