/**
 * sslip.io URL generation utilities.
 *
 * sslip.io is a free DNS wildcard service: any hostname of the form
 *   {anything}.{ip}.sslip.io  resolves to {ip}
 *
 * This lets the control plane assign a stable, shareable URL to every
 * app and database node without requiring a real DNS provider.
 *
 * Examples:
 *   my-app.10.0.0.1.sslip.io          → 10.0.0.1
 *   node1.mydb.10.0.0.2.sslip.io      → 10.0.0.2
 */

const SSLIP_DOMAIN = "sslip.io";

/**
 * Build a sslip.io hostname for a given slug and server IP.
 *
 * @param slug  URL-safe identifier, e.g. app name or "node1.mydb"
 * @param ip    IPv4 address of the server (dots preserved — sslip.io expects them)
 */
export function generateSslipHost(slug: string, ip: string): string {
  const safeSlug = slug
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${safeSlug}.${ip}.${SSLIP_DOMAIN}`;
}

/**
 * Build a full HTTP URL using sslip.io.
 *
 * @param slug     URL-safe identifier
 * @param ip       IPv4 address
 * @param port     Optional non-standard port (omitted for 80/443)
 */
export function generateSslipUrl(
  slug: string,
  ip: string,
  port?: number
): string {
  const host = generateSslipHost(slug, ip);
  const portSuffix = port && port !== 80 && port !== 443 ? `:${port}` : "";
  const scheme = port === 443 ? "https" : "http";
  return `${scheme}://${host}${portSuffix}`;
}

/**
 * Return true if the given host is already a sslip.io hostname so we
 * can distinguish auto-generated hosts from real custom domains.
 */
export function isSslipHost(host: string): boolean {
  return host.endsWith(`.${SSLIP_DOMAIN}`);
}
