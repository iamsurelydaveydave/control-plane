import { Request, Response, NextFunction } from "express";
import { logger } from "./logger";
import { useSessionStore, sessionUserId, TSessionPrincipal } from "./session";
import { verifyJwt } from "./jwt";
import { sidCookieOptions, identityCookieOptions } from "./cookie";
import { ACCESS_TOKEN_SECRET, SESSION_TTL_SECONDS } from "../config";
import { useAPITokenService } from "../resources/api-token";
import { useRoleService, TPermission, hasPermission } from "../resources/role";
import { useUserRepo } from "../resources/user";
import type { TAPITokenScope } from "../resources/api-token/api-token.model";
import { ForbiddenError, UnauthorizedError } from "./error";

// Extend Express Request to include API token info and user permissions
declare module "express-serve-static-core" {
  interface Request {
    apiToken?: {
      id: string;
      userId: string;
      scopes: TAPITokenScope[];
    };
    userPermissions?: TPermission[];
  }
}

function bearerToken(req: Request): string {
  const header = (req.headers?.authorization as string) ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
}

/**
 * Authentication middleware. Accepts:
 * 1. Session cookie (`sid`)
 * 2. Bearer token — either JWT or API token (`cp_` prefix)
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const sid = (req.cookies?.sid as string) ?? "";

  // 1) Cookie session
  if (sid) {
    const store = useSessionStore();
    const principal = (await store.get(sid)) as TSessionPrincipal | null;
    const userId = sessionUserId(principal);

    if (principal && userId) {
      req.cookies = req.cookies ?? {};
      req.cookies.user = userId;

      // Rolling refresh
      store.touch(sid, SESSION_TTL_SECONDS, userId).catch((error) => {
        logger.log({ level: "error", message: `Error refreshing session ${sid}: ${error}` });
      });

      res.cookie("sid", sid, sidCookieOptions());
      res.cookie("user", userId, identityCookieOptions());

      next();
      return;
    }
  }

  // 2) Bearer token (JWT or API token)
  const token = bearerToken(req);
  if (token) {
    // 2a) API Token (`cp_` prefix)
    if (token.startsWith("cp_")) {
      try {
        const apiTokenService = useAPITokenService();
        const apiToken = await apiTokenService.validateToken(token);

        if (apiToken) {
          const userId = String(apiToken.userId);
          req.cookies = req.cookies ?? {};
          req.cookies.user = userId;
          req.apiToken = {
            id: String(apiToken._id),
            userId,
            scopes: apiToken.scopes as TAPITokenScope[],
          };
          next();
          return;
        }
      } catch (error) {
        logger.log({ level: "info", message: `[auth] API token rejected: ${error}` });
      }
    } else {
      // 2b) JWT Bearer token
      try {
        const payload = verifyJwt<{ sub?: string; type?: string }>(token, ACCESS_TOKEN_SECRET);
        if (payload.type === "access" && payload.sub) {
          const userId = String(payload.sub);
          req.cookies = req.cookies ?? {};
          req.cookies.user = userId;
          next();
          return;
        }
      } catch (error) {
        logger.log({ level: "info", message: `[auth] bearer token rejected: ${error}` });
      }
    }
  }

  res.status(401).json({ error: sid || token ? "Session expired or invalid" : "Unauthorized" });
}

/**
 * Middleware to require a specific API token scope.
 * Must be used after requireAuth.
 * @deprecated Use requirePermission instead for RBAC-based access control.
 */
export function requireScope(scope: TAPITokenScope) {
  return (req: Request, res: Response, next: NextFunction) => {
    // If not using API token, allow (session users have full access via RBAC)
    if (!req.apiToken) {
      next();
      return;
    }

    // Check scope
    if (
      req.apiToken.scopes.includes("*") ||
      req.apiToken.scopes.includes(scope)
    ) {
      next();
      return;
    }

    res.status(403).json({ error: `Insufficient scope. Required: ${scope}` });
  };
}

/**
 * Map API token scopes to RBAC permissions.
 * This allows API tokens to work with the new permission system.
 */
function mapScopeToPermission(scope: TAPITokenScope, permission: TPermission): boolean {
  // Full access scope
  if (scope === "*") {
    return true;
  }

  // Direct mapping for read/write scopes
  const [scopeResource, scopeAction] = scope.split(":");
  const [permResource, permAction] = permission.split(":");

  // Check if resources match
  if (scopeResource !== permResource) {
    return false;
  }

  // Read scope allows read actions
  if (scopeAction === "read" && permAction === "read") {
    return true;
  }

  // Write scope allows all actions on that resource
  if (scopeAction === "write") {
    return true;
  }

  return false;
}

/**
 * Check if an API token has the required permission via its scopes.
 */
function apiTokenHasPermission(scopes: TAPITokenScope[], permission: TPermission): boolean {
  return scopes.some((scope) => mapScopeToPermission(scope, permission));
}

/**
 * Middleware to require a specific permission.
 * Works with both session-based auth (uses RBAC) and API tokens (uses scopes).
 * Must be used after requireAuth.
 */
export function requirePermission(permission: TPermission) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.cookies?.user as string;
    
    if (!userId) {
      next(new UnauthorizedError("Not authenticated"));
      return;
    }

    try {
      // If using API token, check scopes
      if (req.apiToken) {
        if (apiTokenHasPermission(req.apiToken.scopes, permission)) {
          next();
          return;
        }
        next(new ForbiddenError(`Insufficient scope for permission: ${permission}`));
        return;
      }

      // For session-based auth, check RBAC permissions
      const roleService = useRoleService();
      const hasRequiredPermission = await roleService.checkUserPermission(userId, permission);

      if (hasRequiredPermission) {
        next();
        return;
      }

      next(new ForbiddenError(`Missing permission: ${permission}`));
    } catch (error) {
      logger.log({
        level: "error",
        message: `Permission check failed for user ${userId}: ${error}`,
      });
      next(new ForbiddenError(`Permission check failed: ${permission}`));
    }
  };
}

/**
 * Middleware to require admin permission (admin:*).
 * Shorthand for requirePermission("admin:*").
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  return requirePermission("admin:*")(req, res, next);
}

/**
 * Get all permissions for the current user.
 * Can be used in controllers to check multiple permissions.
 */
export async function getUserPermissions(userId: string): Promise<TPermission[]> {
  const roleService = useRoleService();
  return roleService.getUserPermissions(userId);
}

/**
 * Check if a user has a specific permission.
 * Can be used in controllers for fine-grained access control.
 */
export async function checkPermission(userId: string, permission: TPermission): Promise<boolean> {
  const roleService = useRoleService();
  return roleService.checkUserPermission(userId, permission);
}
