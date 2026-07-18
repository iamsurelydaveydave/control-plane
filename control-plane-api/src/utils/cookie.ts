import { CookieOptions } from "express";
import { COOKIE_SAMESITE, DOMAIN, isDev, SESSION_TTL_SECONDS } from "../config";

// Single source of truth for the auth cookies. Two cookies are issued at login:
//
//   `sid`  — the session SECRET. httpOnly so JavaScript can never read it; an XSS
//            in any app therefore can't exfiltrate a live session. This is the
//            only value `requireAuth` validates against the session store.
//   `user` — a NON-secret convenience hint (the caller's id) that the SPA reads
//            for UX. It is deliberately NOT httpOnly because the frontend reads
//            it client-side. The server NEVER trusts it: `requireAuth` always
//            re-derives identity from the session and overwrites this value, so
//            its JS-readability is not a credential exposure.
//
// `secure: true` is required because `sameSite: "none"` (the cross-origin default
// for multi-app setups) only ships over HTTPS.
//
// That hardening is correct for HTTPS production deployments, but it BREAKS local
// dev: the apps are served over http://localhost, where the browser drops a
// `Secure` / `SameSite=None` cookie and rejects an explicit `Domain=localhost`.
// The session cookie then never sticks, so `requireAuth` (and the SPA's auth
// guard) see no `sid` and bounce every guarded route back to the login page.
//
// In dev we therefore issue a plain, host-only cookie (no `Domain`, not `Secure`,
// `SameSite=Lax`) — the apps are same-site across localhost ports, so `Lax` still
// rides along on the cross-port API calls.
const base: CookieOptions = isDev
  ? { secure: false, sameSite: "lax" }
  : { domain: DOMAIN, secure: true, sameSite: COOKIE_SAMESITE };

/** Options for the httpOnly `sid` session-secret cookie. */
export function sidCookieOptions(): CookieOptions {
  return { ...base, httpOnly: true, maxAge: SESSION_TTL_SECONDS * 1000 };
}

/** Options for the readable, non-secret `user` identity hint. */
export function identityCookieOptions(): CookieOptions {
  return { ...base, httpOnly: false, maxAge: SESSION_TTL_SECONDS * 1000 };
}

// Clearing a cookie requires the same domain/path/secure/sameSite/httpOnly
// attributes it was set with, otherwise the browser keeps the original.
export function clearSidCookieOptions(): CookieOptions {
  return { ...base, httpOnly: true };
}

export function clearIdentityCookieOptions(): CookieOptions {
  return { ...base, httpOnly: false };
}
