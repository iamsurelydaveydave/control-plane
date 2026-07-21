import * as fs from "fs";
import * as https from "https";
import * as http from "http";
import YAML from "yaml";
import { logger } from "../utils";

export type TK8sConfig = {
  server: string;
  caCert?: string;
  clientCert?: string;
  clientKey?: string;
  token?: string;
};

export type TK8sResource = {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec?: Record<string, any>;
  status?: Record<string, any>;
};

export type TK8sListResponse<T> = {
  apiVersion: string;
  kind: string;
  items: T[];
};

/**
 * Lightweight Kubernetes client for the Control Plane.
 * Uses the K3s kubeconfig or explicit config.
 */
export function useK8sService() {
  let config: TK8sConfig | null = null;

  /**
   * Load kubeconfig from file (K3s default: /etc/rancher/k3s/k3s.yaml)
   */
  function loadKubeconfig(kubeconfigPath?: string): TK8sConfig {
    const path = kubeconfigPath || process.env.K8S_KUBECONFIG || "/etc/rancher/k3s/k3s.yaml";

    if (!fs.existsSync(path)) {
      throw new Error(`Kubeconfig not found: ${path}`);
    }

    const content = fs.readFileSync(path, "utf-8");
    const kubeconfig = YAML.parse(content);

    const cluster = kubeconfig.clusters?.[0]?.cluster;
    const user = kubeconfig.users?.[0]?.user;

    if (!cluster?.server) {
      throw new Error("Invalid kubeconfig: missing cluster server");
    }

    const k8sConfig: TK8sConfig = {
      server: cluster.server,
    };

    // CA certificate
    if (cluster["certificate-authority-data"]) {
      k8sConfig.caCert = Buffer.from(cluster["certificate-authority-data"], "base64").toString("utf-8");
    } else if (cluster["certificate-authority"]) {
      k8sConfig.caCert = fs.readFileSync(cluster["certificate-authority"], "utf-8");
    }

    // Client certificate auth
    if (user?.["client-certificate-data"]) {
      k8sConfig.clientCert = Buffer.from(user["client-certificate-data"], "base64").toString("utf-8");
    }
    if (user?.["client-key-data"]) {
      k8sConfig.clientKey = Buffer.from(user["client-key-data"], "base64").toString("utf-8");
    }

    // Token auth
    if (user?.token) {
      k8sConfig.token = user.token;
    }

    config = k8sConfig;
    return k8sConfig;
  }

  /**
   * Make a request to the Kubernetes API
   */
  async function request<T = any>(
    method: string,
    path: string,
    body?: any
  ): Promise<T> {
    if (!config) {
      loadKubeconfig();
    }

    const url = new URL(path, config!.server);
    const isHttps = url.protocol === "https:";

    const options: https.RequestOptions = {
      method,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    };

    // Auth
    if (config!.token) {
      (options.headers as Record<string, string>)["Authorization"] = `Bearer ${config!.token}`;
    }

    // TLS
    if (isHttps) {
      if (config!.caCert) {
        options.ca = config!.caCert;
      }
      if (config!.clientCert && config!.clientKey) {
        options.cert = config!.clientCert;
        options.key = config!.clientKey;
      }
      // K3s uses self-signed certs by default
      options.rejectUnauthorized = !!config!.caCert;
    }

    return new Promise((resolve, reject) => {
      const protocol = isHttps ? https : http;
      const req = protocol.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = data ? JSON.parse(data) : {};

            if (res.statusCode && res.statusCode >= 400) {
              const error = new Error(
                parsed.message || `K8s API error: ${res.statusCode}`
              ) as any;
              error.statusCode = res.statusCode;
              error.body = parsed;
              reject(error);
            } else {
              resolve(parsed);
            }
          } catch (e) {
            reject(new Error(`Failed to parse K8s response: ${data}`));
          }
        });
      });

      req.on("error", reject);

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  /**
   * Apply a resource (create or update)
   */
  async function apply(resource: TK8sResource): Promise<TK8sResource> {
    const { apiVersion, kind, metadata } = resource;
    const namespace = metadata.namespace || "default";
    const name = metadata.name;

    // Build API path
    const apiPath = getApiPath(apiVersion, kind, namespace);

    try {
      // Try to get existing resource
      await request("GET", `${apiPath}/${name}`);
      // Exists - update it
      logger.log({ level: "info", message: `[K8s] Updating ${kind}/${name} in ${namespace}` });
      return await request("PUT", `${apiPath}/${name}`, resource);
    } catch (err: any) {
      if (err.statusCode === 404) {
        // Doesn't exist - create it
        logger.log({ level: "info", message: `[K8s] Creating ${kind}/${name} in ${namespace}` });
        return await request("POST", apiPath, resource);
      }
      throw err;
    }
  }

  /**
   * Get a resource
   */
  async function get<T extends TK8sResource>(
    apiVersion: string,
    kind: string,
    name: string,
    namespace: string = "default"
  ): Promise<T | null> {
    const apiPath = getApiPath(apiVersion, kind, namespace);
    try {
      return await request<T>("GET", `${apiPath}/${name}`);
    } catch (err: any) {
      if (err.statusCode === 404) return null;
      throw err;
    }
  }

  /**
   * List resources
   */
  async function list<T extends TK8sResource>(
    apiVersion: string,
    kind: string,
    namespace: string = "default",
    labelSelector?: string
  ): Promise<T[]> {
    const apiPath = getApiPath(apiVersion, kind, namespace);
    const query = labelSelector ? `?labelSelector=${encodeURIComponent(labelSelector)}` : "";
    const response = await request<TK8sListResponse<T>>("GET", `${apiPath}${query}`);
    return response.items || [];
  }

  /**
   * Delete a resource
   */
  async function remove(
    apiVersion: string,
    kind: string,
    name: string,
    namespace: string = "default"
  ): Promise<void> {
    const apiPath = getApiPath(apiVersion, kind, namespace);
    logger.log({ level: "info", message: `[K8s] Deleting ${kind}/${name} in ${namespace}` });
    await request("DELETE", `${apiPath}/${name}`);
  }

  /**
   * Watch a resource for changes
   */
  async function watch(
    apiVersion: string,
    kind: string,
    name: string,
    namespace: string = "default",
    callback: (resource: TK8sResource) => void,
    timeoutMs: number = 300000
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const resource = await get(apiVersion, kind, name, namespace);
      if (resource) {
        callback(resource);
      }
      await new Promise((r) => setTimeout(r, 5000)); // Poll every 5s
    }
  }

  /**
   * Wait for a resource to reach a specific condition
   */
  async function waitForCondition(
    apiVersion: string,
    kind: string,
    name: string,
    namespace: string,
    conditionFn: (resource: TK8sResource) => boolean,
    timeoutMs: number = 600000
  ): Promise<TK8sResource> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const resource = await get(apiVersion, kind, name, namespace);
      if (resource && conditionFn(resource)) {
        return resource;
      }
      await new Promise((r) => setTimeout(r, 5000));
    }

    throw new Error(`Timeout waiting for ${kind}/${name} condition after ${timeoutMs}ms`);
  }

  /**
   * Get nodes in the cluster
   */
  async function getNodes(): Promise<TK8sResource[]> {
    return list("v1", "Node", "");
  }

  /**
   * Check if K8s is available
   */
  async function isAvailable(): Promise<boolean> {
    try {
      await request("GET", "/api/v1/namespaces/default");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a secret
   */
  async function createSecret(
    name: string,
    namespace: string,
    data: Record<string, string>,
    labels?: Record<string, string>
  ): Promise<TK8sResource> {
    // Base64 encode all values
    const encodedData: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      encodedData[key] = Buffer.from(value).toString("base64");
    }

    const secret: TK8sResource = {
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name,
        namespace,
        labels,
      },
      spec: {
        type: "Opaque",
        data: encodedData,
      } as any,
    };

    // Secrets have data at root level, not in spec
    (secret as any).data = encodedData;
    delete secret.spec;

    return apply(secret);
  }

  /**
   * Make a raw text request (for logs)
   */
  async function requestRaw(method: string, path: string): Promise<string> {
    if (!config) {
      loadKubeconfig();
    }

    const url = new URL(path, config!.server);
    const isHttps = url.protocol === "https:";

    const options: https.RequestOptions = {
      method,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      headers: {
        Accept: "text/plain",
      },
    };

    // Auth
    if (config!.token) {
      (options.headers as Record<string, string>)["Authorization"] = `Bearer ${config!.token}`;
    }

    // TLS
    if (isHttps) {
      if (config!.caCert) {
        options.ca = config!.caCert;
      }
      if (config!.clientCert && config!.clientKey) {
        options.cert = config!.clientCert;
        options.key = config!.clientKey;
      }
      // K3s uses self-signed certs by default
      options.rejectUnauthorized = !!config!.caCert;
    }

    return new Promise((resolve, reject) => {
      const protocol = isHttps ? https : http;
      const req = protocol.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            const error = new Error(
              `K8s API error: ${res.statusCode} - ${data}`
            ) as any;
            error.statusCode = res.statusCode;
            reject(error);
          } else {
            resolve(data);
          }
        });
      });

      req.on("error", reject);
      req.end();
    });
  }

  /**
   * Get pod logs
   */
  async function getPodLogs(
    name: string,
    namespace: string,
    options: {
      container?: string;
      tailLines?: number;
      sinceSeconds?: number;
    } = {}
  ): Promise<string> {
    if (!config) {
      loadKubeconfig();
    }

    let query = "?";
    if (options.container) query += `container=${options.container}&`;
    if (options.tailLines) query += `tailLines=${options.tailLines}&`;
    if (options.sinceSeconds) query += `sinceSeconds=${options.sinceSeconds}&`;

    const path = `/api/v1/namespaces/${namespace}/pods/${name}/log${query}`;

    // Logs are returned as plain text, not JSON
    return requestRaw("GET", path);
  }

  /**
   * Get events for a resource
   */
  async function getEvents(
    namespace: string,
    fieldSelector?: string
  ): Promise<TK8sResource[]> {
    let query = "";
    if (fieldSelector) {
      query = `?fieldSelector=${encodeURIComponent(fieldSelector)}`;
    }

    const response = await request<TK8sListResponse<TK8sResource>>(
      "GET",
      `/api/v1/namespaces/${namespace}/events${query}`
    );
    return response.items || [];
  }

  return {
    loadKubeconfig,
    request,
    requestRaw,
    apply,
    get,
    list,
    remove,
    watch,
    waitForCondition,
    getNodes,
    isAvailable,
    createSecret,
    getPodLogs,
    getEvents,
  };
}

