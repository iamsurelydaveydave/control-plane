import express, { Request, Response, NextFunction } from "express";
import { requireAuth } from "../utils";
import { useSettingsRepo } from "../resources/settings";
import { useDNSService } from "../services/dns.service";
import { useK8sService } from "../services/k8s.service";
import { getProvisionerType } from "../services/mongodb.provisioner.factory";
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
// Kubernetes (K3s) Settings
// ---------------------------------------------------------------------------

// GET /api/settings/k8s — Get Kubernetes configuration status
router.get("/k8s", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const k8sEnabled = process.env.K8S_ENABLED === "true";
    const provisionerType = getProvisionerType();
    
    let k8sStatus: {
      enabled: boolean;
      available: boolean;
      nodes: number;
      serverUrl?: string;
      error?: string;
    } = {
      enabled: k8sEnabled,
      available: false,
      nodes: 0,
    };

    if (k8sEnabled) {
      try {
        const k8s = useK8sService();
        k8sStatus.available = await k8s.isAvailable();
        k8sStatus.serverUrl = process.env.K3S_SERVER_URL;
        
        if (k8sStatus.available) {
          const nodes = await k8s.getNodes();
          k8sStatus.nodes = nodes.length;
        }
      } catch (err: any) {
        k8sStatus.available = false;
        k8sStatus.error = err.message || "K8s health check failed";
      }
    }

    res.json({
      kubernetes: k8sStatus,
      provisioner: provisionerType,
      hasK3sToken: !!process.env.K3S_TOKEN,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/settings/k8s/nodes — List K8s cluster nodes
router.get("/k8s/nodes", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (process.env.K8S_ENABLED !== "true") {
      res.json({ enabled: false, nodes: [] });
      return;
    }

    const k8s = useK8sService();
    const available = await k8s.isAvailable();
    
    if (!available) {
      res.json({ enabled: true, available: false, nodes: [] });
      return;
    }

    const rawNodes = await k8s.getNodes();
    const nodes = rawNodes.map((node: any) => {
      const addresses = node.status?.addresses || [];
      const internalIP = addresses.find((a: any) => a.type === "InternalIP")?.address;
      const hostname = addresses.find((a: any) => a.type === "Hostname")?.address;
      const conditions = node.status?.conditions || [];
      const readyCondition = conditions.find((c: any) => c.type === "Ready");
      
      return {
        name: node.metadata.name,
        hostname,
        internalIP,
        ready: readyCondition?.status === "True",
        roles: Object.keys(node.metadata.labels || {})
          .filter((l) => l.startsWith("node-role.kubernetes.io/"))
          .map((l) => l.replace("node-role.kubernetes.io/", "")),
        createdAt: node.metadata.creationTimestamp,
      };
    });

    res.json({ enabled: true, available: true, nodes });
  } catch (error) {
    next(error);
  }
});

// GET /api/settings/k8s/agent-command — Get the command to join a server as K3s agent
router.get("/k8s/agent-command", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (process.env.K8S_ENABLED !== "true") {
      next(new BadRequestError("Kubernetes is not enabled. Set K8S_ENABLED=true to enable."));
      return;
    }

    const serverUrl = process.env.K3S_SERVER_URL;
    const token = process.env.K3S_TOKEN;

    if (!serverUrl || !token) {
      next(new BadRequestError(
        "K3S_SERVER_URL and K3S_TOKEN are not configured. " +
        "Run the K3s server setup script first."
      ));
      return;
    }

    const command = `curl -sfL https://get.k3s.io | K3S_URL=${serverUrl} K3S_TOKEN=${token} sh -`;

    res.json({
      serverUrl,
      command,
      instructions: [
        "SSH into the database server as root",
        "Run the command above",
        "The server will automatically join the K3s cluster",
        "New databases will use K8s-based provisioning",
      ],
    });
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
