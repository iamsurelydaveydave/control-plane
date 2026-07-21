import { ObjectId } from "mongodb";
import {
  TPipeline,
  TPipelineStatus,
  TPromotion,
  TPromotionStatus,
  TStageName,
  TStageStatus,
  modelPipeline,
  modelPromotion,
  TPipelineCreate,
  TPipelineUpdate,
  TPromotionCreate,
} from "./pipeline.model";
import {
  BadRequestError,
  NotFoundError,
  InternalServerError,
  logger,
  makeCacheKey,
  paginate,
  useRepo,
  escapeRegex,
} from "../../utils";

// =============================================================================
// Pipeline Repository
// =============================================================================

const PIPELINE_COLLECTION = "cp_pipelines";

export function usePipelineRepo() {
  const pipelineRepo = useRepo(PIPELINE_COLLECTION);
  // ---------------------------------------------------------------------------
  // Indexes
  // ---------------------------------------------------------------------------

  async function createIndexes() {
    try {
      await pipelineRepo.collection.createIndexes([
        { key: { name: "text" } },
        { key: { name: 1 }, unique: true },
        { key: { status: 1 } },
        { key: { organizationId: 1 }, sparse: true },
        { key: { "source.type": 1 } },
        { key: { "stages.name": 1 } },
        { key: { "stages.appId": 1 }, sparse: true },
        { key: { promotionStrategy: 1 } },
        { key: { createdAt: -1 } },
      ]);
    } catch (error) {
      logger.log({
        level: "error",
        message: `Failed to create pipeline indexes: ${error}`,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  async function add(data: TPipelineCreate): Promise<string> {
    try {
      const pipeline = modelPipeline(data);
      const result = await pipelineRepo.collection.insertOne(pipeline);
      pipelineRepo.delCachedData();
      return result.insertedId.toString();
    } catch (error: any) {
      logger.log({ level: "error", message: `Failed to create pipeline: ${error}` });

      if (error.message?.includes("duplicate")) {
        throw new BadRequestError("Pipeline with this name already exists.");
      }

      if (error instanceof BadRequestError) throw error;
      throw new InternalServerError("Failed to create pipeline.");
    }
  }

  async function getById(id: string): Promise<TPipeline | null> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid pipeline ID format.");
    }

    const cacheKey = makeCacheKey(PIPELINE_COLLECTION, { _id: id, tag: "by-id" });

    try {
      const cached = await pipelineRepo.getCache<TPipeline>(cacheKey);
      if (cached) return cached;

      const pipeline = await pipelineRepo.collection.findOne<TPipeline>({ _id: oid });

      if (pipeline) {
        pipelineRepo.setCache(cacheKey, pipeline, 300).catch((err) => {
          logger.log({
            level: "error",
            message: `Failed to set cache for pipeline by id: ${err.message}`,
          });
        });
      }

      return pipeline;
    } catch (error) {
      if (error instanceof BadRequestError) throw error;
      throw new InternalServerError("Failed to get pipeline by ID.");
    }
  }

  async function getByName(name: string): Promise<TPipeline | null> {
    const cacheKey = makeCacheKey(PIPELINE_COLLECTION, { name, tag: "by-name" });

    try {
      const cached = await pipelineRepo.getCache<TPipeline>(cacheKey);
      if (cached) return cached;

      const pipeline = await pipelineRepo.collection.findOne<TPipeline>({ name });

      if (pipeline) {
        pipelineRepo.setCache(cacheKey, pipeline, 300).catch((err) => {
          logger.log({
            level: "error",
            message: `Failed to set cache for pipeline by name: ${err.message}`,
          });
        });
      }

      return pipeline;
    } catch (error) {
      throw new InternalServerError("Failed to get pipeline by name.");
    }
  }

  async function getAll({
    search = "",
    page = 1,
    limit = 10,
    status,
    organizationId,
  }: {
    search?: string;
    page?: number;
    limit?: number;
    status?: TPipelineStatus;
    organizationId?: string;
  } = {}) {
    page = page > 0 ? page - 1 : 0;

    const query: Record<string, any> = {};

    if (search) {
      query.name = { $regex: escapeRegex(search), $options: "i" };
    }

    if (status) {
      query.status = status;
    }

    if (organizationId) {
      try {
        query.organizationId = new ObjectId(organizationId);
      } catch {
        throw new BadRequestError("Invalid organization ID format.");
      }
    }

    const cacheKey = makeCacheKey(PIPELINE_COLLECTION, {
      search,
      page,
      limit,
      status: status ?? "",
      organizationId: organizationId ?? "",
      tag: "getAll",
    });

    try {
      const cached = await pipelineRepo.getCache<Record<string, any>>(cacheKey);
      if (cached) return cached;

      const items = await pipelineRepo.collection
        .aggregate([
          { $match: query },
          { $sort: { createdAt: -1 } },
          { $skip: page * limit },
          { $limit: limit },
        ])
        .toArray();

      const length = await pipelineRepo.collection.countDocuments(query);
      const data = paginate(items, page, limit, length);

      pipelineRepo.setCache(cacheKey, data, 300).catch((err) => {
        logger.log({
          level: "error",
          message: `Failed to set cache for pipelines getAll: ${err.message}`,
        });
      });

      return data;
    } catch (error) {
      if (error instanceof BadRequestError) throw error;
      logger.log({ level: "error", message: `${error}` });
      throw new InternalServerError("Failed to get pipelines.");
    }
  }

  async function updateById(id: string, data: TPipelineUpdate): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid pipeline ID format.");
    }

    try {
      const update: Record<string, any> = { ...data, updatedAt: new Date() };

      // Handle stages update with approver ID conversion
      if (data.stages) {
        update.stages = data.stages.map((stage) => ({
          ...stage,
          status: "pending" as TStageStatus,
          approvers: stage.approvers?.map((approverId) => {
            try {
              return new ObjectId(approverId);
            } catch {
              throw new BadRequestError(`Invalid approver ID format: ${approverId}`);
            }
          }),
        }));
      }

      const result = await pipelineRepo.collection.updateOne(
        { _id: oid },
        { $set: update }
      );

      if (result.matchedCount === 0) {
        throw new NotFoundError("Pipeline not found.");
      }

      pipelineRepo.delCachedData();
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof BadRequestError) throw error;
      throw new InternalServerError("Failed to update pipeline.");
    }
  }

  async function deleteById(id: string): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid pipeline ID format.");
    }

    try {
      const result = await pipelineRepo.collection.deleteOne({ _id: oid });

      if (result.deletedCount === 0) {
        throw new NotFoundError("Pipeline not found.");
      }

      pipelineRepo.delCachedData();
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof BadRequestError) throw error;
      throw new InternalServerError("Failed to delete pipeline.");
    }
  }

  // ---------------------------------------------------------------------------
  // Stage Operations
  // ---------------------------------------------------------------------------

  async function updateStage(
    pipelineId: string,
    stageName: TStageName,
    update: Partial<{
      appId: ObjectId;
      lastDeployedVersion: string;
      lastDeployedAt: Date;
      status: TStageStatus;
    }>
  ): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(pipelineId);
    } catch {
      throw new BadRequestError("Invalid pipeline ID format.");
    }

    try {
      const setFields: Record<string, any> = { updatedAt: new Date() };

      if (update.appId !== undefined) setFields["stages.$.appId"] = update.appId;
      if (update.lastDeployedVersion !== undefined) setFields["stages.$.lastDeployedVersion"] = update.lastDeployedVersion;
      if (update.lastDeployedAt !== undefined) setFields["stages.$.lastDeployedAt"] = update.lastDeployedAt;
      if (update.status !== undefined) setFields["stages.$.status"] = update.status;

      const result = await pipelineRepo.collection.updateOne(
        { _id: oid, "stages.name": stageName },
        { $set: setFields }
      );

      if (result.matchedCount === 0) {
        throw new NotFoundError("Pipeline or stage not found.");
      }

      pipelineRepo.delCachedData();
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof BadRequestError) throw error;
      throw new InternalServerError("Failed to update pipeline stage.");
    }
  }

  async function getStage(pipelineId: string, stageName: TStageName) {
    const pipeline = await getById(pipelineId);
    if (!pipeline) {
      throw new NotFoundError("Pipeline not found.");
    }

    const stage = pipeline.stages.find((s) => s.name === stageName);
    if (!stage) {
      throw new NotFoundError(`Stage ${stageName} not found in pipeline.`);
    }

    return { pipeline, stage };
  }

  return {
    createIndexes,
    add,
    getById,
    getByName,
    getAll,
    updateById,
    deleteById,
    updateStage,
    getStage,
  };
}