/**
 * Build the API path for a resource
 */
function getApiPath(apiVersion: string, kind: string, namespace?: string): string {
  // Core API (v1)
  if (apiVersion === "v1") {
    const resource = kindToResource(kind);
    if (namespace && resource !== "nodes" && resource !== "namespaces") {
      return `/api/v1/namespaces/${namespace}/${resource}`;
    }
    return `/api/v1/${resource}`;
  }

  // Custom resources or extensions
  const [group, version] = apiVersion.includes("/")
    ? apiVersion.split("/")
    : ["", apiVersion];

  const resource = kindToResource(kind);

  if (namespace) {
    return `/apis/${apiVersion}/namespaces/${namespace}/${resource}`;
  }
  return `/apis/${apiVersion}/${resource}`;
}

/**
 * Convert Kind to resource name (lowercase plural)
 */
function kindToResource(kind: string): string {
  const kindMap: Record<string, string> = {
    // Core
    Pod: "pods",
    Service: "services",
    Secret: "secrets",
    ConfigMap: "configmaps",
    Namespace: "namespaces",
    Node: "nodes",
    PersistentVolumeClaim: "persistentvolumeclaims",
    // Percona
    PerconaServerMongoDB: "perconaservermongodbs",
  };

  return kindMap[kind] || kind.toLowerCase() + "s";
}
