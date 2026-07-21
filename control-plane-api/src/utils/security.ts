import { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import { ALLOWED_ORIGINS, isDev } from "../config";
import { BadRequestError } from "./error";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Helmet Configuration - Security Headers
// ---------------------------------------------------------------------------

/**
 * Configured helmet middleware with sensible defaults for an API server.
 */
export const securityHeaders = helmet({
  // Content Security Policy - restrictive for API
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  // Prevent MIME type sniffing
  noSniff: true,
  // Prevent clickjacking
  frameguard: { action: "deny" },
  // XSS filter (legacy, but doesn't hurt)
  xssFilter: true,
  // Hide X-Powered-By header
  hidePoweredBy: true,
  // HSTS - force HTTPS
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  // Prevent DNS prefetching
  dnsPrefetchControl: { allow: false },
  // Prevent IE from opening downloads in site context
  ieNoOpen: true,
  // Referrer policy
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
});

// ---------------------------------------------------------------------------
// CORS Configuration
// ---------------------------------------------------------------------------

/**
 * CORS configuration with proper origin validation.
 */
export const corsConfig = cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) {
      callback(null, true);
      return;
    }

    // Check if origin is in the allowed list
    if (ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
      return;
    }

    // In development, allow localhost variations
    if (isDev && (origin.includes("localhost") || origin.includes("127.0.0.1"))) {
      callback(null, true);
      return;
    }

    logger.log({
      level: "warn",
      message: `CORS blocked origin: ${origin}`,
    });
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
    "X-Request-ID",
  ],
  exposedHeaders: [
    "X-RateLimit-Limit",
    "X-RateLimit-Remaining",
    "X-RateLimit-Reset",
    "X-Request-ID",
  ],
  maxAge: 86400, // 24 hours
});

// ---------------------------------------------------------------------------
// Input Sanitization
// ---------------------------------------------------------------------------

// Characters that could be used for injection attacks
const DANGEROUS_PATTERNS = [
  /\$where/gi,    // MongoDB $where operator
  /\$regex/gi,    // MongoDB $regex operator (when not intended)
  /\$ne/gi,       // MongoDB $ne operator
  /\$gt/gi,       // MongoDB $gt operator
  /\$gte/gi,      // MongoDB $gte operator
  /\$lt/gi,       // MongoDB $lt operator
  /\$lte/gi,      // MongoDB $lte operator
  /\$in/gi,       // MongoDB $in operator
  /\$nin/gi,      // MongoDB $nin operator
  /\$or/gi,       // MongoDB $or operator
  /\$and/gi,      // MongoDB $and operator
  /\$not/gi,      // MongoDB $not operator
  /\$exists/gi,   // MongoDB $exists operator
  /\$type/gi,     // MongoDB $type operator
  /\$expr/gi,     // MongoDB $expr operator
  /\$function/gi, // MongoDB $function operator
  /\$accumulator/gi, // MongoDB $accumulator operator
];

/**
 * Recursively sanitize a value, removing potentially dangerous content.
 */
function sanitizeValue(value: unknown, depth = 0): unknown {
  // Prevent deep recursion attacks
  if (depth > 10) {
    return null;
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    // Trim and limit string length
    let sanitized = value.trim();
    if (sanitized.length > 10000) {
      sanitized = sanitized.slice(0, 10000);
    }

    // Check for dangerous patterns in string values
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(sanitized)) {
        logger.log({
          level: "warn",
          message: `Sanitized dangerous pattern in string value: ${pattern}`,
        });
        sanitized = sanitized.replace(pattern, "");
      }
    }

    // Remove null bytes
    sanitized = sanitized.replace(/\0/g, "");

    return sanitized;
  }

  if (typeof value === "number") {
    // Check for Infinity and NaN
    if (!Number.isFinite(value)) {
      return 0;
    }
    return value;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    // Limit array size
    const arr = value as unknown[];
    const limited = arr.length > 1000 ? arr.slice(0, 1000) : arr;
    return limited.map((item: unknown) => sanitizeValue(item, depth + 1));
  }

  if (typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>);

    // Limit number of keys
    if (keys.length > 100) {
      keys.length = 100;
    }

    for (const key of keys) {
      // Skip keys starting with $ (MongoDB operators)
      if (key.startsWith("$")) {
        logger.log({
          level: "warn",
          message: `Sanitized MongoDB operator key: ${key}`,
        });
        continue;
      }

      // Skip keys with null bytes
      if (key.includes("\0")) {
        continue;
      }

      // Skip prototype pollution attempts
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        logger.log({
          level: "warn",
          message: `Sanitized prototype pollution attempt: ${key}`,
        });
        continue;
      }

      sanitized[key] = sanitizeValue(
        (value as Record<string, unknown>)[key],
        depth + 1
      );
    }

    return sanitized;
  }

  // Unknown type - return null for safety
  return null;
}

