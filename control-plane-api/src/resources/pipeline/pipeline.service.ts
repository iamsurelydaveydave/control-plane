import { ObjectId } from "mongodb";
import { usePipelineRepo, usePromotionRepo } from "./pipeline.repository";
import {
  TPipeline,
  TPipelineCreate,
  TStageName,
  stageNames,
} from "./pipeline.model";
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  logger,
} from "../../utils";

// =============================================================================
// Pipeline Service
// =============================================================================

export function usePipelineService() {
  const pipelineRepo = usePipelineRepo();
  const promotionRepo = usePromotionRepo();

  // ---------------------------------------------------------------------------
  // Pipeline Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Create a new pipeline with default stages.
   */
  async function create(data: TPipelineCreate): Promise<string> {
    logger.log({
      level: "info",
      message: `Creating pipeline: ${data.name}`,
    });

    const pipelineId = await pipelineRepo.add(data);

    logger.log({
      level: "info",
      message: `Pipeline created: ${pipelineId}`,
    });

    return pipelineId;
  }

  /**
   * Set up namespaces and apps for all stages of a pipeline.
   * This would integrate with K8s to create actual namespaces.
   */
  async function setupStages(pipelineId: string): Promise<void> {
    const pipeline = await pipelineRepo.getById(pipelineId);
    if (!pipeline) {
      throw new NotFoundError("Pipeline not found.");
    }

    logger.log({
      level: "info",
      message: `Setting up stages for pipeline: ${pipeline.name}`,
    });

    // TODO: Integrate with K8s service to create namespaces
    // For each stage:
    // 1. Create the namespace if it doesn't exist
    // 2. Set up necessary RBAC
    // 3. Create app deployment configurations

    for (const stage of pipeline.stages) {
      logger.log({
        level: "info",
        message: `Setting up stage ${stage.name} in namespace ${stage.namespace}`,
      });

      // Here we would call:
      // - k8sService.createNamespace(stage.namespace)
      // - k8sService.setupRBAC(stage.namespace)
      // - appService.createSkeleton(pipelineId, stage.name)

      // For now, just mark as pending
      await pipelineRepo.updateStage(pipelineId, stage.name, {
        status: "pending",
      });
    }

    logger.log({
      level: "info",
      message: `Stage setup complete for pipeline: ${pipeline.name}`,
    });
  }

  // ---------------------------------------------------------------------------
  // Deployments
  // ---------------------------------------------------------------------------

  /**
   * Deploy a specific version to a stage.
   */
  async function deployToStage(
    pipelineId: string,
    stage: TStageName,
    version: string
  ): Promise<void> {
    const { pipeline, stage: targetStage } = await pipelineRepo.getStage(pipelineId, stage);

    logger.log({
      level: "info",
      message: `Deploying version ${version} to ${stage} for pipeline ${pipeline.name}`,
    });

    // Check if there's already a deployment in progress
    if (targetStage.status === "deployed" && targetStage.lastDeployedVersion === version) {
      throw new BadRequestError(`Version ${version} is already deployed to ${stage}.`);
    }

    // TODO: Integrate with K8s/app service to actually deploy
    // - Get or create the app for this stage
    // - Update the app's image version
    // - Trigger deployment

    // For now, just update the stage status
    await pipelineRepo.updateStage(pipelineId, stage, {
      lastDeployedVersion: version,
      lastDeployedAt: new Date(),
      status: "deployed",
    });

    logger.log({
      level: "info",
      message: `Deployment of ${version} to ${stage} complete for pipeline ${pipeline.name}`,
    });

    // Check for auto-promotion
    if (targetStage.autoPromote) {
      const nextStageIndex = stageNames.indexOf(stage) + 1;
      if (nextStageIndex < stageNames.length) {
        const nextStage = stageNames[nextStageIndex];
        const nextStageConfig = pipeline.stages.find((s) => s.name === nextStage);

        if (nextStageConfig && !nextStageConfig.approvalRequired) {
          logger.log({
            level: "info",
            message: `Auto-promoting ${version} from ${stage} to ${nextStage}`,
          });

          // Auto-promote if no approval required
          await deployToStage(pipelineId, nextStage, version);
        } else {
          logger.log({
            level: "info",
            message: `Auto-promotion to ${nextStage} requires approval`,
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Promotions
  // ---------------------------------------------------------------------------

  /**
   * Request a promotion from one stage to another.
   */
  async function requestPromotion(
    pipelineId: string,
    fromStage: TStageName,
    toStage: TStageName,
    requestedBy: string,
    version?: string,
    notes?: string
  ): Promise<string> {
    const { pipeline, stage: sourceStage } = await pipelineRepo.getStage(pipelineId, fromStage);

    // Get target stage config
    const targetStage = pipeline.stages.find((s) => s.name === toStage);
    if (!targetStage) {
      throw new NotFoundError(`Stage ${toStage} not found in pipeline.`);
    }

    // Validate the source stage has a deployed version
    if (sourceStage.status !== "deployed" || !sourceStage.lastDeployedVersion) {
      throw new BadRequestError(`Stage ${fromStage} does not have a deployed version to promote.`);
    }

    const promotionVersion = version || sourceStage.lastDeployedVersion;

    // Check for existing pending promotion
    const existingPromotion = await promotionRepo.getPendingByPipelineAndStages(
      pipelineId,
      fromStage,
      toStage
    );

    if (existingPromotion) {
      throw new BadRequestError(
        `A promotion from ${fromStage} to ${toStage} is already pending.`
      );
    }

    logger.log({
      level: "info",
      message: `Requesting promotion of ${promotionVersion} from ${fromStage} to ${toStage} for pipeline ${pipeline.name}`,
    });

    const promotionId = await promotionRepo.add({
      pipelineId,
      fromStage,
      toStage,
      version: promotionVersion,
      requestedBy,
      notes,
    });

    // If no approval required, auto-approve and execute
    if (!targetStage.approvalRequired) {
      logger.log({
        level: "info",
        message: `No approval required for ${toStage}, auto-approving`,
      });

      await promotionRepo.updateById(promotionId, {
        status: "approved",
        approvedBy: new ObjectId(requestedBy),
        approvedAt: new Date(),
      });

      await executePromotion(promotionId);
    }

    return promotionId;
  }

  /**
   * Approve a pending promotion.
   */
  async function approvePromotion(promotionId: string, userId: string): Promise<void> {
    const promotion = await promotionRepo.getById(promotionId);
    if (!promotion) {
      throw new NotFoundError("Promotion not found.");
    }

    if (promotion.status !== "pending") {
      throw new BadRequestError(`Promotion is not pending (status: ${promotion.status}).`);
    }

    // Check if user is an approver for the target stage
    const { pipeline, stage: targetStage } = await pipelineRepo.getStage(
      promotion.pipelineId.toString(),
      promotion.toStage
    );

    if (targetStage.approvers && targetStage.approvers.length > 0) {
      const userOid = new ObjectId(userId);
      const isApprover = targetStage.approvers.some((a) => a.equals(userOid));

      if (!isApprover) {
        throw new ForbiddenError("You are not authorized to approve this promotion.");
      }
    }

    logger.log({
      level: "info",
      message: `Approving promotion ${promotionId} for pipeline ${pipeline.name}`,
    });

    await promotionRepo.updateById(promotionId, {
      status: "approved",
      approvedBy: new ObjectId(userId),
      approvedAt: new Date(),
    });

    // Execute the promotion
    await executePromotion(promotionId);
  }

  /**
   * Reject a pending promotion.
   */
  async function rejectPromotion(
    promotionId: string,
    userId: string,
    reason?: string
  ): Promise<void> {
    const promotion = await promotionRepo.getById(promotionId);
    if (!promotion) {
      throw new NotFoundError("Promotion not found.");
    }

    if (promotion.status !== "pending") {
      throw new BadRequestError(`Promotion is not pending (status: ${promotion.status}).`);
    }

    // Check if user is an approver for the target stage
    const { pipeline, stage: targetStage } = await pipelineRepo.getStage(
      promotion.pipelineId.toString(),
      promotion.toStage
    );

    if (targetStage.approvers && targetStage.approvers.length > 0) {
      const userOid = new ObjectId(userId);
      const isApprover = targetStage.approvers.some((a) => a.equals(userOid));

      if (!isApprover) {
        throw new ForbiddenError("You are not authorized to reject this promotion.");
      }
    }

    logger.log({
      level: "info",
      message: `Rejecting promotion ${promotionId} for pipeline ${pipeline.name}: ${reason || "No reason provided"}`,
    });

    await promotionRepo.updateById(promotionId, {
      status: "rejected",
      rejectedBy: new ObjectId(userId),
      rejectedAt: new Date(),
      rejectionReason: reason,
    });
  }

  /**
   * Execute an approved promotion (deploy to target stage).
   */
  async function executePromotion(promotionId: string): Promise<void> {
    const promotion = await promotionRepo.getById(promotionId);
    if (!promotion) {
      throw new NotFoundError("Promotion not found.");
    }

    if (promotion.status !== "approved") {
      throw new BadRequestError(`Promotion must be approved before execution (status: ${promotion.status}).`);
    }

    const pipeline = await pipelineRepo.getById(promotion.pipelineId.toString());
    if (!pipeline) {
      throw new NotFoundError("Pipeline not found.");
    }

    logger.log({
      level: "info",
      message: `Executing promotion ${promotionId}: deploying ${promotion.version} to ${promotion.toStage}`,
    });

    try {
      await deployToStage(
        promotion.pipelineId.toString(),
        promotion.toStage,
        promotion.version
      );

      await promotionRepo.updateById(promotionId, {
        status: "deployed",
        deployedAt: new Date(),
      });

      logger.log({
        level: "info",
        message: `Promotion ${promotionId} executed successfully`,
      });
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `Promotion ${promotionId} failed: ${error.message}`,
      });

      await promotionRepo.updateById(promotionId, {
        status: "failed",
      });

      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Rollback
  // ---------------------------------------------------------------------------

  /**
   * Rollback a stage to a previous version.
   */
  async function rollback(
    pipelineId: string,
    stage: TStageName,
    version: string
  ): Promise<void> {
    const { pipeline, stage: targetStage } = await pipelineRepo.getStage(pipelineId, stage);

    if (targetStage.status !== "deployed") {
      throw new BadRequestError(`Stage ${stage} is not currently deployed.`);
    }

    if (targetStage.lastDeployedVersion === version) {
      throw new BadRequestError(`Version ${version} is already deployed to ${stage}.`);
    }

    logger.log({
      level: "info",
      message: `Rolling back ${stage} to version ${version} for pipeline ${pipeline.name}`,
    });

    // TODO: Integrate with K8s/app service to actually rollback
    // - Update the app's image version to the rollback version
    // - Trigger deployment

    await pipelineRepo.updateStage(pipelineId, stage, {
      lastDeployedVersion: version,
      lastDeployedAt: new Date(),
      status: "deployed",
    });

    logger.log({
      level: "info",
      message: `Rollback of ${stage} to ${version} complete for pipeline ${pipeline.name}`,
    });
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  /**
   * Get the current status of a pipeline with all stages.
   */
  async function getPipelineStatus(pipelineId: string): Promise<{
    pipeline: TPipeline;
    stages: Array<{
      name: TStageName;
      status: string;
      version?: string;
      deployedAt?: Date;
      hasPendingPromotion: boolean;
    }>;
  }> {
    const pipeline = await pipelineRepo.getById(pipelineId);
    if (!pipeline) {
      throw new NotFoundError("Pipeline not found.");
    }

    const stages = await Promise.all(
      pipeline.stages.map(async (stage) => {
        // Check for pending promotions to this stage
        const prevStageIndex = stageNames.indexOf(stage.name) - 1;
        let hasPendingPromotion = false;

        if (prevStageIndex >= 0) {
          const fromStage = stageNames[prevStageIndex];
          const pendingPromotion = await promotionRepo.getPendingByPipelineAndStages(
            pipelineId,
            fromStage,
            stage.name
          );
          hasPendingPromotion = !!pendingPromotion;
        }

        return {
          name: stage.name,
          status: stage.status,
          version: stage.lastDeployedVersion,
          deployedAt: stage.lastDeployedAt,
          hasPendingPromotion,
        };
      })
    );

    return { pipeline, stages };
  }

  /**
   * Delete a pipeline and all associated promotions.
   */
  async function deletePipeline(pipelineId: string): Promise<void> {
    const pipeline = await pipelineRepo.getById(pipelineId);
    if (!pipeline) {
      throw new NotFoundError("Pipeline not found.");
    }

    logger.log({
      level: "info",
      message: `Deleting pipeline ${pipeline.name} and all associated resources`,
    });

    // TODO: Clean up K8s resources (namespaces, apps, etc.)

    // Delete all promotions for this pipeline
    const deletedPromotions = await promotionRepo.deleteByPipelineId(pipelineId);
    logger.log({
      level: "info",
      message: `Deleted ${deletedPromotions} promotions for pipeline ${pipeline.name}`,
    });

    // Delete the pipeline
    await pipelineRepo.deleteById(pipelineId);

    logger.log({
      level: "info",
      message: `Pipeline ${pipeline.name} deleted successfully`,
    });
  }

  return {
    // Pipeline lifecycle
    create,
    setupStages,

    // Deployments
    deployToStage,

    // Promotions
    requestPromotion,
    approvePromotion,
    rejectPromotion,
    executePromotion,

    // Rollback
    rollback,

    // Utility
    getPipelineStatus,
    deletePipeline,
  };
}
