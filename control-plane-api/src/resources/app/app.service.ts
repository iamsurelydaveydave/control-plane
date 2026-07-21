import { ObjectId } from "mongodb";
import * as k8s from "@kubernetes/client-node";
import { useAppRepo } from "./app.repository";
import { TApp, TAppK8sConfig } from "./app.model";
import { useKubernetesService } from "../../services/kubernetes.service";
import { BadRequestError, NotFoundError, InternalServerError, logger } from "../../utils";
import { useWebhookService } from "../webhook/webhook.service";

// K8s namespace for all apps deployed via Control Plane
const CP_APPS_NAMESPACE = "cp-apps";

// Check if K8s is enabled
const K8S_ENABLED = process.env.K8S_ENABLED === "true";

// Resource naming helpers
function getDeploymentName(appName: string): string {
  return `cp-app-${appName}`;
}

function getServiceName(appName: string): string {
  return `cp-app-${appName}`;
}

function getIngressName(appName: string): string {
  return `cp-app-${appName}`;
}

function getSecretName(appName: string): string {
  return `cp-app-${appName}-env`;
}

/**
 * App Service
 * Business logic for K8s-based app deployment, scaling, and routing
 */
export function useAppService() {
  const appRepo = useAppRepo();
  const k8s = useKubernetesService();
  const webhookService = useWebhookService();

  /**
   * Check if K8s is enabled and available
   */
  async function ensureK8sAvailable(): Promise<void> {
    if (!K8S_ENABLED) {
      throw new BadRequestError("Kubernetes integration is not enabled. Set K8S_ENABLED=true to enable.");
    }
    k8s.init();
    const available = await k8s.isAvailable();
    if (!available) {
      throw new InternalServerError("Kubernetes cluster is not reachable. Check cluster connectivity.");
    }
  }

  /**
   * Ensure the cp-apps namespace exists
   */
  async function ensureNamespace(): Promise<void> {
    await k8s.createNamespace(CP_APPS_NAMESPACE, {
      "app.kubernetes.io/part-of": "control-plane",
    });
  }

  /**
   * Get app by ID
   */
  async function getApp(appId: string | ObjectId): Promise<TApp | null> {
    return appRepo.getById(appId);
  }

  /**
   * Build K8s Deployment spec from app configuration
   */
  function buildDeploymentSpec(app: TApp, k8sConfig: TAppK8sConfig): k8s.V1Deployment {
    const deploymentName = getDeploymentName(app.name);
    const secretName = getSecretName(app.name);

    const deployment: k8s.V1Deployment = {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: {
        name: deploymentName,
        namespace: CP_APPS_NAMESPACE,
        labels: {
          app: app.name,
          "app.kubernetes.io/name": app.name,
          "app.kubernetes.io/managed-by": "controlplane",
          ...app.labels,
        },
      },
      spec: {
        replicas: k8sConfig.replicas,
        selector: {
          matchLabels: {
            app: app.name,
          },
        },
        template: {
          metadata: {
            labels: {
              app: app.name,
              "app.kubernetes.io/name": app.name,
              "app.kubernetes.io/managed-by": "controlplane",
            },
          },
          spec: {
            containers: [
              {
                name: "app",
                image: k8sConfig.image,
                ports: [
                  {
                    containerPort: k8sConfig.port,
                    protocol: "TCP",
                  },
                ],
                envFrom: [
                  {
                    secretRef: {
                      name: secretName,
                    },
                  },
                ],
                resources: {
                  requests: {
                    memory: k8sConfig.resourceRequests?.memory ?? "128Mi",
                    cpu: k8sConfig.resourceRequests?.cpu ?? "100m",
                  },
                  limits: {
                    memory: k8sConfig.resourceLimits?.memory ?? "512Mi",
                    cpu: k8sConfig.resourceLimits?.cpu ?? "500m",
                  },
                },
              },
            ],
          },
        },
      },
    };

    // Add health check if configured
    if (app.healthCheck) {
      const container = deployment.spec!.template.spec!.containers[0];
      container.readinessProbe = {
        httpGet: {
          path: app.healthCheck.path,
          port: app.healthCheck.port ?? k8sConfig.port,
        },
        initialDelaySeconds: app.healthCheck.startPeriod ?? 10,
        periodSeconds: app.healthCheck.interval ?? 30,
        timeoutSeconds: app.healthCheck.timeout ?? 5,
        failureThreshold: app.healthCheck.retries ?? 3,
      };
      container.livenessProbe = {
        httpGet: {
          path: app.healthCheck.path,
          port: app.healthCheck.port ?? k8sConfig.port,
        },
        initialDelaySeconds: (app.healthCheck.startPeriod ?? 10) + 10,
        periodSeconds: app.healthCheck.interval ?? 30,
        timeoutSeconds: app.healthCheck.timeout ?? 5,
        failureThreshold: app.healthCheck.retries ?? 3,
      };
    }

    return deployment;
  }

  /**
   * Build K8s Service spec from app configuration
   */
  function buildServiceSpec(app: TApp, k8sConfig: TAppK8sConfig): k8s.V1Service {
    const serviceName = getServiceName(app.name);

    return {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: serviceName,
        namespace: CP_APPS_NAMESPACE,
        labels: {
          app: app.name,
          "app.kubernetes.io/name": app.name,
          "app.kubernetes.io/managed-by": "controlplane",
        },
      },
      spec: {
        type: "ClusterIP",
        selector: {
          app: app.name,
        },
        ports: [
          {
            port: k8sConfig.port,
            targetPort: k8sConfig.port,
            protocol: "TCP",
            name: "http",
          },
        ],
      },
    };
  }

  /**
   * Build K8s Ingress spec from app configuration (Traefik-compatible)
   */
  function buildIngressSpec(app: TApp, k8sConfig: TAppK8sConfig): k8s.V1Ingress | null {
    const domain = k8sConfig.domain ?? app.proxy?.host;
    if (!domain) {
      return null; // No domain configured, skip Ingress
    }

    const ingressName = getIngressName(app.name);
    const serviceName = getServiceName(app.name);

    const ingress: k8s.V1Ingress = {
      apiVersion: "networking.k8s.io/v1",
      kind: "Ingress",
      metadata: {
        name: ingressName,
        namespace: CP_APPS_NAMESPACE,
        labels: {
          app: app.name,
          "app.kubernetes.io/name": app.name,
          "app.kubernetes.io/managed-by": "controlplane",
        },
        annotations: {
          // Traefik-specific annotations (K3s default ingress controller)
          "traefik.ingress.kubernetes.io/router.entrypoints": app.proxy?.ssl ? "websecure" : "web",
        },
      },
      spec: {
        rules: [
          {
            host: domain,
            http: {
              paths: [
                {
                  path: "/",
                  pathType: "Prefix",
                  backend: {
                    service: {
                      name: serviceName,
                      port: {
                        number: k8sConfig.port,
                      },
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    };

    // Add TLS configuration if SSL is enabled
    if (app.proxy?.ssl) {
      ingress.metadata!.annotations = {
        ...ingress.metadata!.annotations,
        "traefik.ingress.kubernetes.io/router.tls": "true",
        "traefik.ingress.kubernetes.io/router.tls.certresolver": "letsencrypt",
      };
      ingress.spec!.tls = [
        {
          hosts: [domain],
          secretName: `${app.name}-tls`,
        },
      ];
    }

    return ingress;
  }

  /**
   * Deploy an app to Kubernetes
   * Creates/updates Deployment, Service, Ingress, and Secret
   */
  async function deploy(
    appId: string | ObjectId,
    options: { version?: string } = {}
  ): Promise<{ message: string; errors: string[] }> {
    // Ensure K8s is available before proceeding
    await ensureK8sAvailable();

    const app = await appRepo.getById(appId);
    if (!app) {
      throw new NotFoundError("App not found");
    }

    // Validate K8s configuration
    const k8sConfig = getK8sConfig(app);
    if (!k8sConfig) {
      throw new BadRequestError(
        "App must have k8s configuration with image specified. Update the app with k8s: { image, port, replicas, domain, envVars }"
      );
    }

    const errors: string[] = [];

    // Update status to deploying
    await appRepo.updateStatus(appId, "deploying");

    try {
      // Ensure namespace exists
      await ensureNamespace();

      // 1. Create/update Secret for environment variables
      const secretName = getSecretName(app.name);
      const envVars = {
        ...app.env,
        ...k8sConfig.envVars,
      };
      await k8s.createSecret(CP_APPS_NAMESPACE, secretName, envVars, {
        app: app.name,
      });
      logger.log({ level: "info", message: `[AppService] Created/updated secret ${secretName}` });

      // 2. Create/update Deployment
      const deploymentName = getDeploymentName(app.name);
      const deploymentSpec = buildDeploymentSpec(app, k8sConfig);

      const existingDeployment = await k8s.getDeployment(CP_APPS_NAMESPACE, deploymentName);
      if (existingDeployment) {
        // Preserve resourceVersion for update
        deploymentSpec.metadata!.resourceVersion = existingDeployment.metadata?.resourceVersion;
        await k8s.updateDeployment(CP_APPS_NAMESPACE, deploymentName, deploymentSpec);
        logger.log({ level: "info", message: `[AppService] Updated deployment ${deploymentName}` });
      } else {
        await k8s.createDeployment(CP_APPS_NAMESPACE, deploymentSpec);
        logger.log({ level: "info", message: `[AppService] Created deployment ${deploymentName}` });
      }

      // 3. Create/update Service
      const serviceName = getServiceName(app.name);
      const serviceSpec = buildServiceSpec(app, k8sConfig);

      const existingService = await k8s.getService(CP_APPS_NAMESPACE, serviceName);
      if (existingService) {
        // Preserve clusterIP and resourceVersion for update
        serviceSpec.spec!.clusterIP = existingService.spec?.clusterIP;
        serviceSpec.metadata!.resourceVersion = existingService.metadata?.resourceVersion;
        await k8s.updateService(CP_APPS_NAMESPACE, serviceName, serviceSpec);
        logger.log({ level: "info", message: `[AppService] Updated service ${serviceName}` });
      } else {
        await k8s.createService(CP_APPS_NAMESPACE, serviceSpec);
        logger.log({ level: "info", message: `[AppService] Created service ${serviceName}` });
      }

      // 4. Create/update Ingress (if domain is configured)
      const ingressSpec = buildIngressSpec(app, k8sConfig);
      if (ingressSpec) {
        const ingressName = getIngressName(app.name);
        const existingIngress = await k8s.getIngress(CP_APPS_NAMESPACE, ingressName);
        if (existingIngress) {
          ingressSpec.metadata!.resourceVersion = existingIngress.metadata?.resourceVersion;
          await k8s.updateIngress(CP_APPS_NAMESPACE, ingressName, ingressSpec);
          logger.log({ level: "info", message: `[AppService] Updated ingress ${ingressName}` });
        } else {
          await k8s.createIngress(CP_APPS_NAMESPACE, ingressSpec);
          logger.log({ level: "info", message: `[AppService] Created ingress ${ingressName}` });
        }
      }

      // Update app record with deployment info
      await appRepo.updateById(appId, {
        currentImage: k8sConfig.image,
        currentVersion: options.version ?? extractVersionFromImage(k8sConfig.image),
        desiredReplicas: k8sConfig.replicas,
      });
      await appRepo.updateStatus(appId, "running");

      const domain = k8sConfig.domain ?? app.proxy?.host;

      // Trigger webhook notification
      webhookService.trigger("app.deployed", {
        appId: app._id?.toString(),
        appName: app.name,
        version: options.version ?? extractVersionFromImage(k8sConfig.image),
        domain,
        replicas: k8sConfig.replicas,
        deployedAt: new Date().toISOString(),
      });

      return {
        message: `Successfully deployed ${app.name}${domain ? ` to ${domain}` : ""}`,
        errors,
      };
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `[AppService] Deploy failed for ${app.name}: ${error.message}`,
      });
      errors.push(error.message);
      await appRepo.updateStatus(appId, "failed");

      // Trigger webhook notification for failure
      webhookService.trigger("app.failed", {
        appId: typeof appId === "string" ? appId : appId.toString(),
        appName: app.name,
        error: error.message,
        failedAt: new Date().toISOString(),
      });

      throw new InternalServerError(`Deployment failed: ${error.message}`);
    }
  }

  /**
   * Stop an app (scale to 0 replicas)
   */
  async function stop(appId: string | ObjectId): Promise<{ message: string; errors: string[] }> {
    const app = await appRepo.getById(appId);
    if (!app) {
      throw new NotFoundError("App not found");
    }

    const errors: string[] = [];

    try {
      const deploymentName = getDeploymentName(app.name);

      // Get current replica count before scaling down
      const deployment = await k8s.getDeployment(CP_APPS_NAMESPACE, deploymentName);
      if (!deployment) {
        throw new BadRequestError(`App ${app.name} has no active deployment`);
      }

      const currentReplicas = deployment.spec?.replicas ?? 1;

      // Store current replicas before scaling to 0
      await appRepo.updateById(appId, { desiredReplicas: currentReplicas });

      // Scale to 0
      await k8s.scaleDeployment(CP_APPS_NAMESPACE, deploymentName, 0);
      await appRepo.updateStatus(appId, "stopped");

      // Trigger webhook notification
      webhookService.trigger("app.stopped", {
        appId: app._id?.toString(),
        appName: app.name,
        previousReplicas: currentReplicas,
        stoppedAt: new Date().toISOString(),
      });

      logger.log({
        level: "info",
        message: `[AppService] Stopped app ${app.name} (was ${currentReplicas} replicas)`,
      });

      return {
        message: `Stopped ${app.name}`,
        errors,
      };
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `[AppService] Stop failed for ${app.name}: ${error.message}`,
      });
      errors.push(error.message);
      throw error;
    }
  }

  /**
   * Start an app (scale back to desired replicas)
   */
  async function start(appId: string | ObjectId): Promise<{ message: string; errors: string[] }> {
    const app = await appRepo.getById(appId);
    if (!app) {
      throw new NotFoundError("App not found");
    }

    const errors: string[] = [];

    try {
      const deploymentName = getDeploymentName(app.name);

      // Check deployment exists
      const deployment = await k8s.getDeployment(CP_APPS_NAMESPACE, deploymentName);
      if (!deployment) {
        throw new BadRequestError(`App ${app.name} has no active deployment. Run deploy first.`);
      }

      // Get desired replicas from app record (stored when stopped) or default to 1
      const replicas = app.desiredReplicas ?? app.k8s?.replicas ?? 1;

      // Scale up
      await k8s.scaleDeployment(CP_APPS_NAMESPACE, deploymentName, replicas);
      await appRepo.updateStatus(appId, "running");

      // Trigger webhook notification
      webhookService.trigger("app.started", {
        appId: app._id?.toString(),
        appName: app.name,
        replicas,
        startedAt: new Date().toISOString(),
      });

      logger.log({
        level: "info",
        message: `[AppService] Started app ${app.name} with ${replicas} replicas`,
      });

      return {
        message: `Started ${app.name} with ${replicas} replicas`,
        errors,
      };
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `[AppService] Start failed for ${app.name}: ${error.message}`,
      });
      errors.push(error.message);
      throw error;
    }
  }

  /**
   * Restart an app (rolling restart via annotation update)
   */
  async function restart(appId: string | ObjectId): Promise<{ message: string; errors: string[] }> {
    const app = await appRepo.getById(appId);
    if (!app) {
      throw new NotFoundError("App not found");
    }

    const errors: string[] = [];

    try {
      const deploymentName = getDeploymentName(app.name);

      // Check deployment exists
      const deployment = await k8s.getDeployment(CP_APPS_NAMESPACE, deploymentName);
      if (!deployment) {
        throw new BadRequestError(`App ${app.name} has no active deployment`);
      }

      // Trigger rolling restart
      await k8s.restartDeployment(CP_APPS_NAMESPACE, deploymentName);

      logger.log({
        level: "info",
        message: `[AppService] Restarted app ${app.name}`,
      });

      return {
        message: `Restarted ${app.name}`,
        errors,
      };
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `[AppService] Restart failed for ${app.name}: ${error.message}`,
      });
      errors.push(error.message);
      throw error;
    }
  }

  /**
   * Scale an app to specified replicas
   */
  async function scale(
    appId: string | ObjectId,
    replicas: number
  ): Promise<{ message: string; errors: string[] }> {
    const app = await appRepo.getById(appId);
    if (!app) {
      throw new NotFoundError("App not found");
    }

    if (replicas < 0) {
      throw new BadRequestError("Replicas must be >= 0");
    }

    const errors: string[] = [];

    try {
      const deploymentName = getDeploymentName(app.name);

      // Check deployment exists
      const deployment = await k8s.getDeployment(CP_APPS_NAMESPACE, deploymentName);
      if (!deployment) {
        throw new BadRequestError(`App ${app.name} has no active deployment`);
      }

      // Scale
      await k8s.scaleDeployment(CP_APPS_NAMESPACE, deploymentName, replicas);

      // Update app record
      await appRepo.scale(appId, replicas);

      // Update status based on replica count
      if (replicas === 0) {
        await appRepo.updateStatus(appId, "stopped");
      } else if (app.status === "stopped") {
        await appRepo.updateStatus(appId, "running");
      }

      logger.log({
        level: "info",
        message: `[AppService] Scaled app ${app.name} to ${replicas} replicas`,
      });

      return {
        message: `Scaled ${app.name} to ${replicas} replicas`,
        errors,
      };
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `[AppService] Scale failed for ${app.name}: ${error.message}`,
      });
      errors.push(error.message);
      throw error;
    }
  }

  /**
   * Delete an app and all its K8s resources
   */
  async function deleteApp(appId: string | ObjectId): Promise<{ message: string; errors: string[] }> {
    const app = await appRepo.getById(appId);
    if (!app) {
      throw new NotFoundError("App not found");
    }

    const errors: string[] = [];

    // Delete K8s resources (best effort - don't fail if resources don't exist)
    try {
      const deploymentName = getDeploymentName(app.name);
      await k8s.deleteDeployment(CP_APPS_NAMESPACE, deploymentName);
      logger.log({ level: "info", message: `[AppService] Deleted deployment ${deploymentName}` });
    } catch (error: any) {
      logger.log({
        level: "warn",
        message: `[AppService] Failed to delete deployment: ${error.message}`,
      });
      errors.push(`Deployment deletion: ${error.message}`);
    }

    try {
      const serviceName = getServiceName(app.name);
      await k8s.deleteService(CP_APPS_NAMESPACE, serviceName);
      logger.log({ level: "info", message: `[AppService] Deleted service ${serviceName}` });
    } catch (error: any) {
      logger.log({
        level: "warn",
        message: `[AppService] Failed to delete service: ${error.message}`,
      });
      errors.push(`Service deletion: ${error.message}`);
    }

    try {
      const ingressName = getIngressName(app.name);
      await k8s.deleteIngress(CP_APPS_NAMESPACE, ingressName);
      logger.log({ level: "info", message: `[AppService] Deleted ingress ${ingressName}` });
    } catch (error: any) {
      logger.log({
        level: "warn",
        message: `[AppService] Failed to delete ingress: ${error.message}`,
      });
      errors.push(`Ingress deletion: ${error.message}`);
    }

    try {
      const secretName = getSecretName(app.name);
      await k8s.deleteSecret(CP_APPS_NAMESPACE, secretName);
      logger.log({ level: "info", message: `[AppService] Deleted secret ${secretName}` });
    } catch (error: any) {
      logger.log({
        level: "warn",
        message: `[AppService] Failed to delete secret: ${error.message}`,
      });
      errors.push(`Secret deletion: ${error.message}`);
    }

    // Delete app record from MongoDB
    await appRepo.deleteById(appId);

    logger.log({
      level: "info",
      message: `[AppService] Deleted app ${app.name} and all resources`,
    });

    return {
      message: `Deleted ${app.name} and all associated resources`,
      errors,
    };
  }

  /**
   * Get logs from app pods
   */
  async function getLogs(
    appId: string | ObjectId,
    options: { tailLines?: number; container?: string; podName?: string } = {}
  ): Promise<{ logs: string; podName: string }[]> {
    const app = await appRepo.getById(appId);
    if (!app) {
      throw new NotFoundError("App not found");
    }

    const tailLines = options.tailLines ?? 100;
    const results: { logs: string; podName: string }[] = [];

    try {
      // List pods for this app
      const pods = await k8s.listPods(CP_APPS_NAMESPACE, `app=${app.name}`);

      if (pods.length === 0) {
        throw new BadRequestError(`No pods found for app ${app.name}`);
      }

      // If specific pod requested, get just that one
      const targetPods = options.podName
        ? pods.filter((p) => p.metadata?.name === options.podName)
        : pods;

      if (targetPods.length === 0) {
        throw new BadRequestError(`Pod ${options.podName} not found for app ${app.name}`);
      }

      // Get logs from each pod
      for (const pod of targetPods) {
        const podName = pod.metadata?.name;
        if (!podName) continue;

        try {
          const logs = await k8s.getPodLogs(
            CP_APPS_NAMESPACE,
            podName,
            options.container ?? "app",
            tailLines
          );
          results.push({ podName, logs });
        } catch (error: any) {
          logger.log({
            level: "warn",
            message: `[AppService] Failed to get logs for pod ${podName}: ${error.message}`,
          });
          results.push({ podName, logs: `Error: ${error.message}` });
        }
      }

      return results;
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `[AppService] getLogs failed for ${app.name}: ${error.message}`,
      });
      throw error;
    }
  }

  /**
   * Sync routing for an app (update Ingress)
   */
  async function syncRouting(appId: string | ObjectId): Promise<void> {
    const app = await appRepo.getById(appId);
    if (!app) {
      logger.log({
        level: "warn",
        message: `App ${appId} not found for routing sync`,
      });
      return;
    }

    const k8sConfig = getK8sConfig(app);
    if (!k8sConfig) {
      logger.log({
        level: "debug",
        message: `App ${app.name} has no K8s config, skipping routing sync`,
      });
      return;
    }

    const ingressSpec = buildIngressSpec(app, k8sConfig);
    if (!ingressSpec) {
      logger.log({
        level: "debug",
        message: `App ${app.name} has no domain configured, skipping routing sync`,
      });
      return;
    }

    try {
      const ingressName = getIngressName(app.name);
      const existingIngress = await k8s.getIngress(CP_APPS_NAMESPACE, ingressName);
      if (existingIngress) {
        ingressSpec.metadata!.resourceVersion = existingIngress.metadata?.resourceVersion;
        await k8s.updateIngress(CP_APPS_NAMESPACE, ingressName, ingressSpec);
      } else {
        await k8s.createIngress(CP_APPS_NAMESPACE, ingressSpec);
      }
      logger.log({
        level: "info",
        message: `[AppService] Synced routing for ${app.name}`,
      });
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `[AppService] syncRouting failed for ${app.name}: ${error.message}`,
      });
    }
  }

  /**
   * Rebuild all routes (reconcile all Ingresses)
   */
  async function rebuildAllRoutes(): Promise<void> {
    logger.log({
      level: "info",
      message: "[AppService] Rebuilding all routes...",
    });

    try {
      const apps = await appRepo.getAll({ limit: 1000 });
      for (const app of apps.items as TApp[]) {
        try {
          await syncRouting(app._id!);
        } catch (error: any) {
          logger.log({
            level: "warn",
            message: `[AppService] Failed to sync routing for ${app.name}: ${error.message}`,
          });
        }
      }
      logger.log({
        level: "info",
        message: "[AppService] Finished rebuilding all routes",
      });
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `[AppService] rebuildAllRoutes failed: ${error.message}`,
      });
    }
  }

  /**
   * Get K8s deployment status for an app
   */
  async function getDeploymentStatus(appId: string | ObjectId): Promise<{
    ready: boolean;
    replicas: number;
    availableReplicas: number;
    pods: Array<{
      name: string;
      phase: string;
      ready: boolean;
      restartCount: number;
    }>;
  } | null> {
    const app = await appRepo.getById(appId);
    if (!app) {
      throw new NotFoundError("App not found");
    }

    try {
      const deploymentName = getDeploymentName(app.name);
      const deployment = await k8s.getDeployment(CP_APPS_NAMESPACE, deploymentName);

      if (!deployment) {
        return null;
      }

      const pods = await k8s.listPods(CP_APPS_NAMESPACE, `app=${app.name}`);

      return {
        ready:
          (deployment.status?.readyReplicas ?? 0) ===
          (deployment.spec?.replicas ?? 0),
        replicas: deployment.spec?.replicas ?? 0,
        availableReplicas: deployment.status?.availableReplicas ?? 0,
        pods: pods.map((pod) => ({
          name: pod.metadata?.name ?? "",
          phase: pod.status?.phase ?? "Unknown",
          ready:
            pod.status?.containerStatuses?.every((cs) => cs.ready) ?? false,
          restartCount:
            pod.status?.containerStatuses?.reduce(
              (sum, cs) => sum + (cs.restartCount ?? 0),
              0
            ) ?? 0,
        })),
      };
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `[AppService] getDeploymentStatus failed for ${app.name}: ${error.message}`,
      });
      return null;
    }
  }

  /**
   * Mark instance as unhealthy (no-op for K8s - handled by probes)
   */
  async function markInstanceUnhealthy(_instanceId: string | ObjectId): Promise<void> {
    // K8s handles health checks natively via readiness/liveness probes
    logger.log({
      level: "debug",
      message: "markInstanceUnhealthy called - K8s handles this natively via probes",
    });
  }

  /**
   * Mark instance as healthy (no-op for K8s - handled by probes)
   */
  async function markInstanceHealthy(_instanceId: string | ObjectId): Promise<void> {
    // K8s handles health checks natively via readiness/liveness probes
    logger.log({
      level: "debug",
      message: "markInstanceHealthy called - K8s handles this natively via probes",
    });
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Get K8s config from app, falling back to legacy fields
   */
  function getK8sConfig(app: TApp): TAppK8sConfig | null {
    // Use explicit k8s config if present
    if (app.k8s?.image) {
      return app.k8s;
    }

    // Fall back to legacy source.image
    if (app.source?.type === "image" && app.source.image) {
      return {
        replicas: app.desiredReplicas ?? 1,
        image: app.source.image,
        port: app.proxy?.appPort ?? 3000,
        domain: app.proxy?.host,
        envVars: app.env ?? {},
        resourceRequests: {
          memory: app.resources?.memory ?? "128Mi",
          cpu: String(app.resources?.cpus ?? 0.1),
        },
        resourceLimits: {
          memory: app.resources?.memory ?? "512Mi",
          cpu: String(app.resources?.cpus ?? 0.5),
        },
      };
    }

    return null;
  }

  /**
   * Extract version/tag from image URL
   */
  function extractVersionFromImage(imageUrl: string): string {
    const parts = imageUrl.split(":");
    return parts.length > 1 ? parts[parts.length - 1] : "latest";
  }

  return {
    getApp,
    deploy,
    stop,
    start,
    restart,
    scale,
    deleteApp,
    getLogs,
    syncRouting,
    rebuildAllRoutes,
    getDeploymentStatus,
    markInstanceUnhealthy,
    markInstanceHealthy,
  };
}
