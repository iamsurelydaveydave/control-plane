import { useAddonRepo } from "./addon.repository";
import { useHelmService } from "../../services/helm.service";
import {
  TAddon,
  TAddonInput,
  TAddonUpdateInput,
  TAddonType,
  TAddonConnectionInfo,
  ADDON_CATALOG,
  getAddonCatalogEntry,
  schemaAddonUpdate,
} from "./addon.model";
import { BadRequestError, NotFoundError, InternalServerError, AppError } from "../../utils/error";
import { logger } from "../../utils";
import * as crypto from "crypto";

// =============================================================================
// Connection info extractors for each addon type
// =============================================================================

/**
 * Default ports for each addon type
 */
const ADDON_DEFAULT_PORTS: Record<TAddonType, number> = {
  redis: 6379,
  postgresql: 5432,
  mysql: 3306,
  rabbitmq: 5672,
  elasticsearch: 9200,
};

/**
 * Generate a secure random password
 */
function generatePassword(length: number = 24): string {
  return crypto.randomBytes(length).toString("base64").slice(0, length);
}

/**
 * Build connection info based on addon type and Helm values
 */
function buildConnectionInfo(
  addon: TAddon,
  password?: string
): TAddonConnectionInfo {
  const host = `${addon.releaseName}.${addon.namespace}.svc.cluster.local`;
  const port = ADDON_DEFAULT_PORTS[addon.type];

  const baseInfo: TAddonConnectionInfo = {
    host,
    port,
  };

  switch (addon.type) {
    case "redis":
      return {
        ...baseInfo,
        password: password || addon.values?.auth?.password,
      };

    case "postgresql":
      return {
        ...baseInfo,
        username: addon.values?.auth?.username || "postgres",
        password: password || addon.values?.auth?.postgresPassword,
      };

    case "mysql":
      return {
        ...baseInfo,
        username: "root",
        password: password || addon.values?.auth?.rootPassword,
      };

    case "rabbitmq":
      return {
        ...baseInfo,
        port: 5672,
        username: addon.values?.auth?.username || "admin",
        password: password || addon.values?.auth?.password,
      };

    case "elasticsearch":
      return {
        ...baseInfo,
        username: "elastic",
        password: password || addon.values?.auth?.password,
      };

    default:
      return baseInfo;
  }
}

// =============================================================================
// Addon Service
// =============================================================================

