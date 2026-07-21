import { useDeploymentApprovalRepo } from "./deployment.approval.repository";
import { useAppRepo } from "../app/app.repository";
import { useAppService } from "../app/app.service";
import {
  TDeploymentApproval,
  TDeploymentApprovalInput,
  TDeploymentEnvironment,
  modelDeploymentApproval,
} from "./deployment.approval.model";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../utils/error";
import { logger } from "../../utils";

export function useDeploymentApprovalService() {
  const repo = useDeploymentApprovalRepo();
  const appRepo = useAppRepo();

  /**
   * Request deployment approval
   */
  async function requestApproval(
    data: TDeploymentApprovalInput
  ): Promise<{ approvalId: string; status: string }> {
    // Verify app exists
    const app = await appRepo.getById(data.appId);
    if (!app) {
      throw new NotFoundError("App not found.");
    }

    // Check for existing pending approval
    const existing = await repo.findExisting(
      data.appId,
      data.environment,
      data.version
    );
    if (existing) {
      return {
        approvalId: existing._id!.toString(),
        status: "pending",
      };
    }

    const approval = modelDeploymentApproval(data);
    const approvalId = await repo.add(approval);

    logger.log({
      level: "info",
      message: `[Approval] Deployment approval requested for app ${app.name} (${data.environment}) v${data.version}`,
    });

    return { approvalId, status: "pending" };
  }

  /**
   * Approve a deployment request
   */
  async function approveDeployment(
    approvalId: string,
    approvedBy: string,
    triggerDeploy: boolean = true
  ): Promise<{ message: string; deploymentId?: string }> {
    const approval = await repo.getById(approvalId);

    if (approval.status !== "pending") {
      throw new BadRequestError(
        `Approval is already ${approval.status}.`
      );
    }

    if (new Date() > approval.expiresAt) {
      throw new BadRequestError("Approval request has expired.");
    }

    let deploymentId: string | undefined;

    if (triggerDeploy) {
      // Trigger the deployment
      const appService = useAppService();
      const result = await appService.deploy(approval.appId.toString(), {
        version: approval.version,
      });

      // If deployment was triggered, we should have a deploymentId
      // Note: The deploy function returns message/errors, not deploymentId directly
      // We'd need to get the latest deployment
      logger.log({
        level: "info",
        message: `[Approval] Deployment approved and triggered for app ${approval.appId}`,
      });
    }

    await repo.approve(approvalId, approvedBy, deploymentId);

    logger.log({
      level: "info",
      message: `[Approval] Deployment approval approved: ${approvalId}`,
    });

    return {
      message: triggerDeploy
        ? "Deployment approved and started"
        : "Deployment approved",
      deploymentId,
    };
  }

  /**
   * Reject a deployment request
   */
  async function rejectDeployment(
    approvalId: string,
    rejectedBy: string,
    reason?: string
  ): Promise<{ message: string }> {
    const approval = await repo.getById(approvalId);

    if (approval.status !== "pending") {
      throw new BadRequestError(
        `Approval is already ${approval.status}.`
      );
    }

    await repo.reject(approvalId, rejectedBy, reason);

    logger.log({
      level: "info",
      message: `[Approval] Deployment approval rejected: ${approvalId}${reason ? ` (${reason})` : ""}`,
    });

    return { message: "Deployment approval rejected" };
  }

  /**
   * Get all pending approvals
   */
  async function getPendingApprovals(options: {
    page?: number;
    environment?: TDeploymentEnvironment;
  } = {}) {
    return repo.getAllPending(options);
  }

  /**
   * Get approval history for an app
   */
  async function getApprovalHistory(
    appId: string,
    options: { page?: number; limit?: number } = {}
  ) {
    return repo.getByAppId(appId, options);
  }

  /**
   * Check if production deployments require approval for an app
   * This could be configured per-app or globally
   */
  function requiresApproval(environment: TDeploymentEnvironment): boolean {
    // For now, always require approval for production
    return environment === "production";
  }

  return {
    requestApproval,
    approveDeployment,
    rejectDeployment,
    getPendingApprovals,
    getApprovalHistory,
    requiresApproval,
  };
}
