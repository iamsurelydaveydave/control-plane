import { useSettingsRepo } from "../resources/settings";
import { logger } from "../utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TDNSConfig = {
  provider: "cloudflare";
  apiToken: string;
  zoneId: string;
  baseDomain: string; // e.g. "example.com"
};

export type TDNSVerifyResult = {
  valid: boolean;
  zoneId: string;
  zoneName: string;
  tokenId: string;
  error?: string;
};

export type TDNSRecordRef = {
  id: string;     // provider-assigned record ID (for deletion)
  type: string;   // "A" | "SRV" | "TXT"
  name: string;   // full record name
};

export type TDNSReplicaSetResult = {
  clusterHost: string;          // "mydb.example.com"
  nodeHosts: string[];          // ["node1.mydb.example.com", …]
  srvConnectionString: string;  // "mongodb+srv://admin:***@mydb.example.com/…"
  records: TDNSRecordRef[];     // every record created (for teardown)
};

// ---------------------------------------------------------------------------
// Settings keys
// ---------------------------------------------------------------------------

const KEY_PROVIDER   = "dns.provider";
const KEY_API_TOKEN  = "dns.cloudflare.apiToken";
const KEY_ZONE_ID    = "dns.cloudflare.zoneId";
const KEY_BASE_DOMAIN = "dns.baseDomain";

