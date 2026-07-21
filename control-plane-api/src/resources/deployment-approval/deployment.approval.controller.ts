import { Request, Response, NextFunction } from "express";
import { useDeploymentApprovalRepo } from "./deployment.approval.repository";
import { useDeploymentApprovalService } from "./deployment.approval.service";
import {
  schemaDeploymentApprovalCreate,
  schemaDeploymentApprovalReject,
  TDeploymentEnvironment,
} from "./deployment.approval.model";
import { BadRequestError } from "../../utils/error";

export function useDeploymentApprovalController() {
  const repo = useDeploymentApprovalRepo();
  const service = useDeploymentApprovalService();

  /**
   * Request deployment approval
   * POST /api/apps/:id/deploy/request
   */
  async function requestApproval(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const appId = req.params.id as string;
      const userId = req.cookies?.user as string;

      if (!userId) {
        next(new BadRequestError("User not authenticated"));
        return;
      }

      const { error, value } = schemaDeploymentApprovalCreate.validate({
        ...req.body,
        appId,
      });

      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const result = await service.requestApproval({
        appId,
        version: value.version,
        environment: value.environment,
        requestedBy: userId,
      });

      res.status(201).json({
        message: "Deployment approval requested",
        ...result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Approve a deployment
   * POST /api/deployments/:id/approve
   */
  async function approve(req: Request, res: Response, next: NextFunction) {
    try {
      const approvalId = req.params.id as string;
      const userId = req.cookies?.user as string;

      if (!userId) {
        next(new BadRequestError("User not authenticated"));
        return;
      }

      const result = await service.approveDeployment(approvalId, userId);

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Reject a deployment
   * POST /api/deployments/:id/reject
   */
  async function reject(req: Request, res: Response, next: NextFunction) {
    try {
      const approvalId = req.params.id as string;
      const userId = req.cookies?.user as string;

      if (!userId) {
        next(new BadRequestError("User not authenticated"));
        return;
      }

      const { error, value } = schemaDeploymentApprovalReject.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const result = await service.rejectDeployment(
        approvalId,
        userId,
        value.reason
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get pending approvals
   * GET /api/deployments/approvals/pending
   */
  async function getPending(req: Request, res: Response, next: NextFunction) {
    try {
      const page = req.query.page ? Number(req.query.page) : 1;
      const environment = req.query.environment as TDeploymentEnvironment | undefined;

      const result = await service.getPendingApprovals({ page, environment });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get approval by ID
   * GET /api/deployments/:id
   */
  async function getById(req: Request, res: Response, next: NextFunction) {
    try {
      const approvalId = req.params.id as string;
      const approval = await repo.getById(approvalId);

      res.json({ approval });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get approval history for an app
   * GET /api/apps/:id/approvals
   */
  async function getAppApprovals(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const appId = req.params.id as string;
      const page = req.query.page ? Number(req.query.page) : 1;
      const limit = req.query.limit ? Number(req.query.limit) : 10;

      const result = await service.getApprovalHistory(appId, { page, limit });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  return {
    requestApproval,
    approve,
    reject,
    getPending,
    getById,
    getAppApprovals,
  };
}
