import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils";

export const auditActions = [
  "create",
  "update",
  "delete",
  "scale",
  "deploy",
  "restart",
  "backup",
  "login",
  "logout",
] as const;
export type TAuditAction = (typeof auditActions)[number];

export const auditResources = [
  "user",
  "server",
  "app",
  "database",
  "instance",
  "deployment",
  "settings",
] as const;
export type TAuditResource = (typeof auditResources)[number];

export type TAuditLog = {
  _id?: ObjectId;
  timestamp: Date;
  userId: ObjectId;
  userEmail: string;
  action: TAuditAction;
  resource: TAuditResource;
  resourceId: string;
  details?: Record<string, any>;
  ip?: string;
};

export const schemaAuditLogCreate = Joi.object({
  userId: Joi.string().required(),
  userEmail: Joi.string().email().required(),
  action: Joi.string().valid(...auditActions).required(),
  resource: Joi.string().valid(...auditResources).required(),
  resourceId: Joi.string().required(),
  details: Joi.object().optional(),
  ip: Joi.string().optional(),
});

export function modelAuditLog(data: Partial<TAuditLog>): TAuditLog {
  const { error, value } = schemaAuditLogCreate.validate(data);

  if (error) {
    throw new BadRequestError(`AuditLog validation error: ${error.message}`);
  }

  return {
    _id: data._id,
    timestamp: new Date(),
    userId: new ObjectId(value.userId),
    userEmail: value.userEmail,
    action: value.action,
    resource: value.resource,
    resourceId: value.resourceId,
    details: value.details,
    ip: value.ip,
  };
}
