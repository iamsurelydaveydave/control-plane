import Joi from "joi";
import { ObjectId } from "mongodb";
import crypto from "crypto";
import { BadRequestError } from "../../utils/error";

// =============================================================================
// Types
// =============================================================================

export type TOrganizationInvite = {
  _id?: ObjectId;
  organizationId: ObjectId;
  email: string;
  roleId: ObjectId;
  token: string; // Unique invite token
  invitedBy: ObjectId;
  expiresAt: Date;
  acceptedAt?: Date;
  createdAt: Date;
};

export type TOrganizationInviteInput = {
  organizationId: string;
  email: string;
  roleId: string;
  invitedBy: string;
  expiresInDays?: number; // Default 7 days
};

// =============================================================================
// Joi Schemas
// =============================================================================

export const schemaOrganizationInviteCreate = Joi.object({
  organizationId: Joi.string().length(24).required(),
  email: Joi.string().email().required(),
  roleId: Joi.string().length(24).required(),
  invitedBy: Joi.string().length(24).required(),
  expiresInDays: Joi.number().integer().min(1).max(30).default(7),
});

export const schemaInviteMember = Joi.object({
  email: Joi.string().email().required(),
  roleId: Joi.string().length(24).required(),
});

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate a secure random invite token.
 */
export function generateInviteToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// =============================================================================
// Model Function
// =============================================================================

/**
 * Validate and normalize organization invite data for creation.
 * - Validates all fields via Joi
 * - Converts string IDs to ObjectId
 * - Generates invite token
 * - Sets expiration date
 * - Sets timestamps
 */
export function modelOrganizationInvite(
  data: TOrganizationInviteInput
): Omit<TOrganizationInvite, "_id"> {
  const { error, value } = schemaOrganizationInviteCreate.validate(data, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    throw new BadRequestError(
      `Organization invite validation error: ${error.details.map((d) => d.message).join(", ")}`
    );
  }

  // Convert string IDs to ObjectId
  let organizationId: ObjectId;
  let roleId: ObjectId;
  let invitedBy: ObjectId;

  try {
    organizationId = new ObjectId(value.organizationId);
  } catch {
    throw new BadRequestError(`Invalid organizationId format: ${value.organizationId}`);
  }

  try {
    roleId = new ObjectId(value.roleId);
  } catch {
    throw new BadRequestError(`Invalid roleId format: ${value.roleId}`);
  }

  try {
    invitedBy = new ObjectId(value.invitedBy);
  } catch {
    throw new BadRequestError(`Invalid invitedBy format: ${value.invitedBy}`);
  }

  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + (value.expiresInDays || 7));

  return {
    organizationId,
    email: value.email.toLowerCase().trim(),
    roleId,
    token: generateInviteToken(),
    invitedBy,
    expiresAt,
    createdAt: now,
  };
}
