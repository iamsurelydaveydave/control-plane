import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils/error";
import { taskRunStatuses, TTaskRunStatus } from "./scheduled-task.model";

// =============================================================================
// Types
// =============================================================================

export type TTaskHistory = {
  _id?: ObjectId;
  taskId: ObjectId;
  status: TTaskRunStatus;
  startedAt: Date;
  completedAt: Date;
  duration: number;      // milliseconds
  error?: string;
  output?: string;
};

// =============================================================================
// Input types
// =============================================================================

export type TTaskHistoryInput = {
  taskId: string;
  status: TTaskRunStatus;
  startedAt: Date;
  completedAt: Date;
  duration: number;
  error?: string;
  output?: string;
};

// =============================================================================
// Joi Schemas
// =============================================================================

export const schemaTaskHistoryCreate = Joi.object({
  taskId: Joi.string().length(24).required(),
  status: Joi.string().valid(...taskRunStatuses).required(),
  startedAt: Joi.date().required(),
  completedAt: Joi.date().required(),
  duration: Joi.number().integer().min(0).required(),
  error: Joi.string().max(10000).optional(),
  output: Joi.string().max(50000).optional(),
});

// =============================================================================
// Model Function
// =============================================================================

/**
 * Validate and normalize task history data for creation.
 * - Validates all fields via Joi
 * - Converts taskId to ObjectId
 */
export function modelTaskHistory(data: TTaskHistoryInput): Omit<TTaskHistory, "_id"> {
  const { error, value } = schemaTaskHistoryCreate.validate(data, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    throw new BadRequestError(
      `Task history validation error: ${error.details.map((d) => d.message).join(", ")}`
    );
  }

  let taskId: ObjectId;
  try {
    taskId = new ObjectId(value.taskId);
  } catch {
    throw new BadRequestError("Invalid taskId format");
  }

  return {
    taskId,
    status: value.status as TTaskRunStatus,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    duration: value.duration,
    ...(value.error && { error: value.error }),
    ...(value.output && { output: value.output }),
  };
}
