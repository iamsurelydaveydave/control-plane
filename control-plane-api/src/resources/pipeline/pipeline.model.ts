import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils/error";

// =============================================================================
// Enums
// =============================================================================

export const pipelineStatuses = ["active", "paused", "archived"] as const;
export type TPipelineStatus = (typeof pipelineStatuses)[number];

export const stageNames = ["development", "staging", "production"] as const;
export type TStageName = (typeof stageNames)[number];

export const stageStatuses = ["pending", "deployed", "failed"] as const;
export type TStageStatus = (typeof stageStatuses)[number];

export const pipelineSourceTypes = ["git", "image"] as const;
export type TPipelineSourceType = (typeof pipelineSourceTypes)[number];

export const promotionStrategies = ["manual", "auto", "scheduled"] as const;
export type TPromotionStrategy = (typeof promotionStrategies)[number];

export const promotionStatuses = ["pending", "approved", "rejected", "deployed", "failed"] as const;
export type TPromotionStatus = (typeof promotionStatuses)[number];

// =============================================================================
// Types
// =============================================================================

export type TPipelineStage = {
  name: TStageName;
  appId?: ObjectId;                   // Reference to deployed app in this stage
  namespace: string;                  // K8s namespace for this stage
  autoPromote: boolean;               // Auto-promote on successful deploy
  approvalRequired: boolean;          // Require approval before promotion
  approvers?: ObjectId[];             // User IDs who can approve
  lastDeployedVersion?: string;
  lastDeployedAt?: Date;
  status: TStageStatus;
};

export type TPipelineSource = {
  type: TPipelineSourceType;
  repository?: string;                // Git repo URL
  branch?: string;                    // Default branch for dev
  imageRepository?: string;           // Docker image repo
};