const CF_BASE = "https://api.cloudflare.com/client/v4";

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function useDNSService() {
  const settings = useSettingsRepo();

  /**
   * Load DNS configuration from the settings store.
   * Returns null when DNS has not been configured yet.
   */
  async function getConfig(): Promise<TDNSConfig | null> {
    const [provider, apiToken, zoneId, baseDomain] = await Promise.all([
      settings.get(KEY_PROVIDER),
      settings.get(KEY_API_TOKEN),
      settings.get(KEY_ZONE_ID),
      settings.get(KEY_BASE_DOMAIN),
    ]);

    if (!provider || !apiToken || !zoneId || !baseDomain) return null;

    if (provider !== "cloudflare") {
      logger.log({ level: "warn", message: `[DNS] Unsupported provider: ${provider}` });
      return null;
    }

    return { provider, apiToken, zoneId, baseDomain };
  }

  /**
   * Persist DNS configuration into the settings store.
   * The apiToken is stored as-is (caller responsible for security).
   */
  async function saveConfig(config: TDNSConfig): Promise<void> {
    await Promise.all([
      settings.set(KEY_PROVIDER, config.provider),
      settings.set(KEY_API_TOKEN, config.apiToken),
      settings.set(KEY_ZONE_ID, config.zoneId),
      settings.set(KEY_BASE_DOMAIN, config.baseDomain),
    ]);
  }

  // -------------------------------------------------------------------------
  // Cloudflare credential verification + zone discovery
  // -------------------------------------------------------------------------

  /**
   * Verify a Cloudflare API token and auto-discover the Zone ID for the given
   * base domain. Call this before saving credentials — it confirms the token
   * works AND returns the zone ID so the user never needs to look it up.
   *
   * Requires the token to have at minimum:
   *   Zone > DNS > Edit   (for creating/deleting records)
   *   Zone > Zone > Read  (for listing zones)
   */
  async function verifyAndDiscover(
    apiToken: string,
    baseDomain: string
  ): Promise<TDNSVerifyResult> {
    // Step 1 — verify the token itself
    let tokenId = "";
    try {
      const tokenCheck = await cfRequest("GET", "/user/tokens/verify", apiToken);
      tokenId = tokenCheck.id as string;
    } catch (err: any) {
      return {
        valid: false,
        zoneId: "",
        zoneName: "",
        tokenId: "",
        error: `Invalid token: ${err.message}`,
      };
    }

    // Step 2 — look up the zone for baseDomain
    try {
      const { zoneId, zoneName } = await lookupZoneId(apiToken, baseDomain);
      return { valid: true, zoneId, zoneName, tokenId };
    } catch (err: any) {
      return {
        valid: false,
        zoneId: "",
        zoneName: "",
        tokenId,
        error: err.message,
      };
    }
  }

  /**
   * Look up the Cloudflare Zone ID for the given domain name.
   * Tries the exact domain first, then walks up to the apex
   * (e.g. "db.example.com" → tries "db.example.com", then "example.com").
   *
   * Throws if no matching active zone is found.
   */
  async function lookupZoneId(
    apiToken: string,
    domain: string
  ): Promise<{ zoneId: string; zoneName: string }> {
    // Build candidate list: try exact domain, then progressively strip subdomains
    const candidates: string[] = [];
    const parts = domain.split(".");
    for (let i = 0; i < parts.length - 1; i++) {
      candidates.push(parts.slice(i).join("."));
    }

    for (const candidate of candidates) {
      const result = await cfRequest(
        "GET",
        `/zones?name=${encodeURIComponent(candidate)}&status=active&per_page=5`,
        apiToken
      );
      if (Array.isArray(result) && result.length > 0) {
        const zone = result[0];
        logger.log({
          level: "info",
          message: `[DNS] Found zone: ${zone.name} (${zone.id})`,
        });
        return { zoneId: zone.id as string, zoneName: zone.name as string };
      }
    }

    throw new Error(
      `No active Cloudflare zone found for "${domain}". ` +
      `Make sure the domain is added to your Cloudflare account.`
    );
  }

  // -------------------------------------------------------------------------
  // Cloudflare API helpers
  // -------------------------------------------------------------------------

  async function cfRequest(
    method: string,
    urlPath: string,
    apiToken: string,
    body?: unknown
  ): Promise<any> {
    const url = `${CF_BASE}${urlPath}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const json = await response.json() as { success: boolean; errors?: any[]; result?: any };

    if (!json.success) {
      const msg = json.errors?.map((e: any) => e.message).join(", ") ?? "Unknown Cloudflare error";
      throw new Error(`Cloudflare API error: ${msg}`);
    }

    return json.result;
  }

  /** Create an A record. Returns the provider record ID. */
  async function createARecord(
    config: TDNSConfig,
    name: string,   // e.g. "node1.mydb" (relative to zone, or FQDN)
    ip: string
  ): Promise<string> {
    const result = await cfRequest("POST", `/zones/${config.zoneId}/dns_records`, config.apiToken, {
      type: "A",
      name,            // Cloudflare accepts FQDN or relative-to-zone name
      content: ip,
      ttl: 60,
      proxied: false,  // MUST be false — MongoDB is TCP, not HTTP
    });
    logger.log({ level: "info", message: `[DNS] Created A record: ${name} → ${ip} (id=${result.id})` });
    return result.id as string;
  }

  /**
   * Create one SRV record entry.
   *
   * Cloudflare SRV format (v4 API):
   *   type: "SRV"
   *   name: "_service._proto.subdomain"  (relative to zone)
   *   data: { priority, weight, port, target }
   *
   * We create one SRV record per RS member (same name, different targets).
   */
  async function createSRVRecord(
    config: TDNSConfig,
    srvName: string,  // e.g. "_mongodb._tcp.mydb"
    target: string,   // FQDN of the node, e.g. "node1.mydb.example.com"
    port: number
  ): Promise<string> {
    const result = await cfRequest("POST", `/zones/${config.zoneId}/dns_records`, config.apiToken, {
      type: "SRV",
      name: srvName,
      ttl: 60,
      data: {
        priority: 0,
        weight: 5,
        port,
        target: target.endsWith(".") ? target : `${target}.`,  // FQDN needs trailing dot
      },
    });
    logger.log({ level: "info", message: `[DNS] Created SRV record: ${srvName} → ${target}:${port} (id=${result.id})` });
    return result.id as string;
  }

  /** Create a TXT record for MongoDB driver options. */
  async function createTXTRecord(
    config: TDNSConfig,
    name: string,
    content: string
  ): Promise<string> {
    const result = await cfRequest("POST", `/zones/${config.zoneId}/dns_records`, config.apiToken, {
      type: "TXT",
      name,
      content: `"${content}"`,
      ttl: 60,
    });
    logger.log({ level: "info", message: `[DNS] Created TXT record: ${name} = "${content}" (id=${result.id})` });
    return result.id as string;
  }

  /** Delete a DNS record by its provider ID. */
  async function deleteRecord(config: TDNSConfig, recordId: string): Promise<void> {
    try {
      await cfRequest("DELETE", `/zones/${config.zoneId}/dns_records/${recordId}`, config.apiToken);
      logger.log({ level: "info", message: `[DNS] Deleted record id=${recordId}` });
    } catch (err: any) {
      // Log but don't throw — record may have been manually deleted already
      logger.log({ level: "warn", message: `[DNS] Failed to delete record ${recordId}: ${err.message}` });
    }
  }

  // -------------------------------------------------------------------------
  // High-level operations
  // -------------------------------------------------------------------------

  /**
   * Set up all DNS records for a MongoDB replica set and return the
   * `mongodb+srv://` connection string.
   *
   * Records created per cluster:
   *   • 1 A record per node:   node{n}.{cluster}.{domain} → IP
   *   • 3 SRV records:         _mongodb._tcp.{cluster}.{domain} → node hostnames
   *   • 1 TXT record:          {cluster}.{domain} → driver options
   *
   * If DNS is not configured in settings, returns null (silently skipped).
   */
  async function setupReplicaSet(options: {
    databaseName: string;
    nodes: Array<{ host: string; port: number }>;  // host = server IP
    adminUser: string;
    adminPassword: string;
    replicaSetName: string;
  }): Promise<TDNSReplicaSetResult | null> {
    const config = await getConfig();
    if (!config) {
      logger.log({ level: "info", message: "[DNS] DNS not configured — skipping DNS setup" });
      return null;
    }

    const { databaseName, nodes, adminUser, adminPassword, replicaSetName } = options;
    const safeName = databaseName.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();
    const clusterSubdomain = safeName;               // "mydb"
    const clusterHost = `${clusterSubdomain}.${config.baseDomain}`; // "mydb.example.com"
    const srvName = `_mongodb._tcp.${clusterSubdomain}`;           // relative to zone

    const records: TDNSRecordRef[] = [];
    const nodeHosts: string[] = [];

    try {
      // Step 1 — A record per node
      for (let i = 0; i < nodes.length; i++) {
        const nodeSubdomain = `node${i + 1}.${clusterSubdomain}`;  // "node1.mydb"
        const nodeFQDN = `${nodeSubdomain}.${config.baseDomain}`;  // "node1.mydb.example.com"
        nodeHosts.push(nodeFQDN);

        const id = await createARecord(config, nodeSubdomain, nodes[i].host);
        records.push({ id, type: "A", name: nodeFQDN });
      }

      // Step 2 — SRV record per node (all under the same SRV name)
      for (let i = 0; i < nodes.length; i++) {
        const id = await createSRVRecord(config, srvName, nodeHosts[i], nodes[i].port);
        records.push({ id, type: "SRV", name: `${srvName}.${config.baseDomain}` });
      }

      // Step 3 — TXT record with driver options
      const txtContent = `authSource=admin&replicaSet=${replicaSetName}`;
      const txtId = await createTXTRecord(config, clusterSubdomain, txtContent);
      records.push({ id: txtId, type: "TXT", name: clusterHost });

      // Step 4 — Build mongodb+srv:// connection string
      const user = encodeURIComponent(adminUser);
      const pass = encodeURIComponent(adminPassword);
      const srvConnectionString =
        `mongodb+srv://${user}:${pass}@${clusterHost}/?replicaSet=${replicaSetName}&authSource=admin`;

      logger.log({
        level: "info",
        message: `[DNS] Replica set DNS configured: ${clusterHost} (${records.length} records)`,
      });

      return { clusterHost, nodeHosts, srvConnectionString, records };
    } catch (err: any) {
      // Clean up any records we managed to create before the failure
      logger.log({ level: "error", message: `[DNS] Setup failed mid-way — rolling back ${records.length} records` });
      for (const rec of records) {
        await deleteRecord(config, rec.id);
      }
      throw err;
    }
  }

  /**
   * Remove all DNS records previously created for a cluster.
   * Swallows individual deletion errors (record may already be gone).
   */
  async function teardown(recordRefs: TDNSRecordRef[]): Promise<void> {
    if (!recordRefs.length) return;

    const config = await getConfig();
    if (!config) {
      logger.log({ level: "warn", message: "[DNS] teardown: DNS not configured — cannot delete records" });
      return;
    }

    await Promise.allSettled(recordRefs.map((r) => deleteRecord(config, r.id)));
    logger.log({ level: "info", message: `[DNS] Teardown complete — ${recordRefs.length} records removed` });
  }

  return { getConfig, saveConfig, verifyAndDiscover, lookupZoneId, setupReplicaSet, teardown };
}
