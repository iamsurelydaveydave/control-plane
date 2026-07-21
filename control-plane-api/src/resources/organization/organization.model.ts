import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils/error";

// =============================================================================
// Enums
// =============================================================================

export const organizationPlans = ["free", "starter", "pro", "enterprise"] as const;
export type TOrganizationPlan = (typeof organizationPlans)[number];

// =============================================================================
// Plan Limits
// =============================================================================

export const PLAN_LIMITS: Record<TOrganizationPlan, {
  maxApps: number;
  maxDatabases: number;
  maxUsers: number;
  maxStorage: number; // GB, -1 = unlimited
}> = {
  free: { maxApps: 2, maxDatabases: 1, maxUsers: 3, maxStorage: 5 },
  starter: { maxApps: 10, maxDatabases: 5, maxUsers: 10, maxStorage: 50 },
  pro: { maxApps: 50, maxDatabases: 25, maxUsers: 50, maxStorage: 500 },
  enterprise: { maxApps: -1, maxDatabases: -1, maxUsers: -1, maxStorage: -1 }, // -1 = unlimited
};

// =============================================================================
// Types
// =============================================================================

export type TOrganizationLimits = {
  maxApps: number;
  maxDatabases: number;
  maxUsers: number;
  maxStorage: number; // GB
};

export type TOrganizationUsage = {
  apps: number;
  databases: number;
  users: number;
  storage: number; // GB
};

export type TOrganizationSettings = {
  defaultClusterId?: string;
  allowedDomains?: string[]; // Restrict user email domains
};

export type TOrganization = {
  _id?: ObjectId;
  name: string;
  slug: string; // URL-friendly identifier
  plan: TOrganizationPlan;
  limits: TOrganizationLimits;
  usage: TOrganizationUsage;
  settings: TOrganizationSettings;
  billingEmail?: string;
  ownerId: ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export type TOrganizationInput = {
  name: string;
  slug?: string;
  plan?: TOrganizationPlan;
  settings?: Partial<TOrganizationSettings>;
  billingEmail?: string;
  ownerId: string;
};

export type TOrganizationUpdateInput = Partial<{
  name: string;
  slug: string;
  plan: TOrganizationPlan;
  settings: Partial<TOrganizationSettings>;
  billingEmail: string;
}>;

// =============================================================================
// Joi Schemas
// =============================================================================

const schemaSettings = Joi.object({
  defaultClusterId: Joi.string().length(24).optional(),
  allowedDomains: Joi.array().items(Joi.string().domain()).optional(),
});

export const schemaOrganizationCreate = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  slug: Joi.string()
    .min(2)
    .max(50)
    .pattern(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/)
    .optional()
    .messages({
      "string.pattern.base":
        "Slug must start and end with a letter or number, and contain only lowercase letters, numbers, and hyphens",
    }),
  plan: Joi.string()
    .valid(...organizationPlans)
    .default("free"),
  settings: schemaSettings.default({}),
  billingEmail: Joi.string().email().optional(),
  ownerId: Joi.string().length(24).required(),
});

export const schemaOrganizationUpdate = Joi.object<TOrganizationUpdateInput>({
  name: Joi.string().min(1).max(100).optional(),
  slug: Joi.string()
    .min(2)
    .max(50)
    .pattern(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/)
    .optional(),
  plan: Joi.string()
    .valid(...organizationPlans)
    .optional(),
  settings: schemaSettings.optional(),
  billingEmail: Joi.string().email().optional().allow(""),
});

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate a slug from a name.
 * Converts to lowercase, replaces spaces with hyphens, removes special characters.
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

// =============================================================================
// Model Function
// =============================================================================

/**
 * Validate and normalize organization data for creation.
 * - Validates all fields via Joi
 * - Converts ownerId to ObjectId
 * - Sets plan limits based on plan type
 * - Sets initial usage to zero
 * - Sets timestamps
 */
export function modelOrganization(data: TOrganizationInput): Omit<TOrganization, "_id"> {
  const { error, value } = schemaOrganizationCreate.validate(data, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    throw new BadRequestError(
      `Organization validation error: ${error.details.map((d) => d.message).join(", ")}`
    );
  }

  // Convert ownerId to ObjectId
  let ownerId: ObjectId;
  try {
    ownerId = new ObjectId(value.ownerId);
  } catch {
    throw new BadRequestError(`Invalid ownerId format: ${value.ownerId}`);
  }

  // Generate slug if not provided
  const slug = value.slug || generateSlug(value.name);
  if (!slug) {
    throw new BadRequestError("Could not generate a valid slug from the organization name");
  }

  // Get plan limits
  const plan = value.plan as TOrganizationPlan;
  const limits = { ...PLAN_LIMITS[plan] };

  const now = new Date();

  return {
    name: value.name,
    slug,
    plan,
    limits,
    usage: {
      apps: 0,
      databases: 0,
      users: 1, // Owner counts as first user
      storage: 0,
    },
    settings: value.settings || {},
    billingEmail: value.billingEmail,
    ownerId,
    createdAt: now,
    updatedAt: now,
  };
}
