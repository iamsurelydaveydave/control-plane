import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils/error";

// =============================================================================
// Enums
// =============================================================================

export const sshKeyTypes = ["ed25519", "rsa"] as const;
export type TSSHKeyType = (typeof sshKeyTypes)[number];

// =============================================================================
// Types
// =============================================================================

export type TSSHKey = {
  _id?: ObjectId;
  name: string;
  publicKey: string;
  privateKey: string;        // Encrypted
  fingerprint: string;
  type: TSSHKeyType;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
};

// Response type - never includes private key
export type TSSHKeyResponse = {
  _id: string;
  name: string;
  publicKey: string;
  fingerprint: string;
  type: TSSHKeyType;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
};

// =============================================================================
// Joi Schemas
// =============================================================================

export const schemaSSHKeyCreate = Joi.object({
  name: Joi.string().max(100).required(),
  type: Joi.string().valid(...sshKeyTypes).required(),
  isDefault: Joi.boolean().default(false),
});

export const schemaSSHKeyImport = Joi.object({
  name: Joi.string().max(100).required(),
  privateKey: Joi.string().required(),
  isDefault: Joi.boolean().default(false),
});

export const schemaSSHKeyUpdate = Joi.object({
  name: Joi.string().max(100).optional(),
  isDefault: Joi.boolean().optional(),
});

// =============================================================================
// Model Function
// =============================================================================

export function modelSSHKey(data: {
  name: string;
  publicKey: string;
  privateKey: string;
  fingerprint: string;
  type: TSSHKeyType;
  isDefault?: boolean;
}): Omit<TSSHKey, "_id"> {
  const now = new Date();

  return {
    name: data.name,
    publicKey: data.publicKey,
    privateKey: data.privateKey,
    fingerprint: data.fingerprint,
    type: data.type,
    isDefault: data.isDefault ?? false,
    createdAt: now,
    updatedAt: now,
  };
}

// =============================================================================
// Helper to convert to response (strips private key)
// =============================================================================

export function sshKeyToResponse(key: TSSHKey): TSSHKeyResponse {
  return {
    _id: key._id!.toString(),
    name: key.name,
    publicKey: key.publicKey,
    fingerprint: key.fingerprint,
    type: key.type,
    isDefault: key.isDefault,
    createdAt: key.createdAt,
    updatedAt: key.updatedAt,
  };
}
