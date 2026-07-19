import { TApp } from "../resources/app/app.model";
import { TServer } from "../resources/server/server.model";
import { TSecret } from "../resources/secret/secret.model";
import { logger } from "../utils";

// =============================================================================
// Types for Kamal Configuration
// =============================================================================

export type TKamalConfig = {
  service: string;
  image: string;
  servers?: {
    web?: string[];
    [role: string]: string[] | undefined;
  };
  registry?: {
    server?: string;
    username?: string;
    password?: string[];
  };
  env?: {
    clear?: Record<string, string>;
    secret?: string[];
  };
  proxy?: {
    ssl?: boolean;
    host?: string;
    app_port?: number;
    healthcheck?: {
      path?: string;
      interval?: number;
    };
    response_timeout?: number;
    buffering?: {
      requests?: boolean;
      responses?: boolean;
      max_request_body?: number;
      max_response_body?: number;
    };
  };
  ssh?: {
    user?: string;
    port?: number;
    keys?: string[];
    keys_only?: boolean;
  };
  builder?: {
    multiarch?: boolean;
    local?: {
      arch?: string;
    };
    remote?: {
      arch?: string;
      host?: string;
    };
    cache?: {
      type?: string;
      options?: Record<string, string>;
    };
    dockerfile?: string;
    context?: string;
    args?: Record<string, string>;
  };
  deploy?: {
    timeout?: number;
    drain_timeout?: number;
  };
  readiness_delay?: number;
  stop_timeout?: number;
  healthcheck?: {
    cmd?: string;
    interval?: string;
    timeout?: string;
    start_period?: string;
    retries?: number;
  };
  options?: {
    memory?: string;
    cpus?: string;
  };
  labels?: Record<string, string>;
  volumes?: string[];
};

// =============================================================================
// Kamal Config Generator Service
// =============================================================================

