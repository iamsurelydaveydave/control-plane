import express, { Request, Response, NextFunction } from "express";
import { requireAuth } from "../utils";
import { useSettingsRepo } from "../resources/settings";
import { useDNSService } from "../services/dns.service";
import { BadRequestError } from "../utils";

const router = express.Router();

// ---------------------------------------------------------------------------
// POST /api/settings/dns/verify
//
// Test a Cloudflare token + domain before saving. Auto-discovers the Zone ID.
// Returns the zone details so the UI can confirm the right zone is matched.
//
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
      res.status(400).json({
        valid: false,
        error: result.error,
      });
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
// PUT /api/settings/dns
//
// Save DNS configuration. `zoneId` is optional — if omitted it is
// auto-discovered from the Cloudflare API using the token + baseDomain.
//
// Body: { provider, apiToken, baseDomain, zoneId? }
// ---------------------------------------------------------------------------
router.put("/dns", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { provider = "cloudflare", apiToken, baseDomain, zoneId } = req.body;

    if (!apiToken || !baseDomain) {
      next(new BadRequestError("apiToken and baseDomain are required"));
      return;
    }

    if (provider !== "cloudflare") {
      next(new BadRequestError("Only 'cloudflare' is supported as a DNS provider"));
      return;
    }

    const dns = useDNSService();

    // Resolve zone ID — use provided value or auto-discover
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

    await dns.saveConfig({ provider, apiToken, zoneId: resolvedZoneId, baseDomain });

    res.json({
      message: "DNS configuration saved",
      provider,
      zoneId: resolvedZoneId,
      zoneName,
      baseDomain,
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/settings/dns
//
// Returns the current DNS config. The API token is masked — only the first
// 6 and last 4 characters are shown.
// ---------------------------------------------------------------------------
router.get("/dns", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dns = useDNSService();
    const config = await dns.getConfig();

    if (!config) {
      res.json({ configured: false });
      return;
    }

    const token = config.apiToken;
    const maskedToken = token.length > 10
      ? `${token.slice(0, 6)}${"*".repeat(token.length - 10)}${token.slice(-4)}`
      : "****";

    res.json({
      configured: true,
      provider: config.provider,
      zoneId: config.zoneId,
      baseDomain: config.baseDomain,
      apiToken: maskedToken,
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/settings/dns
//
// Remove DNS configuration. Does NOT delete any existing DNS records — those
// are removed per-database via DELETE /api/databases/:id/dns.
// ---------------------------------------------------------------------------
router.delete("/dns", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = useSettingsRepo();
    await Promise.all([
      repo.set("dns.provider", ""),
      repo.set("dns.cloudflare.apiToken", ""),
      repo.set("dns.cloudflare.zoneId", ""),
      repo.set("dns.baseDomain", ""),
    ]);
    res.json({ message: "DNS configuration removed" });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/settings
//
// Returns all settings. Sensitive keys (token, key, secret, password) masked.
// ---------------------------------------------------------------------------
router.get("/", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = useSettingsRepo();
    const all = await repo.getAll();

    const SENSITIVE = /token|key|secret|password/i;
    const safe = all.map((s) => ({
      key: s._id,
      value: SENSITIVE.test(s._id) ? "****" : s.value,
      updatedAt: s.updatedAt,
    }));

    res.json({ settings: safe });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/settings/:key
//
// Upsert a single generic setting.
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
