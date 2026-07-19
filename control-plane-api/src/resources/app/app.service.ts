import { ObjectId } from "mongodb";
import { useAppRepo } from "./app.repository";
import { useInstanceRepo } from "../instance/instance.repository";
import { useServerRepo } from "../server/server.repository";
import { useCaddyService, TAppForCaddy, TInstanceForCaddy, TServerForCaddy } from "../../services/caddy.service";
import { useDockerExecutor } from "../../services/docker.executor";
import { TApp } from "./app.model";
import { TServer } from "../server/server.model";
import { BadRequestError, NotFoundError, logger } from "../../utils";

/**
 * App Service
 * Business logic for app deployment, scaling, and routing
 * 
 * In the Kamal-style model:
 * - One instance per server (serverIds defines the servers to deploy to)
 * - No "replicas" concept - you scale by adding/removing servers
 * - Each server gets one container running the app
 */
export function useAppService() {
  const appRepo = useAppRepo();
  const instanceRepo = useInstanceRepo();
  const serverRepo = useServerRepo();
  const caddyService = useCaddyService();
  const dockerExecutor = useDockerExecutor();

  /**
   * Helper: Load server by ID
   */
  async function loadServer(serverId: ObjectId): Promise<TServer> {
    const server = await serverRepo.getById(serverId);
    if (!server) {
      throw new NotFoundError(`Server ${serverId} not found`);
    }
    return server;
  }

  /**
   * Helper: Load servers as a Map for Caddy
   */
  async function loadServersMap(
    serverIds: ObjectId[]
  ): Promise<Map<string, TServerForCaddy>> {
    const serverMap = new Map<string, TServerForCaddy>();

    for (const serverId of serverIds) {
      const server = await serverRepo.getById(serverId);
      if (server) {
        serverMap.set(serverId.toString(), {
          _id: server._id!,
          host: server.host,
          privateIp: server.privateIp,
        });
      }
    }

    return serverMap;
  }

  /**
   * Helper: Convert app to Caddy format
   */
  function appForCaddy(app: TApp): TAppForCaddy {
    return {
      _id: app._id!,
      domain: app.proxy?.host, // Domain comes from proxy.host
      healthCheck: app.healthCheck ? {
        path: app.healthCheck.path,
        interval: app.healthCheck.interval || 30,
        timeout: app.healthCheck.timeout || 5,
      } : undefined,
      loadBalancer: { policy: "round_robin" },
    };
  }

  /**
   * Helper: Convert instances to Caddy format
   */
  function instancesForCaddy(instances: Array<{ _id?: ObjectId; appId: ObjectId; serverId: ObjectId; port: number; status: string }>): TInstanceForCaddy[] {
    return instances.map((i) => ({
      _id: i._id!,
      appId: i.appId,
      serverId: i.serverId,
      port: i.port,
      status: i.status,
    }));
  }

  /**
   * Sync Caddy routing for an app
   * Call after any change that affects routing
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

    const instances = await instanceRepo.getByAppId(appId);
    const serverMap = await loadServersMap(app.serverIds);

    await caddyService.syncAppRouting(
      appForCaddy(app),
      instancesForCaddy(instances),
      serverMap
    );
  }

  /**
   * Deploy an app
   * Creates one instance per server and updates routing
   */
  async function deploy(
    appId: string | ObjectId,
    options: { version?: string } = {}
  ): Promise<{ message: string; instances: ObjectId[]; errors: string[] }> {
    const app = await appRepo.getById(appId);
    if (!app) {
      throw new NotFoundError("App not found");
    }

    // Pre-flight: verify all target servers are ready before touching any state
    for (const serverId of app.serverIds) {
      const server = await serverRepo.getById(serverId);
      if (!server) {
        throw new NotFoundError(`Server ${serverId} not found`);
      }
      if (server.status !== "online") {
        throw new BadRequestError(
          `Server "${server.name}" is not ready for deployment (status: ${server.status}). Complete server setup first.`
        );
      }
      if (!server.dockerInstalled) {
        throw new BadRequestError(
          `Server "${server.name}" does not have Docker installed. Complete server setup first.`
        );
      }
    }

    // Update version/image if provided
    if (options.version && app.source.type === "image") {
      const newImage = app.source.image?.replace(/:.*$/, `:${options.version}`) || options.version;
      await appRepo.updateById(appId, { 
        source: { ...app.source, image: newImage },
        currentVersion: options.version,
        currentImage: newImage,
      });
      app.source.image = newImage;
      app.currentVersion = options.version;
      app.currentImage = newImage;
    }

    // Set status to deploying
    await appRepo.updateStatus(appId, "deploying");

    // Get existing instances
    const existingInstances = await instanceRepo.getByAppId(appId);

    // In Kamal-style: one instance per server
    const desiredServerIds = new Set(app.serverIds.map(id => id.toString()));
    const existingServerIds = new Set(existingInstances.map(i => i.serverId.toString()));

    const newInstanceIds: ObjectId[] = [];
    const errors: string[] = [];

    try {
      // Create instances for new servers
      for (const serverId of app.serverIds) {
        if (!existingServerIds.has(serverId.toString())) {
          // Calculate port (base port + offset for this server)
          const existingOnServer = existingInstances.filter(
            (inst) => inst.serverId.equals(serverId)
          ).length;
          const port = 3001 + existingOnServer;

          const instanceId = await instanceRepo.add({
            appId: new ObjectId(appId),
            serverId,
            port,
          });

          newInstanceIds.push(instanceId);

          // Deploy container
          const server = await loadServer(serverId);
          const instance = await instanceRepo.getById(instanceId);
          
          if (instance) {
            const result = await dockerExecutor.deployContainer(app, instance, server);
            
            if (result.success) {
              await instanceRepo.updateStatus(instanceId, "running", result.containerId);
            } else {
              await instanceRepo.updateStatus(instanceId, "unhealthy");
              errors.push(`Instance on ${server.host}: ${result.error}`);
            }
          }
        }
      }

      // Redeploy existing instances (for image/config updates)
      for (const instance of existingInstances) {
        if (desiredServerIds.has(instance.serverId.toString())) {
          const server = await loadServer(instance.serverId);
          const result = await dockerExecutor.deployContainer(app, instance, server);
          
          if (result.success) {
            await instanceRepo.updateStatus(instance._id!, "running", result.containerId);
          } else {
            await instanceRepo.updateStatus(instance._id!, "unhealthy");
            errors.push(`Instance on ${server.host}: ${result.error}`);
          }
        }
      }

      // Remove instances from servers no longer in serverIds
      for (const instance of existingInstances) {
        if (!desiredServerIds.has(instance.serverId.toString())) {
          const server = await loadServer(instance.serverId);
          await dockerExecutor.stopContainer(app.name, instance, server);
          await instanceRepo.deleteById(instance._id!);
        }
      }

      // Update app status based on results
      const allInstances = await instanceRepo.getByAppId(appId);
      const runningCount = allInstances.filter((i) => i.status === "running").length;
      const totalCount = app.serverIds.length;
      
      if (runningCount === 0) {
        await appRepo.updateStatus(appId, "failed");
      } else {
        await appRepo.updateStatus(appId, "running");
        if (runningCount < totalCount) {
          logger.log({
            level: "warn",
            message: `App ${app.name} deployed with ${runningCount}/${totalCount} instances`,
          });
        }
      }

      // Sync routing with Caddy
      await syncRouting(appId);

      logger.log({
        level: "info",
        message: `Deployed app ${app.name} with ${runningCount}/${totalCount} instances`,
      });

      return {
        message: `Deployed ${app.name} with ${runningCount}/${totalCount} instances`,
        instances: [...existingInstances.map((i) => i._id!), ...newInstanceIds],
        errors,
      };
    } catch (error: any) {
      // Mark as failed on error
      await appRepo.updateStatus(appId, "failed");

      logger.log({
        level: "error",
        message: `Deploy failed for app ${app.name}: ${error.message}`,
      });

      throw error;
    }
  }

  /**
   * Restart an app
   * Restarts all instances and syncs routing
   */
  async function restart(appId: string | ObjectId): Promise<{ message: string; errors: string[] }> {
    const app = await appRepo.getById(appId);
    if (!app) {
      throw new NotFoundError("App not found");
    }

    await appRepo.updateStatus(appId, "deploying");

    const instances = await instanceRepo.getByAppId(appId);
    const errors: string[] = [];

    for (const instance of instances) {
      await instanceRepo.updateStatus(instance._id!, "starting");
      
      const server = await loadServer(instance.serverId);
      const result = await dockerExecutor.restartContainer(app.name, instance, server);
      
      if (result.success) {
        await instanceRepo.updateStatus(instance._id!, "running");
      } else {
        await instanceRepo.updateStatus(instance._id!, "unhealthy");
        errors.push(`Instance on ${server.host}: ${result.error}`);
      }
    }

    await appRepo.updateStatus(appId, "running");

    // Sync routing (in case any instances changed)
    await syncRouting(appId);

    logger.log({
      level: "info",
      message: `Restarted app ${app.name}`,
    });

    return { message: `Restarted ${app.name}`, errors };
  }

  /**
   * Stop an app
   * Stops all instances and removes routing
   */
  async function stop(appId: string | ObjectId): Promise<{ message: string; errors: string[] }> {
    const app = await appRepo.getById(appId);
    if (!app) {
      throw new NotFoundError("App not found");
    }

    const instances = await instanceRepo.getByAppId(appId);
    const errors: string[] = [];

    for (const instance of instances) {
      const server = await loadServer(instance.serverId);
      const result = await dockerExecutor.stopContainer(app.name, instance, server);
      
      if (!result.success) {
        errors.push(`Instance on ${server.host}: ${result.error}`);
      }
      
      await instanceRepo.updateStatus(instance._id!, "stopped");
    }

    await appRepo.updateStatus(appId, "stopped");

    // Remove routing from Caddy
    await caddyService.removeAppRouting(appId.toString());

    logger.log({
      level: "info",
      message: `Stopped app ${app.name}`,
    });

    return { message: `Stopped ${app.name}`, errors };
  }

  /**
   * Delete an app
   * Removes all instances and routing
   */
  async function deleteApp(appId: string | ObjectId): Promise<{ message: string; errors: string[] }> {
    const app = await appRepo.getById(appId);
    if (!app) {
      throw new NotFoundError("App not found");
    }

    // Stop and delete all instances
    const instances = await instanceRepo.getByAppId(appId);
    const errors: string[] = [];
    
    for (const instance of instances) {
      const server = await loadServer(instance.serverId);
      const result = await dockerExecutor.stopContainer(app.name, instance, server);
      
      if (!result.success) {
        errors.push(`Instance on ${server.host}: ${result.error}`);
      }
      
      await instanceRepo.deleteById(instance._id!);
    }

    // Remove routing from Caddy
    await caddyService.removeAppRouting(appId.toString());

    // Delete the app
    await appRepo.deleteById(appId);

    logger.log({
      level: "info",
      message: `Deleted app ${app.name}`,
    });

    return { message: `Deleted ${app.name}`, errors };
  }

  /**
   * Rebuild all Caddy routes
   * Call on control plane startup
   */
  async function rebuildAllRoutes(): Promise<void> {
    logger.log({
      level: "info",
      message: "Rebuilding all Caddy routes...",
    });

    // Get all running apps
    const { items: apps } = await appRepo.getAll({ limit: 1000 });
    const runningApps = (apps as TApp[]).filter((app) => app.status === "running" && app.proxy?.host);

    if (runningApps.length === 0) {
      logger.log({
        level: "info",
        message: "No running apps with domains to route",
      });
      return;
    }

    // Collect all server IDs
    const allServerIds = new Set<string>();
    for (const app of runningApps) {
      for (const serverId of app.serverIds) {
        allServerIds.add(serverId.toString());
      }
    }

    // Load all servers
    const servers: TServerForCaddy[] = [];
    for (const serverId of allServerIds) {
      const server = await serverRepo.getById(serverId);
      if (server) {
        servers.push({
          _id: server._id!,
          host: server.host,
          privateIp: server.privateIp,
        });
      }
    }

    // Load all instances for running apps
    const allInstances: TInstanceForCaddy[] = [];
    for (const app of runningApps) {
      const instances = await instanceRepo.getByAppId(app._id!);
      allInstances.push(...instancesForCaddy(instances));
    }

    // Rebuild full config
    await caddyService.rebuildFullConfig(
      runningApps.map(appForCaddy),
      allInstances,
      servers
    );

    logger.log({
      level: "info",
      message: `Rebuilt Caddy routes for ${runningApps.length} apps`,
    });
  }

  /**
   * Mark instance as unhealthy and sync routing
   * Called by health check worker
   */
  async function markInstanceUnhealthy(instanceId: string | ObjectId): Promise<void> {
    const instance = await instanceRepo.getById(instanceId);
    if (!instance) return;

    await instanceRepo.updateStatus(instanceId, "unhealthy");
    await syncRouting(instance.appId);
  }

  /**
   * Mark instance as healthy and sync routing
   * Called by health check worker
   */
  async function markInstanceHealthy(instanceId: string | ObjectId): Promise<void> {
    const instance = await instanceRepo.getById(instanceId);
    if (!instance) return;

    await instanceRepo.updateStatus(instanceId, "running");
    await syncRouting(instance.appId);
  }

  return {
    deploy,
    restart,
    stop,
    deleteApp,
    syncRouting,
    rebuildAllRoutes,
    markInstanceUnhealthy,
    markInstanceHealthy,
  };
}