export type TPipeline = {
  _id?: ObjectId;
  name: string;
  description?: string;
  status: TPipelineStatus;

  // Source
  source: TPipelineSource;

  // Stages
  stages: TPipelineStage[];

  // Promotion rules
  promotionStrategy: TPromotionStrategy;

  organizationId?: ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

// Promotion record
export type TPromotion = {
  _id?: ObjectId;
  pipelineId: ObjectId;
  fromStage: TStageName;
  toStage: TStageName;
  version: string;
  status: TPromotionStatus;
  requestedBy: ObjectId;
  approvedBy?: ObjectId;
  approvedAt?: Date;
  rejectedBy?: ObjectId;
  rejectedAt?: Date;
  rejectionReason?: string;
  deployedAt?: Date;
  notes?: string;
  createdAt: Date;
};

// =============================================================================
// Input types (for create/update)
// =============================================================================

export type TPipelineCreate = {
  name: string;
  description?: string;
  source: {
    type: TPipelineSourceType;
    repository?: string;
    branch?: string;
    imageRepository?: string;
  };
  promotionStrategy?: TPromotionStrategy;
  organizationId?: string;
  stages?: Array<{
    name: TStageName;
    namespace?: string;
    autoPromote?: boolean;
    approvalRequired?: boolean;
    approvers?: string[];
  }>;
};

export type TPipelineUpdate = Partial<{
  name: string;
  description: string;
  status: TPipelineStatus;
  source: Partial<TPipelineSource>;
  promotionStrategy: TPromotionStrategy;
  stages: Array<{
    name: TStageName;
    namespace?: string;
    autoPromote?: boolean;
    approvalRequired?: boolean;
    approvers?: string[];
  }>;
}>;

export type TPromotionCreate = {
  pipelineId: string;
  fromStage: TStageName;
  toStage: TStageName;
  version: string;
  requestedBy: string;
  notes?: string;
};

// =============================================================================
// Joi Schemas
// =============================================================================

const schemaStage = Joi.object({
  name: Joi.string()
    .valid(...stageNames)
    .required(),
  namespace: Joi.string().optional(),
  autoPromote: Joi.boolean().default(false),
  approvalRequired: Joi.boolean().default(false),
  approvers: Joi.array().items(Joi.string()).optional(),
});

const schemaSource = Joi.object({
  type: Joi.string()
    .valid(...pipelineSourceTypes)
    .required(),
  repository: Joi.string().when("type", {
    is: "git",
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  branch: Joi.string().when("type", {
    is: "git",
    then: Joi.string().default("main"),
    otherwise: Joi.optional(),
  }),
  imageRepository: Joi.string().when("type", {
    is: "image",
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
});

export const schemaPipelineCreate = Joi.object({
  name: Joi.string()
    .min(2)
    .max(100)
    .pattern(/^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/)
    .required()
    .messages({
      "string.pattern.base": "Name must start/end with alphanumeric and contain only alphanumeric/hyphens",
    }),
  description: Joi.string().max(500).optional(),
  source: schemaSource.required(),
  promotionStrategy: Joi.string()
    .valid(...promotionStrategies)
    .default("manual"),
  organizationId: Joi.string().optional(),
  stages: Joi.array().items(schemaStage).optional(),
});

export const schemaPipelineUpdate = Joi.object({
  name: Joi.string()
    .min(2)
    .max(100)
    .pattern(/^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/)
    .optional(),
  description: Joi.string().max(500).optional().allow(""),
  status: Joi.string()
    .valid(...pipelineStatuses)
    .optional(),
  source: Joi.object({
    type: Joi.string().valid(...pipelineSourceTypes).optional(),
    repository: Joi.string().optional(),
    branch: Joi.string().optional(),
    imageRepository: Joi.string().optional(),
  }).optional(),
  promotionStrategy: Joi.string()
    .valid(...promotionStrategies)
    .optional(),
  stages: Joi.array().items(schemaStage).optional(),
});

export const schemaPromotionCreate = Joi.object({
  fromStage: Joi.string()
    .valid(...stageNames)
    .required(),
  toStage: Joi.string()
    .valid(...stageNames)
    .required(),
  version: Joi.string().optional(),
  notes: Joi.string().max(500).optional(),
});

export const schemaPromotionReject = Joi.object({
  reason: Joi.string().max(500).optional(),
});

export const schemaDeployToStage = Joi.object({
  version: Joi.string().required(),
});

export const schemaRollback = Joi.object({
  version: Joi.string().required(),
});

// =============================================================================
// Model Functions
// =============================================================================

/**
 * Build default stages with dev → staging → prod pipeline.
 */
function buildDefaultStages(pipelineName: string, customStages?: TPipelineCreate["stages"]): TPipelineStage[] {
  const defaultStages: TPipelineStage[] = [
    {
      name: "development",
      namespace: `${pipelineName}-dev`,
      autoPromote: false,
      approvalRequired: false,
      status: "pending",
    },
    {
      name: "staging",
      namespace: `${pipelineName}-staging`,
      autoPromote: false,
      approvalRequired: true,
      status: "pending",
    },
    {
      name: "production",
      namespace: `${pipelineName}-prod`,
      autoPromote: false,
      approvalRequired: true,
      status: "pending",
    },
  ];

  if (!customStages || customStages.length === 0) {
    return defaultStages;
  }

  // Merge custom stages with defaults
  return defaultStages.map((defaultStage) => {
    const customStage = customStages.find((s) => s.name === defaultStage.name);
    if (!customStage) return defaultStage;

    let approvers: ObjectId[] | undefined;
    if (customStage.approvers) {
      approvers = customStage.approvers.map((id) => {
        try {
          return new ObjectId(id);
        } catch {
          throw new BadRequestError(`Invalid approver ID format: ${id}`);
        }
      });
    }

    return {
      ...defaultStage,
      namespace: customStage.namespace || defaultStage.namespace,
      autoPromote: customStage.autoPromote ?? defaultStage.autoPromote,
      approvalRequired: customStage.approvalRequired ?? defaultStage.approvalRequired,
      approvers,
    };
  });
}

/**
 * Create and validate a new pipeline record.
 */
export function modelPipeline(data: TPipelineCreate): Omit<TPipeline, "_id"> {
  const { error, value } = schemaPipelineCreate.validate(data);
  if (error) {
    throw new BadRequestError(`Pipeline validation error: ${error.message}`);
  }

  let organizationId: ObjectId | undefined;
  if (value.organizationId) {
    try {
      organizationId = new ObjectId(value.organizationId);
    } catch {
      throw new BadRequestError("Invalid organization ID format.");
    }
  }

  const now = new Date();

  return {
    name: value.name,
    description: value.description,
    status: "active",
    source: {
      type: value.source.type,
      repository: value.source.repository,
      branch: value.source.branch,
      imageRepository: value.source.imageRepository,
    },
    stages: buildDefaultStages(value.name, value.stages),
    promotionStrategy: value.promotionStrategy,
    organizationId,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Create and validate a new promotion record.
 */
export function modelPromotion(data: TPromotionCreate): Omit<TPromotion, "_id"> {
  const { error, value } = schemaPromotionCreate.validate({
    fromStage: data.fromStage,
    toStage: data.toStage,
    version: data.version,
    notes: data.notes,
  });

  if (error) {
    throw new BadRequestError(`Promotion validation error: ${error.message}`);
  }

  let pipelineId: ObjectId;
  let requestedBy: ObjectId;

  try {
    pipelineId = new ObjectId(data.pipelineId);
  } catch {
    throw new BadRequestError("Invalid pipeline ID format.");
  }

  try {
    requestedBy = new ObjectId(data.requestedBy);
  } catch {
    throw new BadRequestError("Invalid user ID format.");
  }

  // Validate stage progression order
  const fromIndex = stageNames.indexOf(value.fromStage);
  const toIndex = stageNames.indexOf(value.toStage);

  if (toIndex <= fromIndex) {
    throw new BadRequestError(`Cannot promote from ${value.fromStage} to ${value.toStage}. Promotions must be to a later stage.`);
  }

  if (toIndex - fromIndex > 1) {
    throw new BadRequestError(`Cannot skip stages. Must promote from ${value.fromStage} to ${stageNames[fromIndex + 1]}.`);
  }

  return {
    pipelineId,
    fromStage: value.fromStage,
    toStage: value.toStage,
    version: value.version,
    status: "pending",
    requestedBy,
    notes: value.notes,
    createdAt: new Date(),
  };
}
