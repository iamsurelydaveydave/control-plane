import * as k8s from "@kubernetes/client-node";
import { logger } from "../utils";
import { InternalServerError } from "../utils/error";

/**
 * KubernetesService - Core K8s client wrapper using @kubernetes/client-node
 *
 * Provides typed access to K8s API for:
 * - Nodes (list, get, cordon, uncordon, drain)
 * - Namespaces (create, delete)
 * - Deployments (create, update, scale, restart)
 * - Services (create, update, delete)
 * - Ingresses (create, update, delete)
 * - Secrets (create, update, delete)
 * - Pods (list, logs, exec, delete)
 * - Custom Resources (for MongoDB operator)
 */
export function useKubernetesService() {
  let kc: k8s.KubeConfig | null = null;
  let coreApi: k8s.CoreV1Api | null = null;
  let appsApi: k8s.AppsV1Api | null = null;
  let networkingApi: k8s.NetworkingV1Api | null = null;
  let customObjectsApi: k8s.CustomObjectsApi | null = null;

  /**
   * Initialize the Kubernetes client.
   * In-cluster: uses service account
   * Outside cluster: uses kubeconfig file
   */
  function init(): void {
    if (kc) return; // Already initialized

    kc = new k8s.KubeConfig();

    // Try in-cluster config first (running inside K8s)
    try {
      kc.loadFromCluster();
      logger.log({ level: "info", message: "[K8s] Loaded in-cluster config" });
    } catch {
      // Fall back to kubeconfig file
      const kubeconfigPath = process.env.KUBECONFIG || `${process.env.HOME}/.kube/config`;
      try {
        kc.loadFromFile(kubeconfigPath);
        logger.log({ level: "info", message: `[K8s] Loaded kubeconfig from ${kubeconfigPath}` });
      } catch (err) {
        // Try default k3s location
        try {
          kc.loadFromFile("/etc/rancher/k3s/k3s.yaml");
          logger.log({ level: "info", message: "[K8s] Loaded kubeconfig from /etc/rancher/k3s/k3s.yaml" });
        } catch {
          throw new InternalServerError(`Failed to load kubeconfig: ${err}`);
        }
      }
    }

    // Initialize API clients
    coreApi = kc.makeApiClient(k8s.CoreV1Api);
    appsApi = kc.makeApiClient(k8s.AppsV1Api);
    networkingApi = kc.makeApiClient(k8s.NetworkingV1Api);
    customObjectsApi = kc.makeApiClient(k8s.CustomObjectsApi);
  }

  /**
   * Ensure client is initialized before making API calls
   */
  function ensureInit(): void {
    if (!kc) init();
  }

  /**
   * Get the KubeConfig object (useful for extracting cluster info).
   * Returns null if not initialized.
   */
  function getKubeConfig(): k8s.KubeConfig | null {
    ensureInit();
    return kc;
  }

  // ===========================================================================
  // Health / Connection
  // ===========================================================================

  /**
   * Check if K8s cluster is reachable
   */
  async function isAvailable(): Promise<boolean> {
    ensureInit();
    try {
      await coreApi!.listNamespace();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get cluster info
   */
  async function getClusterInfo(): Promise<{
    version: string;
    platform: string;
  }> {
    ensureInit();
    const versionApi = kc!.makeApiClient(k8s.VersionApi);
    const response = await versionApi.getCode();
    return {
      version: response.body.gitVersion,
      platform: response.body.platform,
    };
  }

  // ===========================================================================
  // Namespaces
  // ===========================================================================

  /**
   * Create a namespace
   */
  async function createNamespace(name: string, labels?: Record<string, string>): Promise<void> {
    ensureInit();
    const namespace: k8s.V1Namespace = {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: {
        name,
        labels: {
          "app.kubernetes.io/managed-by": "controlplane",
          ...labels,
        },
      },
    };

    try {
      await coreApi!.createNamespace(namespace);
      logger.log({ level: "info", message: `[K8s] Created namespace: ${name}` });
    } catch (err: any) {
      if (err.response?.statusCode === 409) {
        logger.log({ level: "debug", message: `[K8s] Namespace already exists: ${name}` });
        return;
      }
      throw err;
    }
  }

  /**
   * Delete a namespace
   */
  async function deleteNamespace(name: string): Promise<void> {
    ensureInit();
    try {
      await coreApi!.deleteNamespace(name);
      logger.log({ level: "info", message: `[K8s] Deleted namespace: ${name}` });
    } catch (err: any) {
      if (err.response?.statusCode === 404) {
        logger.log({ level: "debug", message: `[K8s] Namespace not found: ${name}` });
        return;
      }
      throw err;
    }
  }

  /**
   * List all namespaces
   */
  async function listNamespaces(): Promise<k8s.V1Namespace[]> {
    ensureInit();
    const response = await coreApi!.listNamespace();
    return response.body.items;
  }

  // ===========================================================================
  // Nodes
  // ===========================================================================

  /**
   * List all nodes
   */
  async function listNodes(): Promise<k8s.V1Node[]> {
    ensureInit();
    const response = await coreApi!.listNode();
    return response.body.items;
  }

  /**
   * Get a single node
   */
  async function getNode(name: string): Promise<k8s.V1Node | null> {
    ensureInit();
    try {
      const response = await coreApi!.readNode(name);
      return response.body;
    } catch (err: any) {
      if (err.response?.statusCode === 404) return null;
      throw err;
    }
  }

  /**
   * Cordon a node (mark as unschedulable)
   */
  async function cordonNode(name: string): Promise<void> {
    ensureInit();
    await coreApi!.patchNode(
      name,
      { spec: { unschedulable: true } },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { headers: { "Content-Type": "application/strategic-merge-patch+json" } }
    );
    logger.log({ level: "info", message: `[K8s] Cordoned node: ${name}` });
  }

  /**
   * Uncordon a node (mark as schedulable)
   */
  async function uncordonNode(name: string): Promise<void> {
    ensureInit();
    await coreApi!.patchNode(
      name,
      { spec: { unschedulable: false } },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { headers: { "Content-Type": "application/strategic-merge-patch+json" } }
    );
    logger.log({ level: "info", message: `[K8s] Uncordoned node: ${name}` });
  }

  /**
   * Delete a node from the cluster
   */
  async function deleteNode(name: string): Promise<void> {
    ensureInit();
    await coreApi!.deleteNode(name);
    logger.log({ level: "info", message: `[K8s] Deleted node: ${name}` });
  }

  // ===========================================================================
  // Deployments
  // ===========================================================================

  /**
   * Create a deployment
   */
  async function createDeployment(
    namespace: string,
    deployment: k8s.V1Deployment
  ): Promise<k8s.V1Deployment> {
    ensureInit();
    const response = await appsApi!.createNamespacedDeployment(namespace, deployment);
    logger.log({
      level: "info",
      message: `[K8s] Created deployment: ${deployment.metadata?.name} in ${namespace}`,
    });
    return response.body;
  }

  /**
   * Update a deployment
   */
  async function updateDeployment(
    namespace: string,
    name: string,
    deployment: k8s.V1Deployment
  ): Promise<k8s.V1Deployment> {
    ensureInit();
    const response = await appsApi!.replaceNamespacedDeployment(name, namespace, deployment);
    logger.log({ level: "info", message: `[K8s] Updated deployment: ${name} in ${namespace}` });
    return response.body;
  }

  /**
   * Get a deployment
   */
  async function getDeployment(
    namespace: string,
    name: string
  ): Promise<k8s.V1Deployment | null> {
    ensureInit();
    try {
      const response = await appsApi!.readNamespacedDeployment(name, namespace);
      return response.body;
    } catch (err: any) {
      if (err.response?.statusCode === 404) return null;
      throw err;
    }
  }

  /**
   * Delete a deployment
   */
  async function deleteDeployment(namespace: string, name: string): Promise<void> {
    ensureInit();
    try {
      await appsApi!.deleteNamespacedDeployment(name, namespace);
      logger.log({ level: "info", message: `[K8s] Deleted deployment: ${name} in ${namespace}` });
    } catch (err: any) {
      if (err.response?.statusCode === 404) {
        logger.log({ level: "debug", message: `[K8s] Deployment not found: ${name}` });
        return;
      }
      throw err;
    }
  }

  /**
   * Scale a deployment
   */
  async function scaleDeployment(
    namespace: string,
    name: string,
    replicas: number
  ): Promise<void> {
    ensureInit();
    await appsApi!.patchNamespacedDeploymentScale(
      name,
      namespace,
      { spec: { replicas } },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { headers: { "Content-Type": "application/strategic-merge-patch+json" } }
    );
    logger.log({
      level: "info",
      message: `[K8s] Scaled deployment ${name} to ${replicas} replicas`,
    });
  }

  /**
   * Restart a deployment (rolling restart)
   */
  async function restartDeployment(namespace: string, name: string): Promise<void> {
    ensureInit();
    const now = new Date().toISOString();
    await appsApi!.patchNamespacedDeployment(
      name,
      namespace,
      {
        spec: {
          template: {
            metadata: {
              annotations: {
                "kubectl.kubernetes.io/restartedAt": now,
              },
            },
          },
        },
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { headers: { "Content-Type": "application/strategic-merge-patch+json" } }
    );
    logger.log({ level: "info", message: `[K8s] Restarted deployment: ${name}` });
  }

  // ===========================================================================
  // Services
  // ===========================================================================

  /**
   * Create a service
   */
  async function createService(
    namespace: string,
    service: k8s.V1Service
  ): Promise<k8s.V1Service> {
    ensureInit();
    const response = await coreApi!.createNamespacedService(namespace, service);
    logger.log({
      level: "info",
      message: `[K8s] Created service: ${service.metadata?.name} in ${namespace}`,
    });
    return response.body;
  }

  /**
   * Get a service
   */
  async function getService(
    namespace: string,
    name: string
  ): Promise<k8s.V1Service | null> {
    ensureInit();
    try {
      const response = await coreApi!.readNamespacedService(name, namespace);
      return response.body;
    } catch (err: any) {
      if (err.response?.statusCode === 404) return null;
      throw err;
    }
  }

  /**
   * Update a service
   */
  async function updateService(
    namespace: string,
    name: string,
    service: k8s.V1Service
  ): Promise<k8s.V1Service> {
    ensureInit();
    const response = await coreApi!.replaceNamespacedService(name, namespace, service);
    logger.log({ level: "info", message: `[K8s] Updated service: ${name}` });
    return response.body;
  }

  /**
   * Delete a service
   */
  async function deleteService(namespace: string, name: string): Promise<void> {
    ensureInit();
    try {
      await coreApi!.deleteNamespacedService(name, namespace);
      logger.log({ level: "info", message: `[K8s] Deleted service: ${name}` });
    } catch (err: any) {
      if (err.response?.statusCode === 404) return;
      throw err;
    }
  }

  // ===========================================================================
  // Ingresses
  // ===========================================================================

  /**
   * Create an ingress
   */
  async function createIngress(
    namespace: string,
    ingress: k8s.V1Ingress
  ): Promise<k8s.V1Ingress> {
    ensureInit();
    const response = await networkingApi!.createNamespacedIngress(namespace, ingress);
    logger.log({
      level: "info",
      message: `[K8s] Created ingress: ${ingress.metadata?.name} in ${namespace}`,
    });
    return response.body;
  }

  /**
   * Get an ingress
   */
  async function getIngress(
    namespace: string,
    name: string
  ): Promise<k8s.V1Ingress | null> {
    ensureInit();
    try {
      const response = await networkingApi!.readNamespacedIngress(name, namespace);
      return response.body;
    } catch (err: any) {
      if (err.response?.statusCode === 404) return null;
      throw err;
    }
  }

  /**
   * Update an ingress
   */
  async function updateIngress(
    namespace: string,
    name: string,
    ingress: k8s.V1Ingress
  ): Promise<k8s.V1Ingress> {
    ensureInit();
    const response = await networkingApi!.replaceNamespacedIngress(name, namespace, ingress);
    logger.log({ level: "info", message: `[K8s] Updated ingress: ${name}` });
    return response.body;
  }

  /**
   * Delete an ingress
   */
  async function deleteIngress(namespace: string, name: string): Promise<void> {
    ensureInit();
    try {
      await networkingApi!.deleteNamespacedIngress(name, namespace);
      logger.log({ level: "info", message: `[K8s] Deleted ingress: ${name}` });
    } catch (err: any) {
      if (err.response?.statusCode === 404) return;
      throw err;
    }
  }

  // ===========================================================================
  // Secrets
  // ===========================================================================

  /**
   * Create a secret
   */
  async function createSecret(
    namespace: string,
    name: string,
    data: Record<string, string>,
    labels?: Record<string, string>
  ): Promise<k8s.V1Secret> {
    ensureInit();

    // Base64 encode all values
    const encodedData: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      encodedData[key] = Buffer.from(value).toString("base64");
    }

    const secret: k8s.V1Secret = {
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name,
        namespace,
        labels: {
          "app.kubernetes.io/managed-by": "controlplane",
          ...labels,
        },
      },
      type: "Opaque",
      data: encodedData,
    };

    try {
      const response = await coreApi!.createNamespacedSecret(namespace, secret);
      logger.log({ level: "info", message: `[K8s] Created secret: ${name} in ${namespace}` });
      return response.body;
    } catch (err: any) {
      if (err.response?.statusCode === 409) {
        // Update existing
        return updateSecret(namespace, name, data, labels);
      }
      throw err;
    }
  }

  /**
   * Update a secret
   */
  async function updateSecret(
    namespace: string,
    name: string,
    data: Record<string, string>,
    labels?: Record<string, string>
  ): Promise<k8s.V1Secret> {
    ensureInit();

    const encodedData: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      encodedData[key] = Buffer.from(value).toString("base64");
    }

    const secret: k8s.V1Secret = {
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name,
        namespace,
        labels: {
          "app.kubernetes.io/managed-by": "controlplane",
          ...labels,
        },
      },
      type: "Opaque",
      data: encodedData,
    };

    const response = await coreApi!.replaceNamespacedSecret(name, namespace, secret);
    logger.log({ level: "info", message: `[K8s] Updated secret: ${name}` });
    return response.body;
  }

  /**
   * Delete a secret
   */
  async function deleteSecret(namespace: string, name: string): Promise<void> {
    ensureInit();
    try {
      await coreApi!.deleteNamespacedSecret(name, namespace);
      logger.log({ level: "info", message: `[K8s] Deleted secret: ${name}` });
    } catch (err: any) {
      if (err.response?.statusCode === 404) return;
      throw err;
    }
  }

  /**
   * Get a secret and decode its data
   * Returns decoded (base64 -> string) data, or null if secret not found
   */
  async function getSecret(
    namespace: string,
    name: string
  ): Promise<Record<string, string> | null> {
    ensureInit();
    try {
      const response = await coreApi!.readNamespacedSecret(name, namespace);
      const secret = response.body;

      if (!secret.data) {
        return {};
      }

      // Decode base64 values
      const decoded: Record<string, string> = {};
      for (const [key, value] of Object.entries(secret.data)) {
        decoded[key] = Buffer.from(value, "base64").toString("utf-8");
      }

      return decoded;
    } catch (err: any) {
      if (err.response?.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  // ===========================================================================
  // Pods
  // ===========================================================================

  /**
   * List pods in a namespace
   */
  async function listPods(
    namespace: string,
    labelSelector?: string
  ): Promise<k8s.V1Pod[]> {
    ensureInit();
    const response = await coreApi!.listNamespacedPod(
      namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      labelSelector
    );
    return response.body.items;
  }

  /**
   * Get pod logs
   */
  async function getPodLogs(
    namespace: string,
    podName: string,
    container?: string,
    tailLines?: number
  ): Promise<string> {
    ensureInit();
    const response = await coreApi!.readNamespacedPodLog(
      podName,
      namespace,
      container,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      tailLines
    );
    return response.body;
  }

  /**
   * Delete a pod
   */
  async function deletePod(namespace: string, name: string): Promise<void> {
    ensureInit();
    await coreApi!.deleteNamespacedPod(name, namespace);
    logger.log({ level: "info", message: `[K8s] Deleted pod: ${name}` });
  }

  // ===========================================================================
  // Custom Resources (for MongoDB operator, etc.)
  // ===========================================================================

  /**
   * Create a custom resource
   */
  async function createCustomResource(
    group: string,
    version: string,
    namespace: string,
    plural: string,
    body: object
  ): Promise<object> {
    ensureInit();
    const response = await customObjectsApi!.createNamespacedCustomObject(
      group,
      version,
      namespace,
      plural,
      body
    );
    return response.body;
  }

  /**
   * Get a custom resource
   */
  async function getCustomResource(
    group: string,
    version: string,
    namespace: string,
    plural: string,
    name: string
  ): Promise<object | null> {
    ensureInit();
    try {
      const response = await customObjectsApi!.getNamespacedCustomObject(
        group,
        version,
        namespace,
        plural,
        name
      );
      return response.body;
    } catch (err: any) {
      if (err.response?.statusCode === 404) return null;
      throw err;
    }
  }

  /**
   * Update a custom resource
   */
  async function updateCustomResource(
    group: string,
    version: string,
    namespace: string,
    plural: string,
    name: string,
    body: object
  ): Promise<object> {
    ensureInit();
    const response = await customObjectsApi!.replaceNamespacedCustomObject(
      group,
      version,
      namespace,
      plural,
      name,
      body
    );
    return response.body;
  }

  /**
   * Delete a custom resource
   */
  async function deleteCustomResource(
    group: string,
    version: string,
    namespace: string,
    plural: string,
    name: string
  ): Promise<void> {
    ensureInit();
    try {
      await customObjectsApi!.deleteNamespacedCustomObject(
        group,
        version,
        namespace,
        plural,
        name
      );
    } catch (err: any) {
      if (err.response?.statusCode === 404) return;
      throw err;
    }
  }

  /**
   * List custom resources
   */
  async function listCustomResources(
    group: string,
    version: string,
    namespace: string,
    plural: string,
    labelSelector?: string
  ): Promise<any[]> {
    ensureInit();
    const response = await customObjectsApi!.listNamespacedCustomObject(
      group,
      version,
      namespace,
      plural,
      undefined,
      undefined,
      undefined,
      undefined,
      labelSelector
    );
    return (response.body as any).items || [];
  }

  return {
    // Initialization
    init,
    isAvailable,
    getClusterInfo,
    getKubeConfig,

    // Namespaces
    createNamespace,
    deleteNamespace,
    listNamespaces,

    // Nodes
    listNodes,
    getNode,
    cordonNode,
    uncordonNode,
    deleteNode,

    // Deployments
    createDeployment,
    updateDeployment,
    getDeployment,
    deleteDeployment,
    scaleDeployment,
    restartDeployment,

    // Services
    createService,
    getService,
    updateService,
    deleteService,

    // Ingresses
    createIngress,
    getIngress,
    updateIngress,
    deleteIngress,

    // Secrets
    createSecret,
    updateSecret,
    deleteSecret,
    getSecret,

    // Pods
    listPods,
    getPodLogs,
    deletePod,

    // Custom Resources
    createCustomResource,
    getCustomResource,
    updateCustomResource,
    deleteCustomResource,
    listCustomResources,
  };
}