export function useKamalGenerator() {
  /**
   * Generate Kamal deploy.yml configuration from app settings
   */
  function generateConfig(
    app: TApp,
    servers: TServer[],
    options: {
      sshKeyPath?: string;
      sshUser?: string;
    } = {}
  ): TKamalConfig {
    const { sshKeyPath, sshUser = "root" } = options;

    // Determine image name
    let imageName: string;
    if (app.source.type === "image" && app.source.image) {
      imageName = app.source.image;
    } else if (app.registry) {
      // For git builds, construct image name from registry
      imageName = `${app.registry.server}/${app.name}`;
    } else {
      // Fallback to app name
      imageName = app.name;
    }

    const config: TKamalConfig = {
      service: app.name,
      image: imageName,
    };

    // ---------------------------------------------------------------------------
    // Servers
    // ---------------------------------------------------------------------------
    if (servers.length > 0) {
      config.servers = {
        web: servers.map(s => s.host),
      };
    }

    // ---------------------------------------------------------------------------
    // Registry (only if building or if registry credentials provided)
    // ---------------------------------------------------------------------------
    if (app.registry) {
      config.registry = {
        server: app.registry.server,
        username: app.registry.username,
        password: ["KAMAL_REGISTRY_PASSWORD"],
      };
    }

    // ---------------------------------------------------------------------------
    // Environment Variables
    // ---------------------------------------------------------------------------
    const hasEnv = Object.keys(app.env).length > 0;
    const hasSecrets = app.secretNames.length > 0;

    if (hasEnv || hasSecrets) {
      config.env = {};
      
      if (hasEnv) {
        config.env.clear = app.env;
      }
      
      if (hasSecrets) {
        config.env.secret = app.secretNames;
      }
    }

    // ---------------------------------------------------------------------------
    // Proxy Configuration (kamal-proxy)
    // ---------------------------------------------------------------------------
    if (app.proxy) {
      config.proxy = {
        ssl: app.proxy.ssl,
        host: app.proxy.host,
        app_port: app.proxy.appPort,
      };

      if (app.proxy.healthcheckPath) {
        config.proxy.healthcheck = {
          path: app.proxy.healthcheckPath,
          interval: app.proxy.healthcheckInterval || 3,
        };
      }

      if (app.proxy.responseTimeout) {
        config.proxy.response_timeout = app.proxy.responseTimeout;
      }

      if (app.proxy.buffering) {
        config.proxy.buffering = {
          requests: app.proxy.buffering.requests,
          responses: app.proxy.buffering.responses,
        };
        if (app.proxy.buffering.maxRequestBody) {
          config.proxy.buffering.max_request_body = app.proxy.buffering.maxRequestBody;
        }
        if (app.proxy.buffering.maxResponseBody) {
          config.proxy.buffering.max_response_body = app.proxy.buffering.maxResponseBody;
        }
      }
    }

    // ---------------------------------------------------------------------------
    // SSH Configuration
    // ---------------------------------------------------------------------------
    config.ssh = {
      user: sshUser,
    };

    if (sshKeyPath) {
      config.ssh.keys = [sshKeyPath];
      config.ssh.keys_only = true;
    }

    // Use SSH port from first server (assumes all servers use same port)
    if (servers.length > 0 && servers[0].sshPort !== 22) {
      config.ssh.port = servers[0].sshPort;
    }

    // ---------------------------------------------------------------------------
    // Builder Configuration (for git-based builds)
    // ---------------------------------------------------------------------------
    if (app.source.type === "git") {
      config.builder = {
        multiarch: false,
        local: {
          arch: "amd64",
        },
      };

      if (app.source.dockerfile && app.source.dockerfile !== "Dockerfile") {
        config.builder.dockerfile = app.source.dockerfile;
      }

      if (app.source.buildContext && app.source.buildContext !== ".") {
        config.builder.context = app.source.buildContext;
      }

      if (app.source.buildArgs && Object.keys(app.source.buildArgs).length > 0) {
        config.builder.args = app.source.buildArgs;
      }
    }

    // ---------------------------------------------------------------------------
    // Deploy Options
    // ---------------------------------------------------------------------------
    if (app.deploy) {
      if (app.deploy.timeout || app.deploy.drainTimeout) {
        config.deploy = {};
        if (app.deploy.timeout) {
          config.deploy.timeout = app.deploy.timeout;
        }
        if (app.deploy.drainTimeout) {
          config.deploy.drain_timeout = app.deploy.drainTimeout;
        }
      }

      if (app.deploy.readinessDelay) {
        config.readiness_delay = app.deploy.readinessDelay;
      }

      if (app.deploy.stopTimeout) {
        config.stop_timeout = app.deploy.stopTimeout;
      }
    }

    // ---------------------------------------------------------------------------
    // Health Check (Docker health check, separate from proxy health check)
    // ---------------------------------------------------------------------------
    if (app.healthCheck) {
      const port = app.healthCheck.port || app.proxy?.appPort || 3000;
      config.healthcheck = {
        cmd: `curl -f http://localhost:${port}${app.healthCheck.path} || exit 1`,
        interval: `${app.healthCheck.interval || 30}s`,
        timeout: `${app.healthCheck.timeout || 5}s`,
        start_period: `${app.healthCheck.startPeriod || 0}s`,
        retries: app.healthCheck.retries || 3,
      };
    }

    // ---------------------------------------------------------------------------
    // Resource Limits
    // ---------------------------------------------------------------------------
    if (app.resources) {
      config.options = {};
      if (app.resources.memory) {
        config.options.memory = app.resources.memory;
      }
      if (app.resources.cpus) {
        config.options.cpus = app.resources.cpus.toString();
      }
    }

    // ---------------------------------------------------------------------------
    // Labels
    // ---------------------------------------------------------------------------
    if (app.labels && Object.keys(app.labels).length > 0) {
      config.labels = app.labels;
    }

    // ---------------------------------------------------------------------------
    // Volumes
    // ---------------------------------------------------------------------------
    if (app.volumes && app.volumes.length > 0) {
      config.volumes = app.volumes.map(v => {
        let volume = `${v.host}:${v.container}`;
        if (v.readonly) {
          volume += ":ro";
        }
        return volume;
      });
    }

    return config;
  }

  /**
   * Convert config object to YAML string
   */
  function toYaml(config: TKamalConfig): string {
    // Simple YAML serialization (avoiding external dependency)
    return serializeToYaml(config, 0);
  }

  /**
   * Generate secrets file content (.kamal/secrets or .env)
   */
  function generateSecretsFile(
    app: TApp,
    secrets: Map<string, string>
  ): string {
    const lines: string[] = [];

    // Add registry password if configured
    if (app.registry?.password) {
      lines.push(`KAMAL_REGISTRY_PASSWORD=${app.registry.password}`);
    }

    // Add app secrets
    for (const [name, value] of secrets) {
      // Escape special characters in values
      const escapedValue = value.includes(" ") || value.includes("=") || value.includes("\n")
        ? `"${value.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
        : value;
      lines.push(`${name}=${escapedValue}`);
    }

    return lines.join("\n");
  }

  /**
   * Generate the full directory structure for Kamal deployment
   */
  function generateDeploymentFiles(
    app: TApp,
    servers: TServer[],
    secrets: Map<string, string>,
    options: {
      sshKeyPath?: string;
      sshUser?: string;
    } = {}
  ): { configYaml: string; secretsEnv: string } {
    const config = generateConfig(app, servers, options);
    const configYaml = toYaml(config);
    const secretsEnv = generateSecretsFile(app, secrets);

    logger.log({
      level: "debug",
      message: `Generated Kamal config for ${app.name}:\n${configYaml}`,
    });

    return { configYaml, secretsEnv };
  }

  return {
    generateConfig,
    toYaml,
    generateSecretsFile,
    generateDeploymentFiles,
  };
}

// =============================================================================
// YAML Serialization Helper
// =============================================================================

function serializeToYaml(obj: any, indent: number): string {
  const spaces = "  ".repeat(indent);
  const lines: string[] = [];

  if (obj === null || obj === undefined) {
    return "~";
  }

  if (typeof obj === "string") {
    // Check if needs quoting
    if (
      obj.includes(":") ||
      obj.includes("#") ||
      obj.includes("'") ||
      obj.includes('"') ||
      obj.includes("\n") ||
      obj.startsWith(" ") ||
      obj.endsWith(" ") ||
      obj === "" ||
      obj === "true" ||
      obj === "false" ||
      !isNaN(Number(obj))
    ) {
      return `"${obj.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
    }
    return obj;
  }

  if (typeof obj === "number" || typeof obj === "boolean") {
    return String(obj);
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) {
      return "[]";
    }
    
    // Check if array of primitives
    if (obj.every(item => typeof item !== "object" || item === null)) {
      return obj.map(item => `\n${spaces}- ${serializeToYaml(item, indent)}`).join("");
    }
    
    // Array of objects
    return obj.map(item => {
      if (typeof item === "object" && item !== null) {
        const nested = serializeToYaml(item, indent + 1);
        const firstLine = nested.split("\n")[0];
        const rest = nested.split("\n").slice(1).join("\n");
        return `\n${spaces}- ${firstLine}${rest ? "\n" + rest : ""}`;
      }
      return `\n${spaces}- ${serializeToYaml(item, indent)}`;
    }).join("");
  }

  if (typeof obj === "object") {
    const entries = Object.entries(obj).filter(([_, v]) => v !== undefined);
    
    if (entries.length === 0) {
      return "{}";
    }

    for (const [key, value] of entries) {
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        const nested = serializeToYaml(value, indent + 1);
        if (nested.startsWith("\n")) {
          lines.push(`${spaces}${key}:${nested}`);
        } else {
          lines.push(`${spaces}${key}:\n${nested.split("\n").map(l => spaces + "  " + l.trim()).join("\n")}`);
        }
      } else if (Array.isArray(value)) {
        const serialized = serializeToYaml(value, indent + 1);
        lines.push(`${spaces}${key}:${serialized}`);
      } else {
        lines.push(`${spaces}${key}: ${serializeToYaml(value, indent)}`);
      }
    }

    return lines.join("\n");
  }

  return String(obj);
}
