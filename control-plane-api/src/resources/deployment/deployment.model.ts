import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils";

export const deploymentStatuses = ["pending", "running", "success", "failed"] as const;
export type TDeploymentStatus = (typeof deploymentStatuses)[number];

export type TDeployment = {
  _id?: ObjectId;
  appId: ObjectId;
  image: string;
  version?: string;          // Semantic version or git SHA
  environment?: string;      // development, staging, production
  status: TDeploymentStatus;
  triggeredBy: ObjectId;
  triggeredByToken?: boolean; // true if triggered via API token (CI/CD)
  logs?: string;
  startedAt?: Date;
  completedAt?: Date;
  duration?: number;         // Duration in milliseconds
  url?: string;              // Deployment URL
  gitSha?: string;           // Git commit SHA
  gitRef?: string;           // Git ref (branch/tag)
};

/** Input type for creating a deployment — accepts strings (Joi validates + modelDeployment converts to ObjectId). */
export type TDeploymentInput = {
  appId: string;
  image: string;
  triggeredBy: string;
  triggeredByToken?: boolean;
  version?: string;
  environment?: string;
  gitSha?: string;
  gitRef?: string;
};

export const schemaDeploymentCreate = Joi.object({
  appId: Joi.string().required(),
  image: Joi.string().required(),
  triggeredBy: Joi.string().required(),
  triggeredByToken: Joi.boolean().optional(),
  version: Joi.string().optional(),
  environment: Joi.string().valid("development", "staging", "production").optional(),
  gitSha: Joi.string().optional(),
  gitRef: Joi.string().optional(),
});

export function modelDeployment(data: TDeploymentInput): TDeployment {
  const { error, value } = schemaDeploymentCreate.validate(data);

  if (error) {
    throw new BadRequestError(`Deployment validation error: ${error.message}`);
  }

  return {
    appId: new ObjectId(value.appId),
    image: value.image,
    version: value.version,
    environment: value.environment,
    status: "pending",
    triggeredBy: new ObjectId(value.triggeredBy),
    triggeredByToken: value.triggeredByToken || false,
    logs: "",
    startedAt: new Date(),
    gitSha: value.gitSha,
    gitRef: value.gitRef,
  };
}
