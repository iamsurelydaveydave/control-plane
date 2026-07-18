export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number, isOperational: boolean = true) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string = "Bad Request") {
    super(message, 400);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = "Unauthorized") {
    super(message, 401);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = "Not Found") {
    super(message, 404);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = "Forbidden") {
    super(message, 403);
  }
}

export class ConflictError extends AppError {
  public readonly keyPattern?: Record<string, unknown>;

  constructor(message: string = "Conflict", keyPattern?: Record<string, unknown>) {
    super(message, 409);
    this.keyPattern = keyPattern;
  }
}

export class InternalServerError extends AppError {
  constructor(message: string = "Internal Server Error") {
    super(message, 500);
  }
}

/**
 * True when an error is a transient MongoDB transaction error that
 * `ClientSession.withTransaction` knows how to retry.
 */
export function isTransientTransactionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { hasErrorLabel?: (label: string) => boolean; errorLabels?: string[]; code?: number };
  if (typeof e.hasErrorLabel === "function" && e.hasErrorLabel("TransientTransactionError")) return true;
  if (Array.isArray(e.errorLabels) && e.errorLabels.includes("TransientTransactionError")) return true;
  return e.code === 112; // WriteConflict
}
