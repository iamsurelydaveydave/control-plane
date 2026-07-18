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
  appId: Joi.string().required(),
  serverId: Joi.string().required(),
  port: Joi.number().required(),
  containerId: Joi.string().optional(),
});

export function modelInstance(data: Partial<TInstance>): TInstance {
  const { error, value } = schemaInstanceCreate.validate(data);

  if (error) {
    throw new BadRequestError(`Instance validation error: ${error.message}`);
  }

  return {
    _id: data._id,
    appId: new ObjectId(value.appId),
    serverId: new ObjectId(value.serverId),
    containerId: value.containerId,
    port: value.port,
    status: "stopped",
    createdAt: data.createdAt ?? new Date(),
    updatedAt: data.updatedAt ?? new Date(),
  };
}
