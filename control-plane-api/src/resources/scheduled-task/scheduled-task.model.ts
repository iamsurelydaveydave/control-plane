import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils/error";

// =============================================================================
// Enums
// =============================================================================

export const scheduledTaskTypes = [
  "backup",        // Database backup
  "cleanup",       // Clean old deployments/logs
  "health-check",  // Custom health check
  "script",        // Custom script execution
  "webhook",       // Call a webhook
] as const;
export type TScheduledTaskType = (typeof scheduledTaskTypes)[number];

export const scheduledTaskStatuses = ["active", "paused", "running", "failed"] as const;
export type TScheduledTaskStatus = (typeof scheduledTaskStatuses)[number];

export const taskRunStatuses = ["success", "failed"] as const;
export type TTaskRunStatus = (typeof taskRunStatuses)[number];

export const webhookMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type TWebhookMethod = (typeof webhookMethods)[number];

// =============================================================================
// Types
// =============================================================================

export type TScheduledTaskConfig = {
  // For backup type
  databaseId?: string;
  // For cleanup type
  retentionDays?: number;
  // For script type
  script?: string;
  // For webhook type
  url?: string;
  method?: TWebhookMethod;
  headers?: Record<string, string>;
  body?: string;
};

export type TScheduledTask = {
  _id?: ObjectId;
  organizationId?: ObjectId;   // Organization this task belongs to (multi-tenancy)
  name: string;
  type: TScheduledTaskType;
  schedule: string;              // Cron expression (e.g., "0 0 * * *")
  timezone: string;              // Timezone (default: UTC)
  status: TScheduledTaskStatus;
  config: TScheduledTaskConfig;
  lastRunAt?: Date;
  lastRunStatus?: TTaskRunStatus;
  lastRunError?: string;
  lastRunDuration?: number;      // milliseconds
  nextRunAt?: Date;
  runCount: number;
  failCount: number;
  createdAt: Date;
  updatedAt: Date;
};

// =============================================================================
// Input types
// =============================================================================

export type TScheduledTaskInput = {
  organizationId?: string;     // Optional for backwards compat
  name: string;
  type: TScheduledTaskType;
  schedule: string;
  timezone?: string;
  config: TScheduledTaskConfig;
};

export type TScheduledTaskUpdateInput = Partial<{
  name: string;
  schedule: string;
  timezone: string;
  config: TScheduledTaskConfig;
}>;

// =============================================================================
// Joi Schemas
// =============================================================================

const schemaConfigBase = Joi.object({
  // Backup config
  databaseId: Joi.string().length(24).optional(),
  // Cleanup config
  retentionDays: Joi.number().integer().min(1).max(365).optional(),
  // Script config
  script: Joi.string().max(10000).optional(),
  // Webhook config
  url: Joi.string().uri({ scheme: ["http", "https"] }).optional(),
  method: Joi.string().valid(...webhookMethods).optional(),
  headers: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
  body: Joi.string().max(50000).optional(),
});

// Validate cron expression - basic pattern validation
// Format: "* * * * *" (minute hour day month weekday) or with seconds "* * * * * *"
const cronPattern = /^(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)(\s+(\*|[0-9,\-\/]+))?$/;

export const schemaScheduledTaskCreate = Joi.object({
  organizationId: Joi.string().length(24).optional(), // Optional for backwards compat
  name: Joi.string().min(1).max(100).required(),
  type: Joi.string().valid(...scheduledTaskTypes).required(),
  schedule: Joi.string().pattern(cronPattern, "cron expression").required(),
  timezone: Joi.string().default("UTC"),
  config: schemaConfigBase.required(),
}).custom((value, helpers) => {
  // Type-specific validation
  const { type, config } = value;
  
  switch (type) {
    case "backup":
      if (!config.databaseId) {
        return helpers.error("any.custom", { message: "databaseId is required for backup tasks" });
      }
      break;
    case "cleanup":
      if (config.retentionDays === undefined) {
        value.config.retentionDays = 30; // Default retention
      }
      break;
    case "webhook":
      if (!config.url) {
        return helpers.error("any.custom", { message: "url is required for webhook tasks" });
      }
      if (!config.method) {
        value.config.method = "POST"; // Default method
      }
      break;
    case "script":
      if (!config.script) {
        return helpers.error("any.custom", { message: "script is required for script tasks" });
      }
      break;
  }
  
  return value;
});

export const schemaScheduledTaskUpdate = Joi.object<TScheduledTaskUpdateInput>({
  name: Joi.string().min(1).max(100).optional(),
  schedule: Joi.string().pattern(cronPattern, "cron expression").optional(),
  timezone: Joi.string().optional(),
  config: schemaConfigBase.optional(),
});

// =============================================================================
// Model Function
// =============================================================================

/**
 * Validate and normalize scheduled task data for creation.
 * - Validates all fields via Joi
 * - Sets initial status to "active"
 * - Sets timestamps
 * - Initializes counters
 */
export function modelScheduledTask(data: TScheduledTaskInput): Omit<TScheduledTask, "_id"> {
  const { error, value } = schemaScheduledTaskCreate.validate(data, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    throw new BadRequestError(
      `Scheduled task validation error: ${error.details.map((d) => d.message).join(", ")}`
    );
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
    name: value.name,
    type: value.type as TScheduledTaskType,
    schedule: value.schedule,
    timezone: value.timezone || "UTC",
    status: "active",
    config: value.config,
    runCount: 0,
    failCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}
