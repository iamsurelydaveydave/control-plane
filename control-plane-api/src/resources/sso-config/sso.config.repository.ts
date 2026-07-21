import { ObjectId } from "mongodb";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
  logger,
  makeCacheKey,
  useRepo,
  paginate,
} from "../../utils";
import { modelSSOConfig, TSSOConfig, TSSOProvider } from "./sso.config.model";

const namespace_collection = "cp_sso_configs";

export function useSSOConfigRepo() {
  const repo = useRepo(namespace_collection);

  // ---------------------------------------------------------------------------
  // Index Management
  // ---------------------------------------------------------------------------

  async function createIndexes() {
    try {
      await repo.collection.createIndexes([
        // Unique name per organization (or globally if no org)
        { key: { name: 1, organizationId: 1 }, unique: true },
        // Query by provider
        { key: { provider: 1 } },
        // Query by organization
        { key: { organizationId: 1 } },
        // Query enabled configs
        { key: { enabled: 1 } },
        // Compound: enabled configs by organization
        { key: { organizationId: 1, enabled: 1 } },
        // Compound: enabled configs by provider
        { key: { provider: 1, enabled: 1 } },
      ]);
    } catch (error) {
      logger.log({
        level: "error",
        message: `Failed to create SSO config indexes: ${error}`,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // CRUD Operations
  // ---------------------------------------------------------------------------

  async function add(value: Partial<TSSOConfig>) {
    try {
      const config = modelSSOConfig(value);
      const res = await repo.collection.insertOne(config);
      repo.delCachedData();
      return res.insertedId;
    } catch (error: any) {
      logger.log({ level: "error", message: `Failed to add SSO config: ${error}` });

      if (error.message?.includes("duplicate")) {
        throw new BadRequestError("SSO config with this name already exists");
      }

      if (error instanceof BadRequestError) {
        throw error;
      }

      throw new InternalServerError("Failed to create SSO config");
    }
  }

  async function getById(id: string) {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid SSO config ID format");
    }

    const cacheKey = makeCacheKey(namespace_collection, { id, tag: "by-id" });

    try {
      const cached = await repo.getCache<TSSOConfig>(cacheKey);
      if (cached) {
        return cached;
      }

      const config = await repo.collection.findOne<TSSOConfig>({ _id: oid });
      if (!config) {
        throw new NotFoundError("SSO config not found");
      }

      repo.setCache(cacheKey, config, 600).catch((err) => {
        logger.log({
          level: "error",
          message: `Failed to cache SSO config: ${err.message}`,
        });
      });

      return config;
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof BadRequestError) {
        throw error;
      }
      throw new InternalServerError("Failed to get SSO config");
    }
  }

  async function getAll({
    page = 1,
    limit = 20,
    provider,
    enabled,
    organizationId,
  }: {
    page?: number;
    limit?: number;
    provider?: TSSOProvider;
    enabled?: boolean;
    organizationId?: string;
  } = {}) {
    const cacheKey = makeCacheKey(namespace_collection, {
      page,
      limit,
      provider,
      enabled,
      organizationId,
      tag: "getAll",
    });

    try {
      const cached = await repo.getCache<ReturnType<typeof paginate>>(cacheKey);
      if (cached) {
        return cached;
      }

      const query: Record<string, any> = {};
      if (provider) query.provider = provider;
      if (enabled !== undefined) query.enabled = enabled;
      if (organizationId) {
        try {
          query.organizationId = new ObjectId(organizationId);
        } catch {
          throw new BadRequestError("Invalid organizationId format");
        }
      }

      const skip = (page > 0 ? page - 1 : 0) * limit;
      const [items, total] = await Promise.all([
        repo.collection
          .find<TSSOConfig>(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray(),
        repo.collection.countDocuments(query),
      ]);

      const result = paginate(items, page, limit, total);

      repo.setCache(cacheKey, result, 300).catch((err) => {
        logger.log({
          level: "error",
          message: `Failed to cache SSO configs: ${err.message}`,
        });
      });

      return result;
    } catch (error) {
      if (error instanceof BadRequestError) {
        throw error;
      }
      throw new InternalServerError("Failed to get SSO configs");
    }
  }

  async function getEnabledConfigs(organizationId?: string) {
    const cacheKey = makeCacheKey(namespace_collection, {
      organizationId,
      tag: "enabled",
    });

    try {
      const cached = await repo.getCache<TSSOConfig[]>(cacheKey);
      if (cached) {
        return cached;
      }

      const query: Record<string, any> = { enabled: true };
      if (organizationId) {
        try {
          query.organizationId = new ObjectId(organizationId);
        } catch {
          throw new BadRequestError("Invalid organizationId format");
        }
      }

      const configs = await repo.collection
        .find<TSSOConfig>(query)
        .sort({ name: 1 })
        .toArray();

      repo.setCache(cacheKey, configs, 300).catch((err) => {
        logger.log({
          level: "error",
          message: `Failed to cache enabled SSO configs: ${err.message}`,
        });
      });

      return configs;
    } catch (error) {
      if (error instanceof BadRequestError) {
        throw error;
      }
      throw new InternalServerError("Failed to get enabled SSO configs");
    }
  }

  async function updateById(id: string, data: Partial<TSSOConfig>) {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid SSO config ID format");
    }

    // Handle ObjectId conversions
    const updateData: Record<string, any> = { ...data };
    
    if (data.defaultRoleId !== undefined) {
      if (data.defaultRoleId === null) {
        delete updateData.defaultRoleId;
      } else if (typeof data.defaultRoleId === "string") {
        try {
          updateData.defaultRoleId = new ObjectId(data.defaultRoleId);
        } catch {
          throw new BadRequestError("Invalid defaultRoleId format");
        }
      }
    }

    try {
      const updateDoc: any = { $set: { ...updateData, updatedAt: new Date() } };

      // If defaultRoleId is null, unset it
      if (data.defaultRoleId === null) {
        delete updateDoc.$set.defaultRoleId;
        updateDoc.$unset = { defaultRoleId: "" };
      }

      const result = await repo.collection.updateOne({ _id: oid }, updateDoc);

      if (!result.matchedCount) {
        throw new NotFoundError("SSO config not found");
      }

      repo.delCachedData();
      return result;
    } catch (error: any) {
      if (error instanceof NotFoundError || error instanceof BadRequestError) {
        throw error;
      }
      if (error.message?.includes("duplicate")) {
        throw new BadRequestError("SSO config with this name already exists");
      }
      throw new InternalServerError("Failed to update SSO config");
    }
  }

  async function deleteById(id: string) {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid SSO config ID format");
    }

    try {
      const result = await repo.collection.deleteOne({ _id: oid });
      if (!result.deletedCount) {
        throw new NotFoundError("SSO config not found");
      }
      repo.delCachedData();
      return result;
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof BadRequestError) {
        throw error;
      }
      throw new InternalServerError("Failed to delete SSO config");
    }
  }

  async function setEnabled(id: string, enabled: boolean) {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid SSO config ID format");
    }

    try {
      const result = await repo.collection.updateOne(
        { _id: oid },
        { $set: { enabled, updatedAt: new Date() } }
      );

      if (!result.matchedCount) {
        throw new NotFoundError("SSO config not found");
      }

      repo.delCachedData();
      return result;
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof BadRequestError) {
        throw error;
      }
      throw new InternalServerError("Failed to update SSO config status");
    }
  }

  return {
    createIndexes,
    add,
    getById,
    getAll,
    getEnabledConfigs,
    updateById,
    deleteById,
    setEnabled,
  };
}