// =============================================================================
// Promotion Repository
// =============================================================================

const PROMOTION_COLLECTION = "cp_promotions";

export function usePromotionRepo() {
  const promotionRepo = useRepo(PROMOTION_COLLECTION);
  // ---------------------------------------------------------------------------
  // Indexes
  // ---------------------------------------------------------------------------

  async function createIndexes() {
    try {
      await promotionRepo.collection.createIndexes([
        { key: { pipelineId: 1, status: 1 } },
        { key: { pipelineId: 1, createdAt: -1 } },
        { key: { status: 1 } },
        { key: { requestedBy: 1 } },
        { key: { fromStage: 1, toStage: 1 } },
        { key: { createdAt: -1 } },
      ]);
    } catch (error) {
      logger.log({
        level: "error",
        message: `Failed to create promotion indexes: ${error}`,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  async function add(data: TPromotionCreate): Promise<string> {
    try {
      const promotion = modelPromotion(data);
      const result = await promotionRepo.collection.insertOne(promotion);
      promotionRepo.delCachedData();
      return result.insertedId.toString();
    } catch (error: any) {
      logger.log({ level: "error", message: `Failed to create promotion: ${error}` });

      if (error instanceof BadRequestError) throw error;
      throw new InternalServerError("Failed to create promotion.");
    }
  }

  async function getById(id: string): Promise<TPromotion | null> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid promotion ID format.");
    }

    const cacheKey = makeCacheKey(PROMOTION_COLLECTION, { _id: id, tag: "by-id" });

    try {
      const cached = await promotionRepo.getCache<TPromotion>(cacheKey);
      if (cached) return cached;

      const promotion = await promotionRepo.collection.findOne<TPromotion>({ _id: oid });

      if (promotion) {
        promotionRepo.setCache(cacheKey, promotion, 300).catch((err) => {
          logger.log({
            level: "error",
            message: `Failed to set cache for promotion by id: ${err.message}`,
          });
        });
      }

      return promotion;
    } catch (error) {
      if (error instanceof BadRequestError) throw error;
      throw new InternalServerError("Failed to get promotion by ID.");
    }
  }

  async function getByPipelineId(
    pipelineId: string,
    {
      page = 1,
      limit = 10,
      status,
    }: {
      page?: number;
      limit?: number;
      status?: TPromotionStatus;
    } = {}
  ) {
    let oid: ObjectId;
    try {
      oid = new ObjectId(pipelineId);
    } catch {
      throw new BadRequestError("Invalid pipeline ID format.");
    }

    page = page > 0 ? page - 1 : 0;

    const query: Record<string, any> = { pipelineId: oid };
    if (status) {
      query.status = status;
    }

    const cacheKey = makeCacheKey(PROMOTION_COLLECTION, {
      pipelineId,
      page,
      limit,
      status: status ?? "",
      tag: "by-pipeline",
    });

    try {
      const cached = await promotionRepo.getCache<Record<string, any>>(cacheKey);
      if (cached) return cached;

      const items = await promotionRepo.collection
        .aggregate([
          { $match: query },
          { $sort: { createdAt: -1 } },
          { $skip: page * limit },
          { $limit: limit },
        ])
        .toArray();

      const length = await promotionRepo.collection.countDocuments(query);
      const data = paginate(items, page, limit, length);

      promotionRepo.setCache(cacheKey, data, 300).catch((err) => {
        logger.log({
          level: "error",
          message: `Failed to set cache for promotions by pipeline: ${err.message}`,
        });
      });

      return data;
    } catch (error) {
      if (error instanceof BadRequestError) throw error;
      logger.log({ level: "error", message: `${error}` });
      throw new InternalServerError("Failed to get promotions.");
    }
  }

  async function getPendingByPipelineAndStages(
    pipelineId: string,
    fromStage: TStageName,
    toStage: TStageName
  ): Promise<TPromotion | null> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(pipelineId);
    } catch {
      throw new BadRequestError("Invalid pipeline ID format.");
    }

    try {
      return await promotionRepo.collection.findOne<TPromotion>({
        pipelineId: oid,
        fromStage,
        toStage,
        status: "pending",
      });
    } catch (error) {
      throw new InternalServerError("Failed to check for pending promotion.");
    }
  }

  async function updateById(
    id: string,
    update: Partial<{
      status: TPromotionStatus;
      approvedBy: ObjectId;
      approvedAt: Date;
      rejectedBy: ObjectId;
      rejectedAt: Date;
      rejectionReason: string;
      deployedAt: Date;
    }>
  ): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid promotion ID format.");
    }

    try {
      const result = await promotionRepo.collection.updateOne(
        { _id: oid },
        { $set: update }
      );

      if (result.matchedCount === 0) {
        throw new NotFoundError("Promotion not found.");
      }

      promotionRepo.delCachedData();
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof BadRequestError) throw error;
      throw new InternalServerError("Failed to update promotion.");
    }
  }

  async function deleteByPipelineId(pipelineId: string): Promise<number> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(pipelineId);
    } catch {
      throw new BadRequestError("Invalid pipeline ID format.");
    }

    try {
      const result = await promotionRepo.collection.deleteMany({ pipelineId: oid });
      promotionRepo.delCachedData();
      return result.deletedCount;
    } catch (error) {
      throw new InternalServerError("Failed to delete promotions for pipeline.");
    }
  }

  return {
    createIndexes,
    add,
    getById,
    getByPipelineId,
    getPendingByPipelineAndStages,
    updateById,
    deleteByPipelineId,
  };
}
