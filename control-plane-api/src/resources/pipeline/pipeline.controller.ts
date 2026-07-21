import { Request, Response, NextFunction } from "express";
import { usePipelineRepo, usePromotionRepo } from "./pipeline.repository";
import { usePipelineService } from "./pipeline.service";
import {
  schemaPipelineCreate,
  schemaPipelineUpdate,
  schemaPromotionCreate,
  schemaPromotionReject,
  schemaDeployToStage,
  schemaRollback,
  TPipelineStatus,
  TStageName,
  stageNames,
} from "./pipeline.model";
import { BadRequestError, NotFoundError } from "../../utils";

// =============================================================================
// Pipeline Controller
// =============================================================================

export function usePipelineController() {
  const pipelineRepo = usePipelineRepo();
  const promotionRepo = usePromotionRepo();
  const pipelineService = usePipelineService();

  // ---------------------------------------------------------------------------
  // Pipeline CRUD
  // ---------------------------------------------------------------------------

  async function list(req: Request, res: Response, next: NextFunction) {
    try {
      const { search, page, limit, status, organizationId } = req.query;

      const data = await pipelineRepo.getAll({
        search: search as string,
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 10,
        status: status as TPipelineStatus | undefined,
        organizationId: organizationId as string | undefined,
      });

      res.json(data);
    } catch (error) {
      next(error);
    }
  }

  async function create(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaPipelineCreate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const pipelineId = await pipelineService.create(value);

      res.status(201).json({
        message: "Pipeline created.",
        pipelineId,
      });
    } catch (error) {
      next(error);
    }
  }

  async function getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      const pipeline = await pipelineRepo.getById(id);
      if (!pipeline) {
        next(new NotFoundError("Pipeline not found."));
        return;
      }

      res.json({ pipeline });
    } catch (error) {
      next(error);
    }
  }

  async function update(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      const { error, value } = schemaPipelineUpdate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      await pipelineRepo.updateById(id, value);

      res.json({ message: "Pipeline updated." });
    } catch (error) {
      next(error);
    }
  }

  async function remove(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      await pipelineService.deletePipeline(id);

      res.json({ message: "Pipeline deleted." });
    } catch (error) {
      next(error);
    }
  }

  async function getStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      const status = await pipelineService.getPipelineStatus(id);

      res.json(status);
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Stage Operations
  // ---------------------------------------------------------------------------

  async function setupStages(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      await pipelineService.setupStages(id);

      res.json({ message: "Stages configured." });
    } catch (error) {
      next(error);
    }
  }

  async function deployToStage(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const stage = req.params.stage as string;

      if (!stageNames.includes(stage as TStageName)) {
        next(new BadRequestError(`Invalid stage: ${stage}. Must be one of: ${stageNames.join(", ")}`));
        return;
      }

      const { error, value } = schemaDeployToStage.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      await pipelineService.deployToStage(id, stage as TStageName, value.version);

      res.json({
        message: `Deployed version ${value.version} to ${stage}.`,
        pipelineId: id,
        stage,
        version: value.version,
      });
    } catch (error) {
      next(error);
    }
  }

  async function rollbackStage(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const stage = req.params.stage as string;

      if (!stageNames.includes(stage as TStageName)) {
        next(new BadRequestError(`Invalid stage: ${stage}. Must be one of: ${stageNames.join(", ")}`));
        return;
      }

      const { error, value } = schemaRollback.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      await pipelineService.rollback(id, stage as TStageName, value.version);

      res.json({
        message: `Rolled back ${stage} to version ${value.version}.`,
        pipelineId: id,
        stage,
        version: value.version,
      });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Promotions
  // ---------------------------------------------------------------------------

  async function requestPromotion(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const userId = (req as any).user?.id || (req as any).user?._id;

      if (!userId) {
        next(new BadRequestError("User ID not found in request."));
        return;
      }

      const { error, value } = schemaPromotionCreate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const promotionId = await pipelineService.requestPromotion(
        id,
        value.fromStage,
        value.toStage,
        userId.toString(),
        value.version,
        value.notes
      );

      res.status(201).json({
        message: "Promotion requested.",
        promotionId,
        pipelineId: id,
        fromStage: value.fromStage,
        toStage: value.toStage,
      });
    } catch (error) {
      next(error);
    }
  }

  async function listPromotions(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { page, limit, status } = req.query;

      const data = await promotionRepo.getByPipelineId(id, {
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 10,
        status: status as any,
      });

      res.json(data);
    } catch (error) {
      next(error);
    }
  }

  async function approvePromotion(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const userId = (req as any).user?.id || (req as any).user?._id;

      if (!userId) {
        next(new BadRequestError("User ID not found in request."));
        return;
      }

      await pipelineService.approvePromotion(id, userId.toString());

      res.json({
        message: "Promotion approved and deployment initiated.",
        promotionId: id,
      });
    } catch (error) {
      next(error);
    }
  }

  async function rejectPromotion(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const userId = (req as any).user?.id || (req as any).user?._id;

      if (!userId) {
        next(new BadRequestError("User ID not found in request."));
        return;
      }

      const { error, value } = schemaPromotionReject.validate(req.body || {});
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      await pipelineService.rejectPromotion(id, userId.toString(), value.reason);

      res.json({
        message: "Promotion rejected.",
        promotionId: id,
      });
    } catch (error) {
      next(error);
    }
  }

  async function getPromotion(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      const promotion = await promotionRepo.getById(id);
      if (!promotion) {
        next(new NotFoundError("Promotion not found."));
        return;
      }

      res.json({ promotion });
    } catch (error) {
      next(error);
    }
  }

  return {
    // Pipeline CRUD
    list,
    create,
    getById,
    update,
    remove,
    getStatus,

    // Stage operations
    setupStages,
    deployToStage,
    rollbackStage,

    // Promotions
    requestPromotion,
    listPromotions,
    approvePromotion,
    rejectPromotion,
    getPromotion,
  };
}
