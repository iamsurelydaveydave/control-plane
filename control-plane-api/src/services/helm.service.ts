import { spawn, execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { logger } from "../utils";
import { BadRequestError, InternalServerError } from "../utils/error";

// =============================================================================
// Types
// =============================================================================

export type THelmRelease = {
  name: string;
  namespace: string;
  revision: string;
  updated: string;
  status: string;
  chart: string;
  app_version: string;
};

export type THelmReleaseStatus = {
  name: string;
  namespace: string;
  status: string;
  description?: string;
  notes?: string;
};

export type THelmInstallResult = {
  name: string;
  namespace: string;
  status: string;
  revision: number;
};

// =============================================================================
// Helm Service
// =============================================================================

/**
 * Helm service for managing Helm releases via CLI.
 * Uses child_process to run helm commands.
 */
export function useHelmService() {
  const helmBinary = process.env.HELM_BINARY || "helm";
  const kubeconfig = process.env.KUBECONFIG || "/etc/rancher/k3s/k3s.yaml";

  /**
   * Check if Helm is available
   */
  function isAvailable(): boolean {
    try {
      execSync(`${helmBinary} version --short`, { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get Helm version
   */
  function getVersion(): string {
    try {
      const result = execSync(`${helmBinary} version --short`, { encoding: "utf-8" });
      return result.trim();
    } catch (error) {
      throw new InternalServerError("Failed to get Helm version");
    }
  }

  /**
   * Add a Helm repository
   */
  async function addRepo(name: string, url: string): Promise<void> {
    try {
      await runHelmCommand(["repo", "add", name, url, "--force-update"]);
      await runHelmCommand(["repo", "update"]);
      logger.log({
        level: "info",
        message: `[Helm] Added repo ${name}: ${url}`,
      });
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `[Helm] Failed to add repo ${name}: ${error.message}`,
      });
      throw error;
    }
  }

  /**
   * Ensure Bitnami repo is added (required for most addons)
   */
  async function ensureBitnamiRepo(): Promise<void> {
    try {
      await addRepo("bitnami", "https://charts.bitnami.com/bitnami");
    } catch (error: any) {
      // Ignore if already exists
      if (!error.message?.includes("already exists")) {
        throw error;
      }
    }
  }

  /**
   * Install a Helm chart
   */
  async function install(
    releaseName: string,
    chart: string,
    namespace: string,
    values: Record<string, any>,
    options: {
      version?: string;
      createNamespace?: boolean;
      wait?: boolean;
      timeout?: string;
    } = {}
  ): Promise<THelmInstallResult> {
    // Ensure the bitnami repo is available for bitnami charts
    if (chart.startsWith("bitnami/")) {
      await ensureBitnamiRepo();
    }

    // Resolve local chart paths (control-plane/* charts)
    let resolvedChart = chart;
    if (chart.startsWith("control-plane/")) {
      const chartName = chart.replace("control-plane/", "");
      // Local charts are in deploy/helm/<chart-name>
      const localChartPath = path.join(__dirname, "../../..", "deploy/helm", chartName);
      if (fs.existsSync(localChartPath)) {
        resolvedChart = localChartPath;
        logger.log({
          level: "info",
          message: `[Helm] Using local chart: ${localChartPath}`,
        });
        // Run helm dependency update for local charts
        try {
          await runHelmCommand(["dependency", "update", resolvedChart]);
        } catch (depError: any) {
          logger.log({
            level: "warn",
            message: `[Helm] Dependency update warning: ${depError.message}`,
          });
        }
      } else {
        throw new InternalServerError(`Local chart not found: ${localChartPath}`);
      }
    }

    // Create temporary values file
    const valuesFile = await writeValuesFile(values);

    try {
      const args: string[] = [
        "install",
        releaseName,
        resolvedChart,
        "--namespace",
        namespace,
        "--values",
        valuesFile,
        "--output",
        "json",
      ];

      if (options.version && !chart.startsWith("control-plane/")) {
        args.push("--version", options.version);
      }

      if (options.createNamespace !== false) {
        args.push("--create-namespace");
      }

      if (options.wait !== false) {
        args.push("--wait");
        args.push("--timeout", options.timeout || "10m");
      }

      const output = await runHelmCommand(args);
      const result = JSON.parse(output);

      logger.log({
        level: "info",
        message: `[Helm] Installed ${releaseName} (${chart}) in ${namespace}`,
      });

      return {
        name: result.name || releaseName,
        namespace: result.namespace || namespace,
        status: result.info?.status || "deployed",
        revision: result.version || 1,
      };
    } finally {
      // Clean up values file
      cleanupValuesFile(valuesFile);
    }
  }

  /**
   * Upgrade an existing Helm release
   */
  async function upgrade(
    releaseName: string,
    chart: string,
    namespace: string,
    values: Record<string, any>,
    options: {
      version?: string;
      install?: boolean;
      wait?: boolean;
      timeout?: string;
      reuseValues?: boolean;
    } = {}
  ): Promise<THelmInstallResult> {
    // Ensure the bitnami repo is available
    if (chart.startsWith("bitnami/")) {
      await ensureBitnamiRepo();
    }

    // Resolve local chart paths (control-plane/* charts)
    let resolvedChart = chart;
    if (chart.startsWith("control-plane/")) {
      const chartName = chart.replace("control-plane/", "");
      const localChartPath = path.join(__dirname, "../../..", "deploy/helm", chartName);
      if (fs.existsSync(localChartPath)) {
        resolvedChart = localChartPath;
        logger.log({
          level: "info",
          message: `[Helm] Using local chart: ${localChartPath}`,
        });
        try {
          await runHelmCommand(["dependency", "update", resolvedChart]);
        } catch (depError: any) {
          logger.log({
            level: "warn",
            message: `[Helm] Dependency update warning: ${depError.message}`,
          });
        }
      } else {
        throw new InternalServerError(`Local chart not found: ${localChartPath}`);
      }
    }

    // Create temporary values file
    const valuesFile = await writeValuesFile(values);

    try {
      const args: string[] = [
        "upgrade",
        releaseName,
        resolvedChart,
        "--namespace",
        namespace,
        "--values",
        valuesFile,
        "--output",
        "json",
      ];

      if (options.version && !chart.startsWith("control-plane/")) {
        args.push("--version", options.version);
      }

      if (options.install !== false) {
        args.push("--install");
        args.push("--create-namespace");
      }

      if (options.wait !== false) {
        args.push("--wait");
        args.push("--timeout", options.timeout || "10m");
      }

      if (options.reuseValues) {
        args.push("--reuse-values");
      }

      const output = await runHelmCommand(args);
      const result = JSON.parse(output);

      logger.log({
        level: "info",
        message: `[Helm] Upgraded ${releaseName} (${chart}) in ${namespace}`,
      });

      return {
        name: result.name || releaseName,
        namespace: result.namespace || namespace,
        status: result.info?.status || "deployed",
        revision: result.version || 1,
      };
    } finally {
      cleanupValuesFile(valuesFile);
    }
  }

  /**
   * Uninstall a Helm release
   */
  async function uninstall(releaseName: string, namespace: string): Promise<void> {
    const args: string[] = [
      "uninstall",
      releaseName,
      "--namespace",
      namespace,
    ];

    try {
      await runHelmCommand(args);
      logger.log({
        level: "info",
        message: `[Helm] Uninstalled ${releaseName} from ${namespace}`,
      });
    } catch (error: any) {
      // If release not found, consider it already uninstalled
      if (error.message?.includes("not found")) {
        logger.log({
          level: "warn",
          message: `[Helm] Release ${releaseName} not found — already uninstalled`,
        });
        return;
      }
      throw error;
    }
  }

  /**
   * Get status of a Helm release
   */
  async function status(releaseName: string, namespace: string): Promise<THelmReleaseStatus | null> {
    const args: string[] = [
      "status",
      releaseName,
      "--namespace",
      namespace,
      "--output",
      "json",
    ];

    try {
      const output = await runHelmCommand(args);
      const result = JSON.parse(output);

      return {
        name: result.name || releaseName,
        namespace: result.namespace || namespace,
        status: result.info?.status || "unknown",
        description: result.info?.description,
        notes: result.info?.notes,
      };
    } catch (error: any) {
      // Release not found
      if (error.message?.includes("not found")) {
        return null;
      }
      throw error;
    }
  }

  /**
   * List all Helm releases in a namespace (or all namespaces)
   */
  async function list(namespace?: string): Promise<THelmRelease[]> {
    const args: string[] = ["list", "--output", "json"];

    if (namespace) {
      args.push("--namespace", namespace);
    } else {
      args.push("--all-namespaces");
    }

    try {
      const output = await runHelmCommand(args);
      const releases = JSON.parse(output);
      return releases || [];
    } catch (error) {
      logger.log({
        level: "error",
        message: `[Helm] Failed to list releases: ${error}`,
      });
      return [];
    }
  }

  /**
   * Get values for a release
   */
  async function getValues(releaseName: string, namespace: string): Promise<Record<string, any>> {
    const args: string[] = [
      "get",
      "values",
      releaseName,
      "--namespace",
      namespace,
      "--output",
      "json",
    ];

    try {
      const output = await runHelmCommand(args);
      return JSON.parse(output) || {};
    } catch (error: any) {
      if (error.message?.includes("not found")) {
        throw new BadRequestError(`Release ${releaseName} not found in namespace ${namespace}`);
      }
      throw error;
    }
  }

  /**
   * Run a Helm command and return the output
   */
  async function runHelmCommand(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const env = { ...process.env };
      if (kubeconfig && fs.existsSync(kubeconfig)) {
        env.KUBECONFIG = kubeconfig;
      }

      logger.log({
        level: "debug",
        message: `[Helm] Running: ${helmBinary} ${args.join(" ")}`,
      });

      const proc = spawn(helmBinary, args, {
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          const errorMessage = stderr || stdout || `Helm command failed with code ${code}`;
          logger.log({
            level: "error",
            message: `[Helm] Command failed: ${errorMessage}`,
          });
          reject(new InternalServerError(`Helm error: ${errorMessage}`));
        }
      });

      proc.on("error", (error) => {
        reject(new InternalServerError(`Failed to spawn Helm: ${error.message}`));
      });
    });
  }

  /**
   * Write values to a temporary file
   */
  async function writeValuesFile(values: Record<string, any>): Promise<string> {
    const tmpDir = os.tmpdir();
    const fileName = `helm-values-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.json`;
    const filePath = path.join(tmpDir, fileName);

    fs.writeFileSync(filePath, JSON.stringify(values, null, 2));
    return filePath;
  }

  /**
   * Clean up temporary values file
   */
  function cleanupValuesFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      logger.log({
        level: "warn",
        message: `[Helm] Failed to clean up values file: ${filePath}`,
      });
    }
  }

  return {
    isAvailable,
    getVersion,
    addRepo,
    ensureBitnamiRepo,
    install,
    upgrade,
    uninstall,
    status,
    list,
    getValues,
  };
}
