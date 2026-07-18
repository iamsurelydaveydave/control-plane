import { Request, Response, NextFunction } from "express";
import { logger } from "./logger";
import { useSessionStore, sessionUserId, TSessionPrincipal } from "./session";
import { verifyJwt } from "./jwt";
import { sidCookieOptions, identityCookieOptions } from "./cookie";
import { ACCESS_TOKEN_SECRET, SESSION_TTL_SECONDS } from "../config";
import { useAPITokenService } from "../resources/api-token";
import type { TAPITokenScope } from "../resources/api-token/api-token.model";

// Extend Express Request to include API token info
declare module "express-serve-static-core" {
  interface Request {
    apiToken?: {
      id: string;
      userId: string;
      scopes: TAPITokenScope[];
    };
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
 */
export function requireScope(scope: TAPITokenScope) {
  return (req: Request, res: Response, next: NextFunction) => {
    // If not using API token, allow (session users have full access)
    if (!req.apiToken) {
      next();
      return;
    }

    // Check scope
    const apiTokenService = useAPITokenService();
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
