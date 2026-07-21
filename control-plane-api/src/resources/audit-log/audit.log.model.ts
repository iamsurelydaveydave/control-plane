import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils";

// Extended action types for comprehensive audit logging
export const auditActions = [
  // CRUD operations
  "create",
  "read",
  "update",
  "delete",
  // Authentication
  "login",
  "logout",
  "login_failed",
  // Deployment operations
  "deploy",
  "rollback",
  "scale",
  // Backup operations
  "backup",
  "restore",
  // Access control
  "permission_change",
  "role_change",
  // API & Export
  "export",
  "api_token_create",
  "api_token_revoke",
  // App lifecycle
  "restart",
  "stop",
  "start",
] as const;
export type TAuditAction = (typeof auditActions)[number];

// Resource types that can be audited
export const auditResources = [
  "user",
  "server",
  "app",
  "database",
  "addon",
  "instance",
  "deployment",
  "settings",
  "cluster",
  "node",
  "api_token",
  "ssh_key",
  "secret",
  "alert",
  "audit_log", // For export actions
] as const;
export type TAuditResource = (typeof auditResources)[number];

// Change tracking for updates
export type TAuditChange = {
  field: string;
  oldValue: any;
  newValue: any;
};

export type TAuditLog = {
  _id?: ObjectId;
  userId?: ObjectId;
  userEmail?: string;
  action: TAuditAction;
  resource: TAuditResource;
  resourceId?: string;
  resourceName?: string;
  details?: Record<string, any>;
  changes?: TAuditChange[];
  ip?: string;
  userAgent?: string;
  sessionId?: string;
  apiTokenId?: string; // If action was via API token
  success: boolean;
  errorMessage?: string;
  duration?: number; // Request duration in ms
  createdAt: Date;
};

// Input type for creating audit logs (accepts string IDs)
export type TAuditLogInput = Omit<TAuditLog, '_id' | 'userId' | 'createdAt'> & {
  userId?: string;
  createdAt?: Date;
};

// Compliance report types
export const complianceReportTypes = ["soc2", "gdpr", "hipaa", "general"] as const;
export type TComplianceReportType = (typeof complianceReportTypes)[number];

export type TUserActivity = {
  userId: string;
  email: string;
  actionCount: number;
  lastActivity: Date;
};

export type TSecurityEvents = {
  failedLogins: TAuditLog[];
  permissionChanges: TAuditLog[];
  apiTokenActivity: TAuditLog[];
};

export type TResourceChanges = {
  apps: { created: number; deleted: number; deployed: number };
  databases: { created: number; deleted: number; backed_up: number };
  users: { created: number; deleted: number; permission_changes: number };
};

export type TComplianceReport = {
  generatedAt: Date;
  period: { start: Date; end: Date };
  type: TComplianceReportType;
  summary: {
    totalActions: number;
    uniqueUsers: number;
    failedActions: number;
    securityEvents: number;
  };
  userActivity: TUserActivity[];
  securityEvents: TSecurityEvents;
  resourceChanges: TResourceChanges;
};

// Audit statistics
export type TAuditStats = {
  totalLogs: number;
  logsByAction: Record<string, number>;
  logsByResource: Record<string, number>;
  logsByDay: { date: string; count: number }[];
  failureRate: number;
  topUsers: { email: string; count: number }[];
};

// Export formats
export const exportFormats = ["json", "csv", "pdf"] as const;
export type TExportFormat = (typeof exportFormats)[number];

export type TExportParams = {
  startDate: Date;
  endDate: Date;
  format: TExportFormat;
  filters?: {
    userId?: string;
    action?: TAuditAction;
    resource?: TAuditResource;
    success?: boolean;
  };
};

// Joi schemas
const schemaAuditChangeBase = {
  field: Joi.string().required(),
  oldValue: Joi.any().allow(null),
  newValue: Joi.any().allow(null),
};

export const schemaAuditLogCreate = Joi.object({
  userId: Joi.string().optional(),
  userEmail: Joi.string().email().optional(),
  action: Joi.string()
    .valid(...auditActions)
    .required(),
  resource: Joi.string()
    .valid(...auditResources)
    .required(),
  resourceId: Joi.string().optional(),
  resourceName: Joi.string().optional(),
  details: Joi.object().optional(),
  changes: Joi.array().items(Joi.object(schemaAuditChangeBase)).optional(),
  ip: Joi.string().optional(),
  userAgent: Joi.string().optional(),
  sessionId: Joi.string().optional(),
  apiTokenId: Joi.string().optional(),
  success: Joi.boolean().default(true),
  errorMessage: Joi.string().optional(),
  duration: Joi.number().optional(),
});

export const schemaExportParams = Joi.object({
  startDate: Joi.date().iso().required(),
  endDate: Joi.date().iso().required(),
  format: Joi.string()
    .valid(...exportFormats)
    .required(),
  filters: Joi.object({
    userId: Joi.string().optional(),
    action: Joi.string()
      .valid(...auditActions)
      .optional(),
    resource: Joi.string()
      .valid(...auditResources)
      .optional(),
    success: Joi.boolean().optional(),
  }).optional(),
});

export const schemaComplianceReport = Joi.object({
  startDate: Joi.date().iso().required(),
  endDate: Joi.date().iso().required(),
  type: Joi.string()
    .valid(...complianceReportTypes)
    .required(),
});

export function modelAuditLog(
  data: TAuditLogInput
): Omit<TAuditLog, "_id"> {
  const { error, value } = schemaAuditLogCreate.validate(data);

  if (error) {
    throw new BadRequestError(`AuditLog validation error: ${error.message}`);
  }

  return {
    userId: value.userId ? new ObjectId(value.userId) : undefined,
    userEmail: value.userEmail,
    action: value.action,
    resource: value.resource,
    resourceId: value.resourceId,
    resourceName: value.resourceName,
    details: value.details,
    changes: value.changes,
    ip: value.ip,
    userAgent: value.userAgent,
    sessionId: value.sessionId,
    apiTokenId: value.apiTokenId,
    success: value.success ?? true,
    errorMessage: value.errorMessage,
    duration: value.duration,
    createdAt: new Date(),
  };
}
