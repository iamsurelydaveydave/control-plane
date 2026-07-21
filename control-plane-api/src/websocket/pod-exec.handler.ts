import { IncomingMessage } from "http";
import { WebSocket } from "ws";
import { parse as parseUrl } from "url";
import { parse as parseCookie } from "cookie";
import { logger } from "../utils";
import { useSessionStore, sessionUserId, TSessionPrincipal } from "../utils/session";
import { verifyJwt } from "../utils/jwt";
import { ACCESS_TOKEN_SECRET } from "../config";
import { useAPITokenService } from "../resources/api-token";
import { usePodExecService, TExecOutputMessage } from "../services/pod-exec.service";

export type TAuthenticatedRequest = {
  userId: string;
  namespace: string;
  podName: string;
  container: string;
};

/**
 * Parse and authenticate a WebSocket upgrade request.
 * Supports:
 * 1. Session cookie (`sid`)
 * 2. Bearer token (JWT or API token `cp_` prefix) via query param or Sec-WebSocket-Protocol header
 */
export async function authenticateWebSocketRequest(
  request: IncomingMessage
): Promise<TAuthenticatedRequest | null> {
  const urlParsed = parseUrl(request.url || "", true);
  const pathname = urlParsed.pathname || "";
  const query = urlParsed.query;

  // Parse route: /api/pods/:namespace/:pod/exec
  const match = pathname.match(/^\/api\/pods\/([^/]+)\/([^/]+)\/exec$/);
  if (!match) {
    logger.log({
      level: "warn",
      message: `[ws-auth] Invalid exec path: ${pathname}`,
    });
    return null;
  }

  const namespace = decodeURIComponent(match[1]);
  const podName = decodeURIComponent(match[2]);
  const container = (query.container as string) || "";

  if (!container) {
    logger.log({
      level: "warn",
      message: `[ws-auth] Missing container query param`,
    });
    return null;
  }

  // Try authentication methods in order

  // 1. Session cookie
  const cookieHeader = request.headers.cookie || "";
  const cookies = parseCookie(cookieHeader);
  const sid = cookies.sid;

  if (sid) {
    const store = useSessionStore();
    const principal = (await store.get(sid)) as TSessionPrincipal | null;
    const userId = sessionUserId(principal);

    if (principal && userId) {
      logger.log({
        level: "info",
        message: `[ws-auth] Authenticated via session: ${userId}`,
      });
      return { userId, namespace, podName, container };
    }
  }

  // 2. Bearer token from query param (for WebSocket clients that can't set headers)
  const tokenFromQuery = query.token as string;
  // 3. Bearer token from Sec-WebSocket-Protocol header (fallback for browser clients)
  const protocolHeader = request.headers["sec-websocket-protocol"];
  const tokenFromProtocol = protocolHeader?.startsWith("Bearer.") ? protocolHeader.slice(7) : null;

  const token = tokenFromQuery || tokenFromProtocol;

  if (token) {
    // 2a. API Token (`cp_` prefix)
    if (token.startsWith("cp_")) {
      try {
        const apiTokenService = useAPITokenService();
        const apiToken = await apiTokenService.validateToken(token);

        if (apiToken) {
          const userId = String(apiToken.userId);
          logger.log({
            level: "info",
            message: `[ws-auth] Authenticated via API token: ${userId}`,
          });
          return { userId, namespace, podName, container };
        }
      } catch (error) {
        logger.log({
          level: "info",
          message: `[ws-auth] API token rejected: ${error}`,
        });
      }
    } else {
      // 2b. JWT Bearer token
      try {
        const payload = verifyJwt<{ sub?: string; type?: string }>(token, ACCESS_TOKEN_SECRET);
        if (payload.type === "access" && payload.sub) {
          const userId = String(payload.sub);
          logger.log({
            level: "info",
            message: `[ws-auth] Authenticated via JWT: ${userId}`,
          });
          return { userId, namespace, podName, container };
        }
      } catch (error) {
        logger.log({
          level: "info",
          message: `[ws-auth] JWT rejected: ${error}`,
        });
      }
    }
  }

  logger.log({
    level: "warn",
    message: `[ws-auth] Authentication failed for ${pathname}`,
  });
  return null;
}

/**
 * Handle a WebSocket connection for pod exec.
 * Creates an interactive shell session and bridges client <-> K8s.
 */
export function handlePodExecConnection(ws: WebSocket, auth: TAuthenticatedRequest) {
  const { namespace, podName, container, userId } = auth;

  logger.log({
    level: "info",
    message: `[ws-exec] User ${userId} connecting to ${namespace}/${podName}/${container}`,
  });

  const podExecService = usePodExecService();

  try {
    // Create shell session
    const session = podExecService.createShellSession(namespace, podName, container);

    // Attach client WebSocket to the session
    session.attach(ws);

    logger.log({
      level: "info",
      message: `[ws-exec] Shell session attached for ${namespace}/${podName}/${container}`,
    });
  } catch (error: any) {
    logger.log({
      level: "error",
      message: `[ws-exec] Failed to create shell session: ${error.message}`,
    });

    const errorMessage: TExecOutputMessage = {
      type: "error",
      message: error.message || "Failed to create shell session",
    };
    ws.send(JSON.stringify(errorMessage));
    ws.close(4001, "Failed to create shell session");
  }
}

/**
 * Check if a request URL matches the pod exec WebSocket endpoint
 */
export function isPodExecPath(url: string | undefined): boolean {
  if (!url) return false;
  return /^\/api\/pods\/[^/]+\/[^/]+\/exec(\?|$)/.test(url);
}
