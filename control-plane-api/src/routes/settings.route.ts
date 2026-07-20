import express, { Request, Response, NextFunction } from "express";
import { requireAuth } from "../utils";
import { useSettingsRepo } from "../resources/settings";
import { useDNSService } from "../services/dns.service";
import { BadRequestError } from "../utils";

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maskToken(token: string): string {
  if (token.length <= 10) return "****";
  return `${token.slice(0, 6)}${"*".repeat(token.length - 10)}${token.slice(-4)}`;
}

async function resolveAndSave(
  scope: "apps" | "db",
  body: { apiToken?: string; baseDomain?: string; zoneId?: string },
  res: Response,
  next: NextFunction
) {
  let { apiToken, baseDomain, zoneId } = body;

  if (!baseDomain) {
    next(new BadRequestError("baseDomain is required"));
    return;
  }

  // If no token supplied in the request, fall back to the one already saved in settings.
  if (!apiToken) {
    const saved = await useSettingsRepo().get("dns.cloudflare.apiToken");
    if (!saved) {
      next(new BadRequestError("apiToken is required — no saved Cloudflare token found. Save your API token first."));
      return;
    }
    apiToken = saved;
  }

  const dns = useDNSService();

  // Auto-discover zoneId if not provided
  let resolvedZoneId = zoneId as string | undefined;
  let zoneName = baseDomain;

  if (!resolvedZoneId) {
    const result = await dns.verifyAndDiscover(apiToken, baseDomain);
    if (!result.valid) {
      next(new BadRequestError(result.error || "Cloudflare token verification failed"));
      return;
    }
    resolvedZoneId = result.zoneId;
    zoneName = result.zoneName;
  }

  await dns.saveConfig(
    { provider: "cloudflare", apiToken, zoneId: resolvedZoneId, baseDomain },
    scope
  );

  res.json({
    message: `${scope === "apps" ? "Apps" : "Databases"} DNS configuration saved`,
    scope,
    zoneId: resolvedZoneId,
    zoneName,
    baseDomain,
  });
}

// ---------------------------------------------------------------------------
// POST /api/settings/dns/verify
// Test a Cloudflare token + domain. Returns discovered zone details.
// Body: { apiToken, baseDomain }
// ---------------------------------------------------------------------------
router.post("/dns/verify", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { apiToken, baseDomain } = req.body;

    if (!apiToken || !baseDomain) {
      next(new BadRequestError("apiToken and baseDomain are required"));
      return;
    }

    const dns = useDNSService();
    const result = await dns.verifyAndDiscover(apiToken, baseDomain);

    if (!result.valid) {
      res.status(400).json({ valid: false, error: result.error });
      return;
    }

    res.json({
      valid: true,
      zoneId: result.zoneId,
      zoneName: result.zoneName,
      tokenId: result.tokenId,
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/settings/dns
// Returns both apps and db DNS configs (token masked).
// ---------------------------------------------------------------------------
router.get("/dns", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dns = useDNSService();

    const [appsConfig, dbConfig, shared] = await Promise.all([
      dns.getAppsConfig(),
      dns.getDBConfig(),
      dns.getTokenOnly(),
    ]);

    const maskedToken = shared?.apiToken ? maskToken(shared.apiToken) : undefined;

    res.json({
      provider: shared?.provider ?? null,
      apiToken: maskedToken,
      apps: appsConfig
        ? { configured: true, zoneId: appsConfig.zoneId, baseDomain: appsConfig.baseDomain }
        : { configured: false },
      db: dbConfig
        ? { configured: true, zoneId: dbConfig.zoneId, baseDomain: dbConfig.baseDomain }
        : { configured: false },
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/settings/dns/token
// Save only the shared API token (without requiring a full scope config).
// Body: { apiToken }
// ---------------------------------------------------------------------------
router.put("/dns/token", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { apiToken } = req.body;
    if (!apiToken) {
      next(new BadRequestError("apiToken is required"));
      return;
    }
    const repo = useSettingsRepo();
    await Promise.all([
      repo.set("dns.provider", "cloudflare"),
      repo.set("dns.cloudflare.apiToken", apiToken),
    ]);
    res.json({ message: "API token saved" });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/settings/dns/apps
// Save DNS config for apps (subdomains for deployed applications).
// Body: { apiToken, baseDomain, zoneId? }
// ---------------------------------------------------------------------------
router.put("/dns/apps", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await resolveAndSave("apps", req.body, res, next);
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/settings/dns/db
// Save DNS config for databases (SRV records for replica sets).
// Body: { apiToken, baseDomain, zoneId? }
// ---------------------------------------------------------------------------
router.put("/dns/db", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await resolveAndSave("db", req.body, res, next);
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/settings/dns/:scope
// Clear a specific scope's config. scope = "apps" | "db"
// ---------------------------------------------------------------------------
router.delete("/dns/:scope", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = req.params.scope as "apps" | "db";
    if (scope !== "apps" && scope !== "db") {
      next(new BadRequestError("scope must be 'apps' or 'db'"));
      return;
    }

    const repo = useSettingsRepo();
    const zoneKey   = scope === "apps" ? "dns.apps.zoneId"     : "dns.db.zoneId";
    const domainKey = scope === "apps" ? "dns.apps.baseDomain" : "dns.db.baseDomain";

    await Promise.all([
      repo.set(zoneKey,   ""),
      repo.set(domainKey, ""),
    ]);

    res.json({ message: `${scope === "apps" ? "Apps" : "Databases"} DNS configuration removed` });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/settings — all non-sensitive settings (token masked)
// ---------------------------------------------------------------------------
router.get("/", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = useSettingsRepo();
    const all = await repo.getAll();
    const SENSITIVE = /token|key|secret|password/i;
    res.json({
      settings: all.map((s) => ({
        key: s._id,
        value: SENSITIVE.test(s._id) ? "****" : s.value,
        updatedAt: s.updatedAt,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/settings/:key — upsert a single generic setting
// ---------------------------------------------------------------------------
router.put("/:key", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = req.params.key as string;
    const { value } = req.body;
    if (value === undefined || value === null) {
      next(new BadRequestError("value is required"));
      return;
    }
    const repo = useSettingsRepo();
    await repo.set(key, String(value));
    res.json({ message: "Setting saved", key });
  } catch (error) {
    next(error);
  }
});

export default router;
