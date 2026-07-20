import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils";

export const deploymentStatuses = ["pending", "running", "success", "failed"] as const;
export type TDeploymentStatus = (typeof deploymentStatuses)[number];

export type TDeployment = {
  _id?: ObjectId;
  appId: ObjectId;
  image: string;
  status: TDeploymentStatus;
  triggeredBy: ObjectId;
  logs?: string;
  startedAt?: Date;
  completedAt?: Date;
};

/** Input type for creating a deployment — accepts strings (Joi validates + modelDeployment converts to ObjectId). */
export type TDeploymentInput = {
  appId: string;
  image: string;
  triggeredBy: string;
};

export const schemaDeploymentCreate = Joi.object({
  appId: Joi.string().required(),
  image: Joi.string().required(),
  triggeredBy: Joi.string().required(),
});

export function modelDeployment(data: TDeploymentInput): TDeployment {
  const { error, value } = schemaDeploymentCreate.validate(data);

  if (error) {
    throw new BadRequestError(`Deployment validation error: ${error.message}`);
  }

  return {
    appId: new ObjectId(value.appId),
    image: value.image,
    status: "pending",
    triggeredBy: new ObjectId(value.triggeredBy),
    logs: "",
    startedAt: new Date(),
  };
}
