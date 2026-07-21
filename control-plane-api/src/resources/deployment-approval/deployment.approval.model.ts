import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils/error";

// =============================================================================
// Enums
// =============================================================================

export const deploymentApprovalStatuses = ["pending", "approved", "rejected"] as const;
export type TDeploymentApprovalStatus = (typeof deploymentApprovalStatuses)[number];

export const deploymentEnvironments = ["development", "staging", "production"] as const;
export type TDeploymentEnvironment = (typeof deploymentEnvironments)[number];

// =============================================================================
// Types
// =============================================================================

export type TDeploymentApproval = {
  _id?: ObjectId;
  appId: ObjectId;
  version: string;
  environment: TDeploymentEnvironment;
  status: TDeploymentApprovalStatus;
  requestedBy: ObjectId;
  requestedAt: Date;
  approvedBy?: ObjectId;
  approvedAt?: Date;
  rejectedBy?: ObjectId;
  rejectedAt?: Date;
  rejectionReason?: string;
  deploymentId?: ObjectId; // Set when deployment is triggered after approval
  expiresAt: Date; // Auto-expire pending approvals
};

export type TDeploymentApprovalInput = {
  appId: string;
  version: string;
  environment: TDeploymentEnvironment;
  requestedBy: string;
};

// =============================================================================
// Joi Schemas
// =============================================================================

export const schemaDeploymentApprovalCreate = Joi.object({
  appId: Joi.string().required(),
  version: Joi.string().required(),
  environment: Joi.string()
    .valid(...deploymentEnvironments)
    .required(),
});

export const schemaDeploymentApprovalReject = Joi.object({
  reason: Joi.string().max(500).optional(),
});

// =============================================================================
// Model Function
// =============================================================================

export function modelDeploymentApproval(
  data: TDeploymentApprovalInput
): Omit<TDeploymentApproval, "_id"> {
  const { error, value } = schemaDeploymentApprovalCreate.validate({
    appId: data.appId,
    version: data.version,
    environment: data.environment,
  });

  if (error) {
    throw new BadRequestError(`Deployment approval validation error: ${error.message}`);
  }

  let appId: ObjectId;
  let requestedBy: ObjectId;

  try {
    appId = new ObjectId(data.appId);
  } catch {
    throw new BadRequestError("Invalid app ID format.");
  }

  try {
    requestedBy = new ObjectId(data.requestedBy);
  } catch {
    throw new BadRequestError("Invalid user ID format.");
  }

  const now = new Date();
  // Approval expires in 24 hours
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  return {
    appId,
    version: value.version,
    environment: value.environment,
    status: "pending",
    requestedBy,
    requestedAt: now,
    expiresAt,
  };
}
