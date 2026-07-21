import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils/error";

// =============================================================================
// Enums
// =============================================================================

export const alertSeverities = ["info", "warning", "critical"] as const;
export type TAlertSeverity = (typeof alertSeverities)[number];

export const alertStatuses = ["active", "acknowledged", "resolved"] as const;
export type TAlertStatus = (typeof alertStatuses)[number];

export const alertSources = ["system", "database", "app", "cluster", "node"] as const;
export type TAlertSource = (typeof alertSources)[number];

// =============================================================================
// Types
// =============================================================================

export type TAlert = {
  _id?: ObjectId;
  organizationId?: ObjectId;   // Organization this alert belongs to (multi-tenancy)
  title: string;
  message: string;
  severity: TAlertSeverity;
  status: TAlertStatus;
  source: TAlertSource;
  sourceId?: string; // ID of related resource
  metadata?: Record<string, any>;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

// =============================================================================
// Input type for creating an alert
// =============================================================================

export type TAlertInput = {
  organizationId?: string;     // Optional for backwards compat
  title: string;
  message: string;
  severity: TAlertSeverity;
  source: TAlertSource;
  sourceId?: string;
  metadata?: Record<string, any>;
};

// =============================================================================
// Joi Schemas
// =============================================================================

const schemaAlertBase = {
  organizationId: Joi.string().length(24).optional(), // Optional for backwards compat
  title: Joi.string().max(200).required(),
  message: Joi.string().max(2000).required(),
  severity: Joi.string().valid(...alertSeverities).required(),
  source: Joi.string().valid(...alertSources).required(),
  sourceId: Joi.string().optional(),
  metadata: Joi.object().optional(),
};

export const schemaAlertCreate = Joi.object({
  ...schemaAlertBase,
});

export const schemaAlertAcknowledge = Joi.object({
  userId: Joi.string().optional(),
});

// =============================================================================
// Model Function
// =============================================================================

export function modelAlert(data: TAlertInput): Omit<TAlert, "_id"> {
  const { error, value } = schemaAlertCreate.validate(data);

  if (error) {
    throw new BadRequestError(`Alert validation error: ${error.message}`);
  }

  const now = new Date();

  // Convert organizationId if present
  let organizationId: ObjectId | undefined;
  if (value.organizationId) {
    try {
      organizationId = new ObjectId(value.organizationId);
    } catch {
      throw new BadRequestError(`Invalid organizationId format: ${value.organizationId}`);
    }
  }

  return {
    organizationId,
    title: value.title,
    message: value.message,
    severity: value.severity,
    status: "active",
    source: value.source,
    sourceId: value.sourceId,
    metadata: value.metadata || {},
    createdAt: now,
    updatedAt: now,
  };
}
