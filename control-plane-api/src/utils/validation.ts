import { Request, Response, NextFunction } from "express";
import { ObjectId } from "mongodb";
import Joi from "joi";
import { BadRequestError } from "./error";

// ---------------------------------------------------------------------------
// ObjectId Validation
// ---------------------------------------------------------------------------

/**
 * Validate that a string is a valid MongoDB ObjectId format.
 * Returns the validated ID string, or throws BadRequestError.
 */
export function validateObjectId(id: unknown, fieldName = "id"): string {
  if (typeof id !== "string") {
    throw new BadRequestError(`Invalid ${fieldName}: must be a string`);
  }

  if (!id || id.trim() === "") {
    throw new BadRequestError(`Invalid ${fieldName}: cannot be empty`);
  }

  // ObjectId is 24 hex characters
  if (!/^[a-fA-F0-9]{24}$/.test(id)) {
    throw new BadRequestError(`Invalid ${fieldName} format`);
  }

  // Double-check by attempting to create an ObjectId
  try {
    new ObjectId(id);
    return id;
  } catch {
    throw new BadRequestError(`Invalid ${fieldName} format`);
  }
}

/**
 * Middleware to validate :id param as ObjectId.
 */
export function validateIdParam(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  try {
    validateObjectId(req.params.id);
    next();
  } catch (error) {
    next(error);
  }
}

// ---------------------------------------------------------------------------
// Pagination Validation
// ---------------------------------------------------------------------------

export type PaginationParams = {
  page: number;
  limit: number;
  skip: number;
};

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MIN_PAGE = 1;

/**
 * Validate and normalize pagination parameters from query string.
 * Returns { page, limit, skip } with safe defaults.
 */
export function validatePagination(query: {
  page?: unknown;
  limit?: unknown;
}): PaginationParams {
  let page = DEFAULT_PAGE;
  let limit = DEFAULT_LIMIT;

  // Parse page
  if (query.page !== undefined) {
    const parsedPage = parseInt(String(query.page), 10);
    if (!Number.isNaN(parsedPage) && parsedPage >= MIN_PAGE) {
      page = parsedPage;
    }
  }

  // Parse limit
  if (query.limit !== undefined) {
    const parsedLimit = parseInt(String(query.limit), 10);
    if (!Number.isNaN(parsedLimit) && parsedLimit > 0) {
      limit = Math.min(parsedLimit, MAX_LIMIT);
    }
  }

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
}

/**
 * Middleware to validate pagination params and attach to request.
 */
export function validatePaginationMiddleware(
  req: Request & { pagination?: PaginationParams },
  _res: Response,
  next: NextFunction
): void {
  req.pagination = validatePagination(req.query);
  next();
}

// ---------------------------------------------------------------------------
// Sort Order Validation
// ---------------------------------------------------------------------------

export type SortOrder = 1 | -1;
export type SortParams = {
  sortBy: string;
  sortOrder: SortOrder;
};

const VALID_SORT_ORDERS = ["asc", "desc", "1", "-1"];

/**
 * Validate sort parameters.
 * @param sortBy - Field to sort by
 * @param order - Sort order (asc, desc, 1, -1)
 * @param allowedFields - List of allowed sort fields (optional)
 */
export function validateSortOrder(
  sortBy: unknown,
  order: unknown,
  allowedFields?: string[]
): SortParams | null {
  // If no sort params provided, return null
  if (sortBy === undefined && order === undefined) {
    return null;
  }

  // Default sort field
  const field = typeof sortBy === "string" && sortBy.trim() ? sortBy.trim() : "createdAt";

  // Validate field against allowed list if provided
  if (allowedFields && !allowedFields.includes(field)) {
    throw new BadRequestError(
      `Invalid sort field: ${field}. Allowed: ${allowedFields.join(", ")}`
    );
  }

  // Parse order
  let sortOrder: SortOrder = -1; // Default descending (newest first)
  if (order !== undefined) {
    const orderStr = String(order).toLowerCase();
    if (!VALID_SORT_ORDERS.includes(orderStr)) {
      throw new BadRequestError(
        `Invalid sort order: ${order}. Use: asc, desc, 1, or -1`
      );
    }
    sortOrder = orderStr === "asc" || orderStr === "1" ? 1 : -1;
  }

  return { sortBy: field, sortOrder };
}

// ---------------------------------------------------------------------------
// Generic Joi Validator Middleware
// ---------------------------------------------------------------------------

export type ValidationTarget = "body" | "query" | "params";

/**
 * Create a middleware that validates request data against a Joi schema.
 * 
 * @param schema - Joi schema to validate against
 * @param target - Which part of the request to validate (body, query, params)
 * @param options - Joi validation options
 */
