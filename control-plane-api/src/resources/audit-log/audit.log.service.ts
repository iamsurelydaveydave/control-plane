import { Request, Response, NextFunction } from "express";
import { useAuditLogRepo } from "./audit.log.repository";
import {
  TAuditAction,
  TAuditResource,
  TAuditLog,
  TAuditChange,
  TExportFormat,
  TComplianceReportType,
  TComplianceReport,
} from "./audit.log.model";
import { logger, BadRequestError } from "../../utils";
import { useUserRepo } from "../user";
import { usePDFService } from "../../services/pdf.service";

/**
 * Service layer for audit logging functionality
 */
export function useAuditLogService() {
  const repo = useAuditLogRepo();
  const userRepo = useUserRepo();

  /**
   * Log an action with full context from the request
   */
  async function logAction(params: {
    req: Request;
    action: TAuditAction;
    resource: TAuditResource;
    resourceId?: string;
    resourceName?: string;
    details?: Record<string, any>;
    changes?: TAuditChange[];
    success?: boolean;
    errorMessage?: string;
    startTime?: number; // For calculating duration
  }): Promise<void> {
    try {
      const {
        req,
        action,
        resource,
        resourceId,
        resourceName,
        details,
        changes,
        success = true,
        errorMessage,
        startTime,
      } = params;

      // Extract user info from request
      const userId = req.cookies?.user as string | undefined;
      let userEmail: string | undefined;

      if (userId) {
        try {
          const user = await userRepo.getById(userId);
          userEmail = user?.email;
        } catch {
          // User lookup failed, continue without email
        }
      }

      // Extract request context
      const ip = getClientIp(req);
      const userAgent = req.headers["user-agent"] || undefined;
      const sessionId = req.cookies?.sid || undefined;
      const apiTokenId = req.apiToken?.id || undefined;

      // Calculate duration if startTime provided
      const duration = startTime ? Date.now() - startTime : undefined;

      await repo.add({
        userId,
        userEmail,
        action,
        resource,
        resourceId,
        resourceName,
        details,
        changes,
        ip,
        userAgent,
        sessionId,
        apiTokenId,
        success,
        errorMessage,
        duration,
      });
    } catch (error) {
      // Log errors but don't throw - audit logging should never break the main operation
      logger.log({
        level: "error",
        message: `Failed to log audit action: ${error}`,
      });
    }
  }

  /**
   * Log a simple action without request context (for background jobs, etc.)
   */
  async function logSystemAction(params: {
    action: TAuditAction;
    resource: TAuditResource;
    resourceId?: string;
    resourceName?: string;
    details?: Record<string, any>;
    success?: boolean;
    errorMessage?: string;
  }): Promise<void> {
    try {
      await repo.add({
        action: params.action,
        resource: params.resource,
        resourceId: params.resourceId,
        resourceName: params.resourceName,
        details: { ...params.details, source: "system" },
        success: params.success ?? true,
        errorMessage: params.errorMessage,
      });
    } catch (error) {
      logger.log({
        level: "error",
        message: `Failed to log system audit action: ${error}`,
      });
    }
  }

  /**
   * Export audit logs in the specified format
   */
  async function exportLogs(params: {
    startDate: Date;
    endDate: Date;
    format: TExportFormat;
    filters?: {
      userId?: string;
      action?: TAuditAction;
      resource?: TAuditResource;
      success?: boolean;
    };
  }): Promise<{ data: string | Buffer; contentType: string; filename: string }> {
    const { startDate, endDate, format, filters } = params;

    // Validate date range (max 1 year)
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff > 365) {
      throw new BadRequestError("Export date range cannot exceed 1 year");
    }

    const logs = await repo.getForExport({ startDate, endDate, filters });

    const dateStr = new Date().toISOString().split("T")[0];

    switch (format) {
      case "json":
        return {
          data: JSON.stringify(logs, null, 2),
          contentType: "application/json",
          filename: `audit-logs-${dateStr}.json`,
        };

      case "csv":
        return {
          data: convertToCSV(logs),
          contentType: "text/csv",
          filename: `audit-logs-${dateStr}.csv`,
        };

      case "pdf": {
        const pdfService = usePDFService();
        const pdfBuffer = await pdfService.generateAuditLogPDF(logs, {
          title: "Control Plane - Audit Log Report",
          dateRange: { from: startDate, to: endDate },
          filters: filters
            ? Object.fromEntries(
                Object.entries(filters)
                  .filter(([, v]) => v !== undefined)
                  .map(([k, v]) => [k, String(v)])
              )
            : undefined,
        });
        return {
          data: pdfBuffer,
          contentType: "application/pdf",
          filename: `audit-logs-${dateStr}.pdf`,
        };
      }

      default:
        throw new BadRequestError(`Unsupported export format: ${format}`);
    }
  }

  /**
   * Generate a compliance report
   */
  async function generateComplianceReport(params: {
    startDate: Date;
    endDate: Date;
    type: TComplianceReportType;
  }): Promise<TComplianceReport> {
    const { startDate, endDate, type } = params;

    // Validate date range
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff > 365) {
      throw new BadRequestError("Report date range cannot exceed 1 year");
    }

    return repo.getComplianceData({ startDate, endDate, type });
  }

  /**
   * Get audit statistics
   */
  async function getStats(params?: { startDate?: Date; endDate?: Date }) {
    return repo.getStats(params);
  }

  /**
   * Enforce data retention policy
   */
  async function enforceRetentionPolicy(retentionDays: number): Promise<number> {
    return repo.enforceRetentionPolicy(retentionDays);
  }

  /**
   * Preview retention policy impact
   */
  async function getRetentionPreview(retentionDays: number): Promise<number> {
    return repo.getRetentionPreview(retentionDays);
  }

  return {
    logAction,
    logSystemAction,
    exportLogs,
    generateComplianceReport,
    getStats,
    enforceRetentionPolicy,
    getRetentionPreview,
  };
}

