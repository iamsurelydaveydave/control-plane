import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import { useAuditLogRepo } from "./audit.log.repository";
import { useAuditLogService } from "./audit.log.service";
import {
  TAuditAction,
  TAuditResource,
  auditActions,
  auditResources,
  exportFormats,
  complianceReportTypes,
  TExportFormat,
  TComplianceReportType,
} from "./audit.log.model";
import { BadRequestError } from "../../utils";

export function useAuditLogController() {
  const repo = useAuditLogRepo();
  const service = useAuditLogService();

  /**
   * GET /api/audit-logs
   * List audit logs with filtering and pagination
   */
  async function getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit, userId, action, resource, resourceId, startDate, endDate, success, search } =
        req.query;

      const data = await repo.getAll({
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 50,
        userId: userId as string,
        action: action as TAuditAction,
        resource: resource as TAuditResource,
        resourceId: resourceId as string,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        success: success !== undefined ? success === "true" : undefined,
        search: search as string,
      });

      res.json(data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/audit-logs/stats
   * Get audit statistics
   */
  async function getStats(req: Request, res: Response, next: NextFunction) {
    try {
      const { startDate, endDate } = req.query;

      const stats = await service.getStats({
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
      });

      res.json(stats);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/audit-logs/export
   * Export audit logs in specified format
   */
  async function exportLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const schema = Joi.object({
        startDate: Joi.date().iso().required(),
        endDate: Joi.date().iso().required(),
        format: Joi.string()
          .valid(...exportFormats)
          .required(),
        userId: Joi.string().optional(),
        action: Joi.string()
          .valid(...auditActions)
          .optional(),
        resource: Joi.string()
          .valid(...auditResources)
          .optional(),
        success: Joi.string().valid("true", "false").optional(),
      });

      const { error, value } = schema.validate(req.query);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const result = await service.exportLogs({
        startDate: new Date(value.startDate),
        endDate: new Date(value.endDate),
        format: value.format as TExportFormat,
        filters: {
          userId: value.userId,
          action: value.action as TAuditAction,
          resource: value.resource as TAuditResource,
          success: value.success !== undefined ? value.success === "true" : undefined,
        },
      });

      // Log the export action
      await service.logAction({
        req,
        action: "export",
        resource: "audit_log",
        details: {
          format: value.format,
          startDate: value.startDate,
          endDate: value.endDate,
          filters: value,
        },
      });

      res.setHeader("Content-Type", result.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
      res.send(result.data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/audit-logs/export/csv
   * Convenience endpoint for CSV export
   */
  async function exportCSV(req: Request, res: Response, next: NextFunction) {
    try {
      const schema = Joi.object({
        startDate: Joi.date().iso().required(),
        endDate: Joi.date().iso().required(),
        userId: Joi.string().optional(),
        action: Joi.string()
          .valid(...auditActions)
          .optional(),
        resource: Joi.string()
          .valid(...auditResources)
          .optional(),
        success: Joi.string().valid("true", "false").optional(),
      });

      const { error, value } = schema.validate(req.query);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const result = await service.exportLogs({
        startDate: new Date(value.startDate),
        endDate: new Date(value.endDate),
        format: "csv",
        filters: {
          userId: value.userId,
          action: value.action as TAuditAction,
          resource: value.resource as TAuditResource,
          success: value.success !== undefined ? value.success === "true" : undefined,
        },
      });

      // Log the export action
      await service.logAction({
        req,
        action: "export",
        resource: "audit_log",
        details: {
          format: "csv",
          startDate: value.startDate,
          endDate: value.endDate,
        },
      });

      res.setHeader("Content-Type", result.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
      res.send(result.data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/audit-logs/export/json
   * Convenience endpoint for JSON export
   */
  async function exportJSON(req: Request, res: Response, next: NextFunction) {
    try {
      const schema = Joi.object({
        startDate: Joi.date().iso().required(),
        endDate: Joi.date().iso().required(),
        userId: Joi.string().optional(),
        action: Joi.string()
          .valid(...auditActions)
          .optional(),
        resource: Joi.string()
          .valid(...auditResources)
          .optional(),
        success: Joi.string().valid("true", "false").optional(),
      });

      const { error, value } = schema.validate(req.query);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const result = await service.exportLogs({
        startDate: new Date(value.startDate),
        endDate: new Date(value.endDate),
        format: "json",
        filters: {
          userId: value.userId,
          action: value.action as TAuditAction,
          resource: value.resource as TAuditResource,
          success: value.success !== undefined ? value.success === "true" : undefined,
        },
      });

      // Log the export action
      await service.logAction({
        req,
        action: "export",
        resource: "audit_log",
        details: {
          format: "json",
          startDate: value.startDate,
          endDate: value.endDate,
        },
      });

      res.setHeader("Content-Type", result.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
      res.send(result.data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/audit-logs/export/pdf
   * Convenience endpoint for PDF export
   */
  async function exportPDF(req: Request, res: Response, next: NextFunction) {
    try {
      const schema = Joi.object({
        startDate: Joi.date().iso().required(),
        endDate: Joi.date().iso().required(),
        userId: Joi.string().optional(),
        action: Joi.string()
          .valid(...auditActions)
          .optional(),
        resource: Joi.string()
          .valid(...auditResources)
          .optional(),
        success: Joi.string().valid("true", "false").optional(),
      });

      const { error, value } = schema.validate(req.query);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const result = await service.exportLogs({
        startDate: new Date(value.startDate),
        endDate: new Date(value.endDate),
        format: "pdf",
        filters: {
          userId: value.userId,
          action: value.action as TAuditAction,
          resource: value.resource as TAuditResource,
          success: value.success !== undefined ? value.success === "true" : undefined,
        },
      });

      // Log the export action
      await service.logAction({
        req,
        action: "export",
        resource: "audit_log",
        details: {
          format: "pdf",
          startDate: value.startDate,
          endDate: value.endDate,
        },
      });

      res.setHeader("Content-Type", result.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
      res.send(result.data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/audit-logs/report
   * Generate compliance report
   */
  async function getComplianceReport(req: Request, res: Response, next: NextFunction) {
    try {
      const schema = Joi.object({
        startDate: Joi.date().iso().required(),
        endDate: Joi.date().iso().required(),
        type: Joi.string()
          .valid(...complianceReportTypes)
          .required(),
      });

      const { error, value } = schema.validate(req.query);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const report = await service.generateComplianceReport({
        startDate: new Date(value.startDate),
        endDate: new Date(value.endDate),
        type: value.type as TComplianceReportType,
      });

      // Log the report generation
      await service.logAction({
        req,
        action: "read",
        resource: "audit_log",
        details: {
          operation: "compliance_report",
          type: value.type,
          startDate: value.startDate,
          endDate: value.endDate,
        },
      });

      res.json(report);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/audit-logs/retention
   * Enforce data retention policy
   */
  async function enforceRetention(req: Request, res: Response, next: NextFunction) {
    try {
      const schema = Joi.object({
        retentionDays: Joi.number().integer().min(1).max(3650).required(),
        preview: Joi.boolean().default(false),
      });

      const { error, value } = schema.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      if (value.preview) {
        const count = await service.getRetentionPreview(value.retentionDays);
        res.json({
          message: `${count} audit logs would be deleted`,
          count,
          retentionDays: value.retentionDays,
          preview: true,
        });
        return;
      }

      const deletedCount = await service.enforceRetentionPolicy(value.retentionDays);

      // Log the retention enforcement
      await service.logAction({
        req,
        action: "delete",
        resource: "audit_log",
        details: {
          operation: "retention_policy",
          retentionDays: value.retentionDays,
          deletedCount,
        },
      });

      res.json({
        message: `Successfully deleted ${deletedCount} old audit logs`,
        deletedCount,
        retentionDays: value.retentionDays,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/audit-logs/retention/preview
   * Preview retention policy impact
   */
  async function previewRetention(req: Request, res: Response, next: NextFunction) {
    try {
      const schema = Joi.object({
        retentionDays: Joi.number().integer().min(1).max(3650).required(),
      });

      const { error, value } = schema.validate(req.query);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const count = await service.getRetentionPreview(Number(value.retentionDays));

      res.json({
        count,
        retentionDays: Number(value.retentionDays),
        message: `${count} audit logs are older than ${value.retentionDays} days`,
      });
    } catch (error) {
      next(error);
    }
  }

  return {
    getAll,
    getStats,
    exportLogs,
    exportCSV,
    exportJSON,
    exportPDF,
    getComplianceReport,
    enforceRetention,
    previewRetention,
  };
}
