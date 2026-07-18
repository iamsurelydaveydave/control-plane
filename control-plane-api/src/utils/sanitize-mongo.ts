import { Request, Response, NextFunction } from "express";

/**
 * Recursively strip MongoDB operator keys ($...) from an object to prevent
 * NoSQL injection attacks.
 */
function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  
  for (const key of Object.keys(obj)) {
    if (key.startsWith("$")) {
      continue; // Skip MongoDB operators
    }
    
    const value = obj[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      sanitized[key] = sanitizeObject(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map((item) =>
        item && typeof item === "object" ? sanitizeObject(item as Record<string, unknown>) : item
      );
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

/**
 * Middleware to sanitize MongoDB operators from request body and query.
 */
export function sanitizeMongo(req: Request, _res: Response, next: NextFunction) {
  if (req.body && typeof req.body === "object") {
    req.body = sanitizeObject(req.body);
  }
  
  if (req.query && typeof req.query === "object") {
    req.query = sanitizeObject(req.query as Record<string, unknown>) as typeof req.query;
  }
  
  next();
}
