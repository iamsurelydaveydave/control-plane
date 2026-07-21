import { Request, Response, NextFunction } from "express";
import { useRedis } from "./ioredis";
import { logger } from "./logger";
import {
  RATE_LIMIT_ENABLED,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX,
} from "../config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RateLimitConfig = {
  /** Time window in milliseconds */
  windowMs: number;
  /** Max requests per window */
  max: number;
  /** Redis key prefix (default: "rl") */
  keyPrefix?: string;
  /** Skip counting failed requests (4xx/5xx) */
  skipFailedRequests?: boolean;
  /** Custom handler when limit is exceeded */
  handler?: (req: Request, res: Response, next: NextFunction) => void;
  /** Custom key generator (default: IP-based) */
  keyGenerator?: (req: Request) => string;
  /** Skip rate limiting for certain requests */
  skip?: (req: Request) => boolean;
};

export type RateLimitInfo = {
  limit: number;
  current: number;
  remaining: number;
  resetTime: number;
};

// ---------------------------------------------------------------------------
// Preset Configurations
// ---------------------------------------------------------------------------

export const rateLimits = {
  /** 5 login attempts per 15 minutes — strict for auth endpoints */
  auth: { windowMs: 15 * 60 * 1000, max: 5, keyPrefix: "rl:auth" },
  /** 100 requests per minute — general API rate limit */
  api: { windowMs: 60 * 1000, max: RATE_LIMIT_MAX, keyPrefix: "rl:api" },
  /** 10 heavy operations per minute — deploy, provision, etc. */
  heavy: { windowMs: 60 * 1000, max: 10, keyPrefix: "rl:heavy" },
  /** 20 requests per minute — moderate operations */
  moderate: { windowMs: 60 * 1000, max: 20, keyPrefix: "rl:mod" },
} as const;

// ---------------------------------------------------------------------------
// Rate Limiter Implementation
// ---------------------------------------------------------------------------

/**
 * Get client identifier for rate limiting.
 * Uses X-Forwarded-For if behind a proxy, otherwise req.ip.
 */
function getClientKey(req: Request): string {
  // Trust proxy is set in app.ts, so req.ip should be correct
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(",")[0].trim();
    return ip;
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

/**
 * Default handler when rate limit is exceeded.
 */
function defaultHandler(req: Request, res: Response, _next: NextFunction): void {
  res.status(429).json({
    error: "Too Many Requests",
    message: "Rate limit exceeded. Please try again later.",
    retryAfter: res.getHeader("Retry-After"),
  });
}

/**
 * Create a rate limiting middleware using Redis for distributed limiting.
 * Uses a sliding window counter approach with INCR and EXPIRE.
 */
export function createRateLimiter(config: RateLimitConfig) {
  const {
    windowMs,
    max,
    keyPrefix = "rl",
    skipFailedRequests = false,
    handler = defaultHandler,
    keyGenerator = getClientKey,
    skip,
  } = config;

  const windowSec = Math.ceil(windowMs / 1000);

  return async function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    // Skip if rate limiting is disabled globally
    if (!RATE_LIMIT_ENABLED) {
      next();
      return;
    }

    // Skip if custom skip function returns true
    if (skip && skip(req)) {
      next();
      return;
    }

    const redis = useRedis().getClient();
    const clientKey = keyGenerator(req);
    const redisKey = `${keyPrefix}:${clientKey}`;

    try {
      // Use a Lua script for atomic increment and TTL setting
      // This ensures the counter and expiry are set atomically
      const luaScript = `
        local current = redis.call('INCR', KEYS[1])
        if current == 1 then
          redis.call('EXPIRE', KEYS[1], ARGV[1])
        end
        local ttl = redis.call('TTL', KEYS[1])
        return {current, ttl}
      `;

      const result = await redis.eval(luaScript, 1, redisKey, windowSec) as [number, number];
      const [current, ttl] = result;
      const remaining = Math.max(0, max - current);
      const resetTime = Date.now() + (ttl > 0 ? ttl * 1000 : windowMs);

      // Set rate limit headers
      res.setHeader("X-RateLimit-Limit", max);
      res.setHeader("X-RateLimit-Remaining", remaining);
      res.setHeader("X-RateLimit-Reset", Math.ceil(resetTime / 1000));

      // Store info for potential use
      (req as Request & { rateLimit: RateLimitInfo }).rateLimit = {
        limit: max,
        current,
        remaining,
        resetTime,
      };

      // Check if limit exceeded
      if (current > max) {
        res.setHeader("Retry-After", Math.ceil(ttl > 0 ? ttl : windowSec));
        logger.log({
          level: "warn",
          message: `Rate limit exceeded for ${clientKey} on ${req.method} ${req.path}`,
        });
        handler(req, res, next);
        return;
      }

      // If skipFailedRequests is true, decrement on error responses
      if (skipFailedRequests) {
        const originalEnd = res.end.bind(res);
        const wrappedEnd: typeof res.end = function (
          this: typeof res,
          chunkOrCb?: unknown,
          encodingOrCb?: BufferEncoding | (() => void),
          cb?: () => void
        ) {
          if (res.statusCode >= 400) {
            redis.decr(redisKey).catch(() => {
              // Ignore decrement errors
            });
          }
          // Call the original end with the right overload
          if (typeof chunkOrCb === "function") {
            return originalEnd(chunkOrCb);
          } else if (typeof encodingOrCb === "function") {
            return originalEnd(chunkOrCb as string | Buffer, encodingOrCb);
          } else if (cb) {
            return originalEnd(chunkOrCb as string | Buffer, encodingOrCb as BufferEncoding, cb);
          } else if (encodingOrCb) {
            return originalEnd(chunkOrCb as string | Buffer, encodingOrCb as BufferEncoding);
          } else if (chunkOrCb !== undefined) {
            return originalEnd(chunkOrCb as string | Buffer);
          }
          return originalEnd();
        } as typeof res.end;
        res.end = wrappedEnd;
      }

      next();
    } catch (error) {
      // If Redis fails, log and allow the request (fail-open)
      logger.log({
        level: "error",
        message: `Rate limiter Redis error: ${(error as Error).message}`,
      });
      next();
    }
  };
}

