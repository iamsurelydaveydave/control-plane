import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils";

export const instanceStatuses = ["running", "stopped", "starting", "unhealthy"] as const;
export type TInstanceStatus = (typeof instanceStatuses)[number];

export type TInstance = {
  _id?: ObjectId;
  appId: ObjectId;
  serverId: ObjectId;
  containerId?: string;
  port: number;
  status: TInstanceStatus;
  createdAt?: Date;
  updatedAt?: Date;
  lastHealthCheck?: Date;
};

export const schemaInstanceCreate = Joi.object({
  appId: Joi.alternatives().try(Joi.string(), Joi.object()).required(),
  serverId: Joi.alternatives().try(Joi.string(), Joi.object()).required(),
  port: Joi.number().required(),
  containerId: Joi.string().optional(),
});

export function modelInstance(data: Partial<TInstance>): TInstance {
  const { error, value } = schemaInstanceCreate.validate(data);

  if (error) {
    throw new BadRequestError(`Instance validation error: ${error.message}`);
  }

  // Handle appId - could be string or ObjectId
  let appId: ObjectId;
  if (value.appId instanceof ObjectId) {
    appId = value.appId;
  } else {
    appId = new ObjectId(value.appId);
  }

  // Handle serverId - could be string or ObjectId
  let serverId: ObjectId;
  if (value.serverId instanceof ObjectId) {
    serverId = value.serverId;
  } else {
    serverId = new ObjectId(value.serverId);
  }

  return {
    _id: data._id,
    appId,
    serverId,
    containerId: value.containerId,
    port: value.port,
    status: "stopped",
    createdAt: data.createdAt ?? new Date(),
    updatedAt: data.updatedAt ?? new Date(),
  };
}
