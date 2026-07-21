import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils";
import type { TPermission } from "../role";

export type TUser = {
  _id?: ObjectId;
  email: string;
  password: string;
  role: "admin";  // Legacy field - kept for backwards compatibility
  roleId?: ObjectId;  // Reference to role
  customPermissions?: TPermission[];  // Override/additional permissions
  createdAt?: Date;
  updatedAt?: Date;
};

export const schemaUserCreate = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
});

export const schemaUserUpdate = Joi.object({
  email: Joi.string().email().optional(),
  password: Joi.string().min(8).optional(),
  roleId: Joi.string().optional().allow(null),
  customPermissions: Joi.array().items(Joi.string()).optional(),
});

export function modelUser(data: Partial<TUser>): TUser {
  const { error } = schemaUserCreate.validate({
    email: data.email,
    password: data.password,
  });

  if (error) {
    throw new BadRequestError(`User validation error: ${error.message}`);
  }

  if (data._id && typeof data._id === "string") {
    try {
      data._id = new ObjectId(data._id);
    } catch {
      throw new BadRequestError(`Invalid _id format: ${data._id}`);
    }
  }

  // Handle roleId conversion
  let roleId: ObjectId | undefined;
  if (data.roleId) {
    if (typeof data.roleId === "string") {
      try {
        roleId = new ObjectId(data.roleId);
      } catch {
        throw new BadRequestError(`Invalid roleId format: ${data.roleId}`);
      }
    } else {
      roleId = data.roleId;
    }
  }

  return {
    _id: data._id,
    email: data.email!,
    password: data.password!,
    role: "admin",
    roleId,
    customPermissions: data.customPermissions,
    createdAt: data.createdAt ?? new Date(),
    updatedAt: data.updatedAt ?? new Date(),
  };
}