// ---------------------------------------------------------------------------
// Preset Middleware Instances
// ---------------------------------------------------------------------------

/**
 * Rate limiter for auth endpoints (login, password reset, etc.).
 * Strict: 5 attempts per 15 minutes.
 */
export const rateLimitAuth = createRateLimiter({
  ...rateLimits.auth,
  // Include the endpoint in the key to separate login from other auth endpoints
  keyGenerator: (req) => `${getClientKey(req)}:${req.path}`,
});

/**
 * General API rate limiter.
 * Moderate: 100 requests per minute (configurable via env).
 */
export const rateLimitApi = createRateLimiter({
  ...rateLimits.api,
  windowMs: RATE_LIMIT_WINDOW_MS,
  skipFailedRequests: true, // Don't count 4xx/5xx against the limit
});

/**
 * Rate limiter for heavy operations (deploy, provision, scale, etc.).
 * Strict: 10 operations per minute.
 */
export const rateLimitHeavy = createRateLimiter({
  ...rateLimits.heavy,
  // Include the specific operation in the key
  keyGenerator: (req) => `${getClientKey(req)}:${req.method}:${req.baseUrl}${req.path}`,
});

/**
 * Rate limiter for moderate operations (CRUD operations).
 * 20 operations per minute.
 */
export const rateLimitModerate = createRateLimiter({
  ...rateLimits.moderate,
  skipFailedRequests: true,
});

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Get current rate limit status for a client.
 */
export async function getRateLimitStatus(
  keyPrefix: string,
  clientKey: string
): Promise<RateLimitInfo | null> {
  try {
    const redis = useRedis().getClient();
    const redisKey = `${keyPrefix}:${clientKey}`;
    
    const [current, ttl] = await Promise.all([
      redis.get(redisKey),
      redis.ttl(redisKey),
    ]);

    if (current === null) {
      return null;
    }

    const config = Object.values(rateLimits).find((c) => c.keyPrefix === keyPrefix);
    const max = config?.max || RATE_LIMIT_MAX;

    return {
      limit: max,
      current: parseInt(current, 10),
      remaining: Math.max(0, max - parseInt(current, 10)),
      resetTime: Date.now() + (ttl > 0 ? ttl * 1000 : 0),
    };
  } catch {
    return null;
  }
}

/**
 * Clear rate limit for a specific client (e.g., after successful password reset).
 */
export async function clearRateLimit(
  keyPrefix: string,
  clientKey: string
): Promise<boolean> {
  try {
    const redis = useRedis().getClient();
    const redisKey = `${keyPrefix}:${clientKey}`;
    await redis.del(redisKey);
    return true;
  } catch {
    return false;
  }
}