/**
 * Middleware to deeply sanitize request body and query parameters.
 */
export function sanitizeInput(req: Request, _res: Response, next: NextFunction): void {
  try {
    if (req.body && typeof req.body === "object") {
      req.body = sanitizeValue(req.body) as typeof req.body;
    }

    if (req.query && typeof req.query === "object") {
      req.query = sanitizeValue(req.query) as typeof req.query;
    }

    if (req.params && typeof req.params === "object") {
      req.params = sanitizeValue(req.params) as typeof req.params;
    }

    next();
  } catch (error) {
    logger.log({
      level: "error",
      message: `Input sanitization error: ${(error as Error).message}`,
    });
    next(new BadRequestError("Invalid request data"));
  }
}

// ---------------------------------------------------------------------------
// Content-Type Validation
// ---------------------------------------------------------------------------

const ALLOWED_CONTENT_TYPES = [
  "application/json",
  "application/x-www-form-urlencoded",
  "multipart/form-data",
];

/**
 * Middleware to validate Content-Type header for requests with body.
 */
export function validateContentType(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  // Skip for requests that don't typically have a body
  if (["GET", "HEAD", "DELETE", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }

  // Skip if no body
  const contentLength = req.headers["content-length"];
  if (!contentLength || contentLength === "0") {
    next();
    return;
  }

  const contentType = req.headers["content-type"];
  if (!contentType) {
    next(new BadRequestError("Content-Type header is required"));
    return;
  }

  // Extract the MIME type (ignore charset and boundary)
  const mimeType = contentType.split(";")[0].trim().toLowerCase();

  if (!ALLOWED_CONTENT_TYPES.includes(mimeType)) {
    next(new BadRequestError(`Unsupported Content-Type: ${mimeType}`));
    return;
  }

  next();
}

// ---------------------------------------------------------------------------
// Enhanced NoSQL Injection Prevention
// ---------------------------------------------------------------------------

/**
 * Additional NoSQL injection patterns to detect beyond the basic sanitization.
 */
const NOSQL_INJECTION_PATTERNS = [
  // Attempt to pass objects where strings are expected
  { body: true, pattern: /^\{.*\}$/, fields: ["username", "email", "password"] },
  // Attempt to use RegExp constructor
  { body: true, pattern: /new\s+RegExp/i },
  // JavaScript code injection attempts
  { body: true, pattern: /function\s*\(/i },
  { body: true, pattern: /=>\s*\{/i },
];

/**
 * Enhanced middleware to prevent NoSQL injection attacks.
 * Works in conjunction with sanitizeMongo and sanitizeInput.
 */
export function preventNoSQL(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  // Check if body contains objects in string fields (common injection attempt)
  if (req.body && typeof req.body === "object") {
    for (const [key, value] of Object.entries(req.body)) {
      // If a field that should be a string contains an object, reject
      if (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        ["username", "email", "password", "name", "search", "query"].includes(key)
      ) {
        logger.log({
          level: "warn",
          message: `NoSQL injection attempt detected: object in string field "${key}"`,
        });
        next(new BadRequestError("Invalid request data"));
        return;
      }

      // Check string values for dangerous patterns
      if (typeof value === "string") {
        for (const check of NOSQL_INJECTION_PATTERNS) {
          if (check.body && check.pattern.test(value)) {
            if (!check.fields || check.fields.includes(key)) {
              logger.log({
                level: "warn",
                message: `NoSQL injection pattern detected in field "${key}"`,
              });
              next(new BadRequestError("Invalid request data"));
              return;
            }
          }
        }
      }
    }
  }

  next();
}

// ---------------------------------------------------------------------------
// Request ID Middleware
// ---------------------------------------------------------------------------

/**
 * Add a unique request ID for tracing.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = req.headers["x-request-id"] as string || generateRequestId();
  (req as Request & { requestId: string }).requestId = id;
  res.setHeader("X-Request-ID", id);
  next();
}

function generateRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

// ---------------------------------------------------------------------------
// Combined Security Middleware
// ---------------------------------------------------------------------------

/**
 * Apply all security middleware in the correct order.
 * Use this in app.ts instead of individual middleware calls.
 */
export const securityMiddleware = [
  requestId,
  securityHeaders,
  corsConfig,
  validateContentType,
  sanitizeInput,
  preventNoSQL,
];