export function createValidator(
  schema: Joi.Schema,
  target: ValidationTarget = "body",
  options: Joi.ValidationOptions = {}
) {
  const joiOptions: Joi.ValidationOptions = {
    abortEarly: false, // Return all errors, not just the first
    stripUnknown: true, // Remove unknown fields
    ...options,
  };

  return function validatorMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction
  ): void {
    const data = req[target];
    const { error, value } = schema.validate(data, joiOptions);

    if (error) {
      const messages = error.details.map((d) => d.message).join("; ");
      next(new BadRequestError(messages));
      return;
    }

    // Replace with validated/sanitized data
    req[target] = value;
    next();
  };
}

/**
 * Convenience function to create a body validator.
 */
export function validateBody(schema: Joi.Schema, options?: Joi.ValidationOptions) {
  return createValidator(schema, "body", options);
}

/**
 * Convenience function to create a query validator.
 */
export function validateQuery(schema: Joi.Schema, options?: Joi.ValidationOptions) {
  return createValidator(schema, "query", options);
}

/**
 * Convenience function to create a params validator.
 */
export function validateParams(schema: Joi.Schema, options?: Joi.ValidationOptions) {
  return createValidator(schema, "params", options);
}

// ---------------------------------------------------------------------------
// Common Joi Schemas
// ---------------------------------------------------------------------------

/**
 * Schema for ObjectId parameters.
 */
export const schemaObjectId = Joi.string()
  .pattern(/^[a-fA-F0-9]{24}$/)
  .message("Invalid ID format");

/**
 * Schema for pagination query parameters.
 */
export const schemaPagination = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

/**
 * Schema for sort query parameters.
 */
export const schemaSort = Joi.object({
  sortBy: Joi.string().trim().max(50),
  sortOrder: Joi.string().valid("asc", "desc", "1", "-1"),
});

/**
 * Schema for search query parameter.
 */
export const schemaSearch = Joi.object({
  search: Joi.string().trim().max(200).allow(""),
});

/**
 * Combined schema for common list query parameters.
 */
export const schemaListQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  search: Joi.string().trim().max(200).allow(""),
  sortBy: Joi.string().trim().max(50),
  sortOrder: Joi.string().valid("asc", "desc", "1", "-1"),
});

// ---------------------------------------------------------------------------
// Request Validation Helpers
// ---------------------------------------------------------------------------

/**
 * Validate a required field exists and is non-empty.
 */
export function requireField<T>(
  value: T | undefined | null,
  fieldName: string
): T {
  if (value === undefined || value === null) {
    throw new BadRequestError(`${fieldName} is required`);
  }
  if (typeof value === "string" && value.trim() === "") {
    throw new BadRequestError(`${fieldName} cannot be empty`);
  }
  return value;
}

/**
 * Validate a string field with min/max length.
 */
export function validateString(
  value: unknown,
  fieldName: string,
  options: { min?: number; max?: number; required?: boolean } = {}
): string | undefined {
  const { min = 0, max = 10000, required = false } = options;

  if (value === undefined || value === null) {
    if (required) {
      throw new BadRequestError(`${fieldName} is required`);
    }
    return undefined;
  }

  if (typeof value !== "string") {
    throw new BadRequestError(`${fieldName} must be a string`);
  }

  const trimmed = value.trim();

  if (required && trimmed === "") {
    throw new BadRequestError(`${fieldName} cannot be empty`);
  }

  if (trimmed.length < min) {
    throw new BadRequestError(
      `${fieldName} must be at least ${min} characters`
    );
  }

  if (trimmed.length > max) {
    throw new BadRequestError(
      `${fieldName} must be at most ${max} characters`
    );
  }

  return trimmed;
}

/**
 * Validate an enum field.
 */
export function validateEnum<T extends string>(
  value: unknown,
  fieldName: string,
  allowedValues: readonly T[],
  options: { required?: boolean } = {}
): T | undefined {
  const { required = false } = options;

  if (value === undefined || value === null) {
    if (required) {
      throw new BadRequestError(`${fieldName} is required`);
    }
    return undefined;
  }

  if (typeof value !== "string") {
    throw new BadRequestError(`${fieldName} must be a string`);
  }

  if (!allowedValues.includes(value as T)) {
    throw new BadRequestError(
      `${fieldName} must be one of: ${allowedValues.join(", ")}`
    );
  }

  return value as T;
}

/**
 * Validate an email field.
 */
export function validateEmail(
  value: unknown,
  fieldName = "email",
  options: { required?: boolean } = {}
): string | undefined {
  const { required = false } = options;

  if (value === undefined || value === null) {
    if (required) {
      throw new BadRequestError(`${fieldName} is required`);
    }
    return undefined;
  }

  if (typeof value !== "string") {
    throw new BadRequestError(`${fieldName} must be a string`);
  }

  const trimmed = value.trim().toLowerCase();

  if (required && trimmed === "") {
    throw new BadRequestError(`${fieldName} cannot be empty`);
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (trimmed && !emailRegex.test(trimmed)) {
    throw new BadRequestError(`${fieldName} must be a valid email address`);
  }

  return trimmed || undefined;
}
