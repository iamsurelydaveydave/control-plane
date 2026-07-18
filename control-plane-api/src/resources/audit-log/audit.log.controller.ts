import { Request, Response, NextFunction } from "express";
import { useAuditLogRepo } from "./audit.log.repository";
import { TAuditAction, TAuditResource } from "./audit.log.model";

export function useAuditLogController() {
  const repo = useAuditLogRepo();

  async function getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit, userId, action, resource, resourceId, startDate, endDate } = req.query;

      const data = await repo.getAll({
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 50,
        userId: userId as string,
        action: action as TAuditAction,
        resource: resource as TAuditResource,
        resourceId: resourceId as string,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
      });

      res.json(data);
    } catch (error) {
      next(error);
    }
  }

  return {
    getAll,
  };
}
