import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils/error";

// =============================================================================
// Enums
// =============================================================================

export const webhookEvents = [
  // App events
  "app.deployed",
  "app.failed",
  "app.stopped",
  "app.started",
  // Database events
  "database.created",
  "database.failed",
  "database.deleted",
  // Alert events
  "alert.created",
  "alert.resolved",
  // Node events
  "node.offline",
  "node.online",
  // Backup events
  "backup.completed",
  "backup.failed",
] as const;
export type TWebhookEvent = (typeof webhookEvents)[number];

export const webhookTypes = ["slack", "discord", "email", "custom"] as const;
export type TWebhookType = (typeof webhookTypes)[number];

export const webhookStatuses = ["success", "failed"] as const;
export type TWebhookStatus = (typeof webhookStatuses)[number];

// =============================================================================
// Types
// =============================================================================

export type TWebhook = {
  _id?: ObjectId;
  organizationId?: ObjectId;   // Organization this webhook belongs to (multi-tenancy)
  name: string;
  type: TWebhookType;
  url: string; // Webhook URL or email address
  events: TWebhookEvent[]; // Events to trigger on
  secret?: string; // Signing secret for custom webhooks
  enabled: boolean;
  headers?: Record<string, string>; // Custom headers
  lastTriggeredAt?: Date;
  lastStatus?: TWebhookStatus;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type TWebhookInput = {
  organizationId?: string;     // Optional for backwards compat
  name: string;
  type: TWebhookType;
  url: string;
  events: TWebhookEvent[];
  secret?: string;
  enabled?: boolean;
  headers?: Record<string, string>;
};

export type TWebhookUpdate = Partial<TWebhookInput>;

// =============================================================================
// Joi Schemas
// =============================================================================

const schemaWebhookBase = {
  organizationId: Joi.string().length(24).optional(), // Optional for backwards compat
  name: Joi.string().min(1).max(100).required(),
  type: Joi.string()
    .valid(...webhookTypes)
    .required(),
  url: Joi.string().max(500).required(),
  events: Joi.array()
    .items(Joi.string().valid(...webhookEvents))
    .min(1)
    .required(),
  secret: Joi.string().max(200).optional(),
  enabled: Joi.boolean().optional(),
  headers: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
};

export const schemaWebhookCreate = Joi.object({
  ...schemaWebhookBase,
});

export const schemaWebhookUpdate = Joi.object({
  name: Joi.string().min(1).max(100).optional(),
  type: Joi.string()
    .valid(...webhookTypes)
    .optional(),
  url: Joi.string().max(500).optional(),
  events: Joi.array()
    .items(Joi.string().valid(...webhookEvents))
    .min(1)
    .optional(),
  secret: Joi.string().max(200).optional().allow(""),
  enabled: Joi.boolean().optional(),
  headers: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
});

// =============================================================================
// Model Function
// =============================================================================

export function modelWebhook(data: TWebhookInput): Omit<TWebhook, "_id"> {
  const { error, value } = schemaWebhookCreate.validate(data);

  if (error) {
    throw new BadRequestError(`Webhook validation error: ${error.message}`);
  }

  // Validate URL based on type
  if (value.type === "slack") {
    if (!value.url.includes("hooks.slack.com")) {
      throw new BadRequestError("Slack webhooks must use hooks.slack.com URL");
    }
  } else if (value.type === "discord") {
    if (!value.url.includes("discord.com/api/webhooks")) {
      throw new BadRequestError("Discord webhooks must use discord.com/api/webhooks URL");
    }
  } else if (value.type === "email") {
    // For email type, URL should be an email address
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value.url)) {
      throw new BadRequestError("Email webhooks must have a valid email address as URL");
    }
  } else if (value.type === "custom") {
    // Custom webhooks require https or http
    if (!value.url.startsWith("https://") && !value.url.startsWith("http://")) {
      throw new BadRequestError("Custom webhooks must use http:// or https:// URL");
    }
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
    type: value.type,
    url: value.url,
    events: value.events,
    secret: value.secret,
    enabled: value.enabled ?? true,
    headers: value.headers || {},
    createdAt: now,
    updatedAt: now,
  };
}
