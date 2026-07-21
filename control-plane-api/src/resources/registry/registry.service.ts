import { ObjectId } from "mongodb";
import { useRegistryRepo } from "./registry.repository";
import { TRegistry, TRegistryType } from "./registry.model";
import { useK8sService } from "../../services/k8s.service";
import { logger, BadRequestError, NotFoundError, InternalServerError } from "../../utils";

// =============================================================================
// Types
// =============================================================================

export type TImageTag = {
  name: string;
  digest: string;
  createdAt: Date;
  size: number;
};

export type TRegistryCreate = {
  name: string;
  type: TRegistryType;
  url: string;
  credentials: {
    username?: string;
    password?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    serviceAccountKey?: string;
  };
  namespaces?: string[];
  organizationId?: string;
};

// =============================================================================
// Service
// =============================================================================

export function useRegistryService() {
  const repo = useRegistryRepo();
  const k8s = useK8sService();

  // ---------------------------------------------------------------------------
  // Registry Management
  // ---------------------------------------------------------------------------

  /**
   * Create a new registry
   */
  async function create(data: TRegistryCreate): Promise<string> {
    // Check for duplicate name
    const existing = await repo.getByName(data.name, data.organizationId);
    if (existing) {
      throw new BadRequestError(`Registry "${data.name}" already exists`);
    }

    // Convert the data for the repository (it expects Partial<TRegistry>)
    const registryData: Partial<TRegistry> = {
      name: data.name,
      type: data.type,
      url: data.url,
      credentials: data.credentials,
      namespaces: data.namespaces,
    };

    // Handle organizationId separately since it needs ObjectId conversion
    if (data.organizationId) {
      try {
        registryData.organizationId = new ObjectId(data.organizationId);
      } catch {
        throw new BadRequestError("Invalid organizationId format.");
      }
    }

    const registryId = await repo.add(registryData);

    // Verify credentials asynchronously
    verifyCredentials(registryId).catch((err) => {
      logger.log({
        level: "warn",
        message: `Initial credential verification failed for registry ${registryId}: ${err.message}`,
      });
    });

    return registryId;
  }

  /**
   * Verify registry credentials by attempting to authenticate
   */
  async function verifyCredentials(registryId: string): Promise<boolean> {
    const registry = await repo.getById(registryId);
    if (!registry) {
      throw new NotFoundError("Registry not found");
    }

    try {
      const isValid = await testRegistryConnection(registry);

      if (isValid) {
        await repo.updateStatus(registryId, "active");
        logger.log({
          level: "info",
          message: `Registry credentials verified: ${registry.name}`,
        });
        return true;
      } else {
        await repo.updateStatus(
          registryId,
          "error",
          "Authentication failed"
        );
        return false;
      }
    } catch (error: any) {
      await repo.updateStatus(
        registryId,
        "error",
        error.message || "Verification failed"
      );
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // K8s Integration
  // ---------------------------------------------------------------------------

  /**
   * Create a K8s imagePullSecret for a registry in a namespace
   */
  async function createPullSecret(
    registryId: string,
    namespace: string
  ): Promise<string> {
    const registry = await repo.getById(registryId);
    if (!registry) {
      throw new NotFoundError("Registry not found");
    }

    if (registry.status !== "active") {
      throw new BadRequestError(
        "Registry must be verified before creating pull secrets"
      );
    }

    const secretName = registry.pullSecretName || `registry-${registryId}`;

    // Build dockerconfigjson
    const dockerConfig = buildDockerConfigJson(registry);

    // Create the K8s secret
    try {
      await k8s.apply({
        apiVersion: "v1",
        kind: "Secret",
        metadata: {
          name: secretName,
          namespace,
          labels: {
            "app.kubernetes.io/managed-by": "control-plane",
            "control-plane.io/registry": registryId,
          },
        },
        spec: {
          type: "kubernetes.io/dockerconfigjson",
          data: {
            ".dockerconfigjson": Buffer.from(
              JSON.stringify(dockerConfig)
            ).toString("base64"),
          },
        } as any,
      });

      // Update namespaces list in registry
      const namespaces = new Set(registry.namespaces || []);
      namespaces.add(namespace);
      await repo.updateNamespaces(registryId, Array.from(namespaces));

      logger.log({
        level: "info",
        message: `Pull secret created: ${secretName} in namespace ${namespace}`,
      });

      return secretName;
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `Failed to create pull secret: ${error.message}`,
      });
      throw new InternalServerError(
        `Failed to create pull secret: ${error.message}`
      );
    }
  }

  /**
   * Delete a K8s imagePullSecret from a namespace
   */
  async function deletePullSecret(
    registryId: string,
    namespace: string
  ): Promise<void> {
    const registry = await repo.getById(registryId);
    if (!registry) {
      throw new NotFoundError("Registry not found");
    }

    const secretName = registry.pullSecretName || `registry-${registryId}`;

    try {
      await k8s.remove("v1", "Secret", secretName, namespace);

      // Update namespaces list
      const namespaces = new Set(registry.namespaces || []);
      namespaces.delete(namespace);
      await repo.updateNamespaces(registryId, Array.from(namespaces));

      logger.log({
        level: "info",
        message: `Pull secret deleted: ${secretName} from namespace ${namespace}`,
      });
    } catch (error: any) {
      if (error.statusCode !== 404) {
        throw new InternalServerError(
          `Failed to delete pull secret: ${error.message}`
        );
      }
      // Secret doesn't exist, just update the namespaces list
      const namespaces = new Set(registry.namespaces || []);
      namespaces.delete(namespace);
      await repo.updateNamespaces(registryId, Array.from(namespaces));
    }
  }

  /**
   * Sync pull secrets to all configured namespaces
   */
  async function syncPullSecrets(registryId: string): Promise<void> {
    const registry = await repo.getById(registryId);
    if (!registry) {
      throw new NotFoundError("Registry not found");
    }

    if (registry.status !== "active") {
      throw new BadRequestError(
        "Registry must be verified before syncing pull secrets"
      );
    }

    const namespaces = registry.namespaces || [];
    if (namespaces.length === 0) {
      logger.log({
        level: "info",
        message: `No namespaces configured for registry ${registry.name}`,
      });
      return;
    }

    const secretName = registry.pullSecretName || `registry-${registryId}`;
    const dockerConfig = buildDockerConfigJson(registry);

    const errors: string[] = [];

    for (const namespace of namespaces) {
      try {
        await k8s.apply({
          apiVersion: "v1",
          kind: "Secret",
          metadata: {
            name: secretName,
            namespace,
            labels: {
              "app.kubernetes.io/managed-by": "control-plane",
              "control-plane.io/registry": registryId,
            },
          },
          spec: {
            type: "kubernetes.io/dockerconfigjson",
            data: {
              ".dockerconfigjson": Buffer.from(
                JSON.stringify(dockerConfig)
              ).toString("base64"),
            },
          } as any,
        });

        logger.log({
          level: "info",
          message: `Pull secret synced: ${secretName} in namespace ${namespace}`,
        });
      } catch (error: any) {
        errors.push(`${namespace}: ${error.message}`);
      }
    }

    if (errors.length > 0) {
      throw new InternalServerError(
        `Failed to sync some namespaces: ${errors.join(", ")}`
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Image Operations
  // ---------------------------------------------------------------------------

  /**
   * List repositories in the registry
   */
  async function listRepositories(registryId: string): Promise<string[]> {
    const registry = await repo.getById(registryId);
    if (!registry) {
      throw new NotFoundError("Registry not found");
    }

    try {
      const response = await makeRegistryApiRequest(
        registry,
        "GET",
        "/v2/_catalog"
      );
      return response.repositories || [];
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `Failed to list repositories: ${error.message}`,
      });
      throw new BadRequestError(
        `Failed to list repositories: ${error.message}`
      );
    }
  }

  /**
   * List tags for a repository
   */
  async function listTags(
    registryId: string,
    repository: string
  ): Promise<TImageTag[]> {
    const registry = await repo.getById(registryId);
    if (!registry) {
      throw new NotFoundError("Registry not found");
    }

    try {
      // Get list of tags
      const tagsResponse = await makeRegistryApiRequest(
        registry,
        "GET",
        `/v2/${repository}/tags/list`
      );

      const tags: TImageTag[] = [];

      // Get manifest info for each tag
      for (const tagName of tagsResponse.tags || []) {
        try {
          const manifest = await makeRegistryApiRequest(
            registry,
            "GET",
            `/v2/${repository}/manifests/${tagName}`,
            {
              Accept:
                "application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json",
            }
          );

          tags.push({
            name: tagName,
            digest: manifest.config?.digest || "",
            createdAt: new Date(), // Would need to fetch config blob for actual date
            size: calculateManifestSize(manifest),
          });
        } catch {
          // If we can't get manifest details, just add the tag name
          tags.push({
            name: tagName,
            digest: "",
            createdAt: new Date(),
            size: 0,
          });
        }
      }

      return tags;
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `Failed to list tags: ${error.message}`,
      });
      throw new BadRequestError(`Failed to list tags: ${error.message}`);
    }
  }

  /**
   * Delete a tag from a repository
   */
  async function deleteTag(
    registryId: string,
    repository: string,
    tag: string
  ): Promise<void> {
    const registry = await repo.getById(registryId);
    if (!registry) {
      throw new NotFoundError("Registry not found");
    }

    try {
      // First, get the manifest digest
      const manifest = await makeRegistryApiRequest(
        registry,
        "GET",
        `/v2/${repository}/manifests/${tag}`,
        {
          Accept:
            "application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json",
        },
        true // Return headers
      );

      const digest = manifest.headers?.["docker-content-digest"];
      if (!digest) {
        throw new Error("Could not get manifest digest");
      }

      // Delete by digest
      await makeRegistryApiRequest(
        registry,
        "DELETE",
        `/v2/${repository}/manifests/${digest}`
      );

      logger.log({
        level: "info",
        message: `Deleted tag ${tag} from ${repository} in registry ${registry.name}`,
      });
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `Failed to delete tag: ${error.message}`,
      });
      throw new BadRequestError(`Failed to delete tag: ${error.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Helper Functions
  // ---------------------------------------------------------------------------

  /**
   * Build dockerconfigjson for K8s imagePullSecret
   */
  function buildDockerConfigJson(registry: TRegistry): object {
    const { url, credentials, type } = registry;

    let username = credentials.username || "";
    let password = credentials.password || "";

    // Handle special auth for different registry types
    if (type === "ecr" && credentials.accessKeyId && credentials.secretAccessKey) {
      // ECR uses AWS credentials
      username = credentials.accessKeyId;
      password = credentials.secretAccessKey;
    } else if (type === "gcr" && credentials.serviceAccountKey) {
      // GCR uses _json_key as username and the service account JSON as password
      username = "_json_key";
      password = credentials.serviceAccountKey;
    }

    const auth = Buffer.from(`${username}:${password}`).toString("base64");

    return {
      auths: {
        [url]: {
          username,
          password,
          auth,
        },
      },
    };
  }

  /**
   * Test connection to the registry
   */
  async function testRegistryConnection(registry: TRegistry): Promise<boolean> {
    try {
      // Try to hit the v2 API endpoint
      await makeRegistryApiRequest(registry, "GET", "/v2/");
      return true;
    } catch (error: any) {
      // 401 with proper WWW-Authenticate header means the registry is reachable
      // but we need to authenticate (which we'll do in the actual request)
      if (error.statusCode === 401) {
        // Try with auth
        try {
          await makeRegistryApiRequest(registry, "GET", "/v2/", {}, false, true);
          return true;
        } catch (authError: any) {
          logger.log({
            level: "warn",
            message: `Registry auth failed: ${authError.message}`,
          });
          return false;
        }
      }
      logger.log({
        level: "warn",
        message: `Registry connection failed: ${error.message}`,
      });
      return false;
    }
  }

  /**
   * Make an authenticated request to the registry API
   */
  async function makeRegistryApiRequest(
    registry: TRegistry,
    method: string,
    path: string,
    headers: Record<string, string> = {},
    returnHeaders = false,
    useAuth = true
  ): Promise<any> {
    const https = await import("https");
    const http = await import("http");

    const url = new URL(path, `https://${registry.url}`);
    const isHttps = url.protocol === "https:";

    const requestHeaders: Record<string, string> = {
      Accept: "application/json",
      ...headers,
    };

    // Add authentication
    if (useAuth && registry.credentials.username && registry.credentials.password) {
      const auth = Buffer.from(
        `${registry.credentials.username}:${registry.credentials.password}`
      ).toString("base64");
      requestHeaders["Authorization"] = `Basic ${auth}`;
    }

    const options = {
      method,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      headers: requestHeaders,
      rejectUnauthorized: false, // Allow self-signed certs for private registries
    };

    return new Promise((resolve, reject) => {
      const protocol = isHttps ? https : http;
      const req = protocol.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            const error = new Error(
              `Registry API error: ${res.statusCode}`
            ) as any;
            error.statusCode = res.statusCode;
            reject(error);
          } else {
            try {
              const parsed = data ? JSON.parse(data) : {};
              if (returnHeaders) {
                resolve({ ...parsed, headers: res.headers });
              } else {
                resolve(parsed);
              }
            } catch {
              // Some endpoints don't return JSON
              if (returnHeaders) {
                resolve({ headers: res.headers });
              } else {
                resolve({});
              }
            }
          }
        });
      });

      req.on("error", reject);
      req.end();
    });
  }

  /**
   * Calculate total size from manifest layers
   */
  function calculateManifestSize(manifest: any): number {
    let size = 0;
    if (manifest.layers) {
      for (const layer of manifest.layers) {
        size += layer.size || 0;
      }
    }
    if (manifest.config?.size) {
      size += manifest.config.size;
    }
    return size;
  }

  return {
    // Registry management
    create,
    verifyCredentials,

    // K8s integration
    createPullSecret,
    deletePullSecret,
    syncPullSecrets,

    // Image operations
    listRepositories,
    listTags,
    deleteTag,
  };
}