export function useAddonService() {
  const repo = useAddonRepo();
  const helm = useHelmService();

  /**
   * Create a new addon and deploy it via Helm.
   */
  async function create(data: TAddonInput): Promise<{ addonId: string; message: string }> {
    // Check Helm availability
    if (!helm.isAvailable()) {
      throw new InternalServerError("Helm is not available. Cannot deploy addons.");
    }

    // Check for existing addon with same name
    const existing = await repo.getByName(data.name, data.organizationId);
    if (existing) {
      throw new BadRequestError(`Addon with name "${data.name}" already exists.`);
    }

    // Create addon record
    const addonId = await repo.add(data);
    const addon = await repo.getById(addonId);
    if (!addon) {
      throw new InternalServerError("Failed to retrieve created addon.");
    }

    // Start async deployment
    deployAddon(addon).catch((error) => {
      logger.log({
        level: "error",
        message: `[Addon] Failed to deploy addon ${addonId}: ${error.message}`,
      });
    });

    return {
      addonId,
      message: `Addon "${addon.name}" created. Deployment in progress.`,
    };
  }

  /**
   * Deploy an addon via Helm (internal async function).
   */
  async function deployAddon(addon: TAddon): Promise<void> {
    const addonId = addon._id!.toString();

    try {
      // Update status to deploying
      await repo.updateStatus(addonId, "deploying");

      const catalogEntry = getAddonCatalogEntry(addon.type);
      const chart = catalogEntry.chart;
      const version = addon.version || catalogEntry.version;

      // Generate password if not provided
      let password: string | undefined;
      const values = { ...addon.values };

      switch (addon.type) {
        case "redis":
          if (!values.auth?.password) {
            password = generatePassword();
            values.auth = { ...values.auth, enabled: true, password };
          }
          break;

        case "postgresql":
          if (!values.auth?.postgresPassword) {
            password = generatePassword();
            values.auth = { ...values.auth, postgresPassword: password };
          }
          break;

        case "mysql":
          if (!values.auth?.rootPassword) {
            password = generatePassword();
            values.auth = { ...values.auth, rootPassword: password };
          }
          break;

        case "rabbitmq":
          if (!values.auth?.password) {
            password = generatePassword();
            values.auth = { ...values.auth, username: values.auth?.username || "admin", password };
          }
          break;

        case "elasticsearch":
          // Elasticsearch doesn't need explicit password for basic setup
          break;
      }

      // Install via Helm
      const result = await helm.install(
        addon.releaseName,
        chart,
        addon.namespace,
        values,
        {
          version,
          createNamespace: true,
          wait: true,
          timeout: "10m",
        }
      );

      // Update addon with connection info and running status
      const connectionInfo = buildConnectionInfo(addon, password);
      await repo.updateConnectionInfo(addonId, connectionInfo);
      await repo.updateById(addonId, { values }); // Store values with generated password
      await repo.updateStatus(addonId, "running");

      logger.log({
        level: "info",
        message: `[Addon] Successfully deployed addon ${addon.name} (${addon.type})`,
      });
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await repo.updateStatus(addonId, "failed", errorMessage);
      logger.log({
        level: "error",
        message: `[Addon] Failed to deploy addon ${addon.name}: ${errorMessage}`,
      });

      // Re-throw for caller if needed
      if (error instanceof AppError) throw error;
      throw new InternalServerError(`Failed to deploy addon: ${errorMessage}`);
    }
  }

  /**
   * Update an addon (triggers Helm upgrade).
   */
  async function update(
    id: string,
    data: TAddonUpdateInput
  ): Promise<{ message: string }> {
    const addon = await repo.getById(id);
    if (!addon) {
      throw new NotFoundError("Addon not found.");
    }

    // Validate update data
    const { error, value } = schemaAddonUpdate.validate(data, { stripUnknown: true });
    if (error) {
      throw new BadRequestError(error.message);
    }

    // Check Helm availability for value/version updates
    const needsHelmUpgrade = value.values || value.version;
    if (needsHelmUpgrade && !helm.isAvailable()) {
      throw new InternalServerError("Helm is not available. Cannot update addon.");
    }

    // Update name if changed
    if (value.name && value.name !== addon.name) {
      // Check for conflicts
      const existing = await repo.getByName(value.name, addon.organizationId?.toString());
      if (existing && existing._id?.toString() !== id) {
        throw new BadRequestError(`Addon with name "${value.name}" already exists.`);
      }
    }

    // Prepare updated values
    const updatedValues = value.values
      ? { ...addon.values, ...value.values }
      : addon.values;

    const updatedVersion = value.version || addon.version;

    // Update the record first
    await repo.updateById(id, {
      ...(value.name && { name: value.name }),
      ...(value.values && { values: updatedValues }),
      ...(value.version && { version: updatedVersion }),
    });

    // Trigger Helm upgrade if needed
    if (needsHelmUpgrade) {
      // Update status to deploying
      await repo.updateStatus(id, "deploying");

      // Run upgrade async
      upgradeAddon(addon, updatedValues, updatedVersion).catch((error) => {
        logger.log({
          level: "error",
          message: `[Addon] Failed to upgrade addon ${id}: ${error.message}`,
        });
      });

      return {
        message: `Addon "${addon.name}" update in progress.`,
      };
    }

    return {
      message: `Addon "${addon.name}" updated.`,
    };
  }

  /**
   * Upgrade an addon via Helm (internal async function).
   */
  async function upgradeAddon(
    addon: TAddon,
    values: Record<string, any>,
    version: string
  ): Promise<void> {
    const addonId = addon._id!.toString();

    try {
      const catalogEntry = getAddonCatalogEntry(addon.type);
      const chart = catalogEntry.chart;

      await helm.upgrade(
        addon.releaseName,
        chart,
        addon.namespace,
        values,
        {
          version,
          wait: true,
          timeout: "10m",
        }
      );

      await repo.updateStatus(addonId, "running");

      logger.log({
        level: "info",
        message: `[Addon] Successfully upgraded addon ${addon.name}`,
      });
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await repo.updateStatus(addonId, "failed", errorMessage);
      logger.log({
        level: "error",
        message: `[Addon] Failed to upgrade addon ${addon.name}: ${errorMessage}`,
      });
    }
  }

  /**
   * Delete an addon and uninstall the Helm release.
   */
  async function remove(id: string): Promise<{ message: string }> {
    const addon = await repo.getById(id);
    if (!addon) {
      throw new NotFoundError("Addon not found.");
    }

    // Update status to deleting
    await repo.updateStatus(id, "deleting");

    try {
      // Uninstall Helm release
      if (helm.isAvailable()) {
        await helm.uninstall(addon.releaseName, addon.namespace);
      }

      // Delete from database
      await repo.deleteById(id);

      logger.log({
        level: "info",
        message: `[Addon] Deleted addon ${addon.name}`,
      });

      return {
        message: `Addon "${addon.name}" deleted.`,
      };
    } catch (error: any) {
      // If Helm uninstall fails, still try to delete from DB
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.log({
        level: "warn",
        message: `[Addon] Helm uninstall failed for ${addon.name}, proceeding with DB deletion: ${errorMessage}`,
      });

      await repo.deleteById(id);

      return {
        message: `Addon "${addon.name}" deleted (Helm uninstall may have failed).`,
      };
    }
  }

  /**
   * Get connection info for an addon (sensitive operation).
   */
  async function getConnectionInfo(id: string): Promise<TAddonConnectionInfo | null> {
    const addon = await repo.getById(id);
    if (!addon) {
      throw new NotFoundError("Addon not found.");
    }

    if (!addon.connectionInfo) {
      return null;
    }

    return addon.connectionInfo;
  }

  /**
   * Refresh addon status by checking Helm release status.
   */
  async function refreshStatus(id: string): Promise<{ status: string }> {
    const addon = await repo.getById(id);
    if (!addon) {
      throw new NotFoundError("Addon not found.");
    }

    if (!helm.isAvailable()) {
      return { status: addon.status };
    }

    try {
      const releaseStatus = await helm.status(addon.releaseName, addon.namespace);

      if (!releaseStatus) {
        // Release not found — mark as failed if it was supposed to be running
        if (addon.status === "running") {
          await repo.updateStatus(id, "failed", "Helm release not found");
        }
        return { status: "failed" };
      }

      // Map Helm status to addon status
      let newStatus = addon.status;
      switch (releaseStatus.status) {
        case "deployed":
          newStatus = "running";
          break;
        case "pending-install":
        case "pending-upgrade":
        case "pending-rollback":
          newStatus = "deploying";
          break;
        case "failed":
          newStatus = "failed";
          break;
        case "uninstalling":
          newStatus = "deleting";
          break;
      }

      if (newStatus !== addon.status) {
        await repo.updateStatus(id, newStatus);
      }

      return { status: newStatus };
    } catch (error: any) {
      logger.log({
        level: "warn",
        message: `[Addon] Failed to refresh status for ${addon.name}: ${error.message}`,
      });
      return { status: addon.status };
    }
  }

  /**
   * Get the addon catalog (available types and their info).
   */
  function getCatalog() {
    return Object.entries(ADDON_CATALOG).map(([type, info]) => ({
      type,
      chart: info.chart,
      version: info.version,
      defaultPort: ADDON_DEFAULT_PORTS[type as TAddonType],
    }));
  }

  /**
   * Sync addon status with Helm for all deployed addons.
   * Used by scheduled tasks.
   */
  async function syncAllStatuses(): Promise<{ synced: number; errors: number }> {
    let synced = 0;
    let errors = 0;

    const addons = await repo.getByStatus("running");
    addons.push(...(await repo.getByStatus("deploying")));

    for (const addon of addons) {
      try {
        await refreshStatus(addon._id!.toString());
        synced++;
      } catch (error) {
        errors++;
      }
    }

    return { synced, errors };
  }

  return {
    create,
    update,
    remove,
    getConnectionInfo,
    refreshStatus,
    getCatalog,
    syncAllStatuses,
  };
}