/**
 * Middleware factory to auto-log actions
 */
export function auditMiddleware(action: TAuditAction, resource: TAuditResource) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();

    // Store original res.json to intercept response
    const originalJson = res.json.bind(res);

    res.json = function (body: any) {
      // Log the action after response is sent
      const success = res.statusCode >= 200 && res.statusCode < 400;
      const resourceId = req.params.id || body?.id || body?._id;
      const resourceName = body?.name || req.body?.name;

      const service = useAuditLogService();
      service
        .logAction({
          req,
          action,
          resource,
          resourceId: resourceId ? String(resourceId) : undefined,
          resourceName,
          success,
          errorMessage: !success ? body?.error || body?.message : undefined,
          startTime,
          details: {
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
          },
        })
        .catch(() => {});

      return originalJson(body);
    };

    next();
  };
}

/**
 * Middleware to log failed requests
 */
export function auditErrorMiddleware(action: TAuditAction, resource: TAuditResource) {
  return (err: any, req: Request, res: Response, next: NextFunction) => {
    const service = useAuditLogService();
    service
      .logAction({
        req,
        action,
        resource,
        resourceId: req.params.id as string | undefined,
        success: false,
        errorMessage: err.message || "Unknown error",
        details: {
          method: req.method,
          path: req.path,
          errorName: err.name,
        },
      })
      .catch(() => {});

    next(err);
  };
}

// Helper functions

function getClientIp(req: Request): string | undefined {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  if (Array.isArray(forwarded)) {
    return forwarded[0];
  }
  return req.socket?.remoteAddress;
}

function convertToCSV(logs: TAuditLog[]): string {
  const headers = [
    "timestamp",
    "user_email",
    "action",
    "resource",
    "resource_id",
    "resource_name",
    "ip",
    "success",
    "error_message",
    "duration_ms",
    "details",
  ];

  const rows = logs.map((log) => [
    log.createdAt.toISOString(),
    escapeCSV(log.userEmail || ""),
    log.action,
    log.resource,
    escapeCSV(log.resourceId || ""),
    escapeCSV(log.resourceName || ""),
    log.ip || "",
    log.success.toString(),
    escapeCSV(log.errorMessage || ""),
    log.duration?.toString() || "",
    escapeCSV(log.details ? JSON.stringify(log.details) : ""),
  ]);

  return [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
}

function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function generatePDFContent(logs: TAuditLog[], startDate: Date, endDate: Date): string {
  const lines: string[] = [
    "=" .repeat(80),
    "AUDIT LOG EXPORT REPORT",
    "=" .repeat(80),
    "",
    `Generated: ${new Date().toISOString()}`,
    `Period: ${startDate.toISOString()} to ${endDate.toISOString()}`,
    `Total Records: ${logs.length}`,
    "",
    "-".repeat(80),
    "",
  ];

  for (const log of logs) {
    lines.push(`Timestamp: ${log.createdAt.toISOString()}`);
    lines.push(`User: ${log.userEmail || "System"}`);
    lines.push(`Action: ${log.action}`);
    lines.push(`Resource: ${log.resource}${log.resourceId ? ` (${log.resourceId})` : ""}`);
    if (log.resourceName) {
      lines.push(`Resource Name: ${log.resourceName}`);
    }
    lines.push(`Status: ${log.success ? "Success" : "Failed"}`);
    if (log.errorMessage) {
      lines.push(`Error: ${log.errorMessage}`);
    }
    if (log.ip) {
      lines.push(`IP: ${log.ip}`);
    }
    if (log.duration) {
      lines.push(`Duration: ${log.duration}ms`);
    }
    if (log.details && Object.keys(log.details).length > 0) {
      lines.push(`Details: ${JSON.stringify(log.details)}`);
    }
    lines.push("");
    lines.push("-".repeat(40));
    lines.push("");
  }

  return lines.join("\n");
}
