import { Request, Response, NextFunction } from "express";
import { useAlertRepo } from "./alert.repository";
import { useAlertService } from "./alert.service";
import { schemaAlertAcknowledge, TAlertSeverity, TAlertSource, TAlertStatus } from "./alert.model";
import { BadRequestError } from "../../utils/error";

export function useAlertController() {
  const repo = useAlertRepo();
  const service = useAlertService();

  /**
   * GET /alerts - List all alerts with optional filters
   */
  async function list(req: Request, res: Response, next: NextFunction) {
    try {
      const page = Number(req.query.page) || 1;
      const status = req.query.status as TAlertStatus | undefined;
      const severity = req.query.severity as TAlertSeverity | undefined;
      const source = req.query.source as TAlertSource | undefined;
      const search = req.query.search as string | undefined;

      const result = await repo.getAll({ page, status, severity, source, search });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /alerts/count - Get active alert count with breakdown
   */
  async function getCount(req: Request, res: Response, next: NextFunction) {
    try {
      const counts = await repo.getActiveCount();
      res.json(counts);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /alerts/:id - Get alert by ID
   */
  async function getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const alert = await repo.getById(id);
      res.json({ alert });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /alerts/:id/acknowledge - Acknowledge an alert
   */
  async function acknowledge(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { error, value } = schemaAlertAcknowledge.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      // Use authenticated user ID if available
      const userId = value.userId || (req as any).user?.userId;

      await repo.acknowledge(id, userId);
      const alert = await repo.getById(id);

      res.json({
        message: "Alert acknowledged.",
        alert,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /alerts/:id/resolve - Resolve an alert
   */
  async function resolve(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      await repo.resolve(id);
      const alert = await repo.getById(id);

      res.json({
        message: "Alert resolved.",
        alert,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /alerts/:id - Delete an alert
   */
  async function remove(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      await repo.deleteById(id);

      res.json({
        message: "Alert deleted.",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /alerts/check - Manually trigger health checks (admin only)
   */
  async function runHealthChecks(req: Request, res: Response, next: NextFunction) {
    try {
      const results = await service.runAllHealthChecks();

      res.json({
        message: "Health checks completed.",
        ...results,
      });
    } catch (error) {
      next(error);
    }
  }

  return {
    list,
    getCount,
    getById,
    acknowledge,
    resolve,
    remove,
    runHealthChecks,
  };
}
