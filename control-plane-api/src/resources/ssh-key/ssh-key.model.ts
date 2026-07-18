import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils";

export type TSSHKey = {
  _id?: ObjectId;
  name: string;
  publicKey: string;
  privateKey: string; // Encrypted at rest
  fingerprint: string;
  type: "ed25519" | "rsa";
  isDefault: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

export type TSSHKeyPublic = Omit<TSSHKey, "privateKey">;

const schemaSSHKeyBase = {
  name: Joi.string().max(100).required(),
  publicKey: Joi.string().required(),
  privateKey: Joi.string().required(),
  fingerprint: Joi.string().required(),
  type: Joi.string().valid("ed25519", "rsa").default("ed25519"),
  isDefault: Joi.boolean().default(false),
};

export const schemaSSHKeyCreate = Joi.object({
  ...schemaSSHKeyBase,
});

export const schemaSSHKeyUpdate = Joi.object({
  name: Joi.string().max(100).optional(),
  isDefault: Joi.boolean().optional(),
});

export function modelSSHKey(data: Partial<TSSHKey>): TSSHKey {
  const { error, value } = schemaSSHKeyCreate.validate(data);

  if (error) {
    throw new BadRequestError(`SSH Key validation error: ${error.message}`);
  }

  if (data._id && typeof data._id === "string") {
    try {
      data._id = new ObjectId(data._id);
    } catch {
      throw new BadRequestError(`Invalid _id format: ${data._id}`);
    }
  }

  return {
    _id: data._id,
    name: value.name,
    publicKey: value.publicKey,
    privateKey: value.privateKey,
    fingerprint: value.fingerprint,
    type: value.type,
    isDefault: value.isDefault,
    createdAt: data.createdAt ?? new Date(),
    updatedAt: data.updatedAt ?? new Date(),
  };
}

/** Strip private key for API responses */
export function toPublicSSHKey(key: TSSHKey): TSSHKeyPublic {
  const { privateKey: _, ...publicKey } = key;
  return publicKey;
}
