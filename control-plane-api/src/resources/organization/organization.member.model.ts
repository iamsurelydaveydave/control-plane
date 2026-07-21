import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils/error";

// =============================================================================
// Types
// =============================================================================

export type TOrganizationMember = {
  _id?: ObjectId;
  organizationId: ObjectId;
  userId: ObjectId;
  roleId: ObjectId; // Role within this org
  invitedBy?: ObjectId;
  invitedAt?: Date;
  joinedAt: Date;
};

export type TOrganizationMemberInput = {
  organizationId: string;
  userId: string;
  roleId: string;
  invitedBy?: string;
  invitedAt?: Date;
};

// =============================================================================
// Joi Schemas
// =============================================================================

export const schemaOrganizationMemberCreate = Joi.object({
  organizationId: Joi.string().length(24).required(),
  userId: Joi.string().length(24).required(),
  roleId: Joi.string().length(24).required(),
  invitedBy: Joi.string().length(24).optional(),
  invitedAt: Joi.date().optional(),
});

export const schemaOrganizationMemberUpdateRole = Joi.object({
  roleId: Joi.string().length(24).required(),
});

// =============================================================================
// Model Function
// =============================================================================

/**
 * Validate and normalize organization member data for creation.
 * - Validates all fields via Joi
 * - Converts string IDs to ObjectId
 * - Sets joinedAt timestamp
 */
export function modelOrganizationMember(
  data: TOrganizationMemberInput
): Omit<TOrganizationMember, "_id"> {
  const { error, value } = schemaOrganizationMemberCreate.validate(data, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    throw new BadRequestError(
      `Organization member validation error: ${error.details.map((d) => d.message).join(", ")}`
    );
  }

  // Convert string IDs to ObjectId
  let organizationId: ObjectId;
  let userId: ObjectId;
  let roleId: ObjectId;
  let invitedBy: ObjectId | undefined;

  try {
    organizationId = new ObjectId(value.organizationId);
  } catch {
    throw new BadRequestError(`Invalid organizationId format: ${value.organizationId}`);
  }

  try {
    userId = new ObjectId(value.userId);
  } catch {
    throw new BadRequestError(`Invalid userId format: ${value.userId}`);
  }

  try {
    roleId = new ObjectId(value.roleId);
  } catch {
    throw new BadRequestError(`Invalid roleId format: ${value.roleId}`);
  }

  if (value.invitedBy) {
    try {
      invitedBy = new ObjectId(value.invitedBy);
    } catch {
      throw new BadRequestError(`Invalid invitedBy format: ${value.invitedBy}`);
    }
  }

  return {
    organizationId,
    userId,
    roleId,
    invitedBy,
    invitedAt: value.invitedAt,
    joinedAt: new Date(),
  };
}
