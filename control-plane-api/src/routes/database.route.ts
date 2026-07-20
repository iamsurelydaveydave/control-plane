import express from "express";
import { requireAuth, requireScope, logBroker } from "../utils";
import type { TLogEvent } from "../utils";
import { useDatabaseController } from "../resources";

const router = express.Router();

const {
  add,
  getById,
  getAll,
  deleteById,
  provision,
  reprovision,
  remove,
  backup,
  restore,
  getBackupRecords,
  getCredentials,
  getLogs,
  addNode,
  removeNode,
  getHealth,
  configureDNS,
  removeDNS,
  configureTLS,
  getTLSStatus,
  getTLSCertificate,
  disableTLS,
} = useDatabaseController();

router.get("/", requireAuth, requireScope("databases:read"), getAll);
router.post("/", requireAuth, requireScope("databases:write"), add);
router.get("/:id", requireAuth, requireScope("databases:read"), getById);

// DELETE /:id — Full deletion (reverses provisioning)
// Removes: containers, config, keyfile, TLS, logs, data, DNS records, database record
// Query params:
//   - keep_data=true: Preserve data directory on servers
//   - force=true: Delete record even if container removal fails
router.delete("/:id", requireAuth, requireScope("databases:write"), deleteById);

router.post("/:id/provision", requireAuth, requireScope("databases:write"), provision);
router.post("/:id/reprovision", requireAuth, requireScope("databases:write"), reprovision);

// POST /:id/remove — Soft removal (stops but keeps record)
// Removes: containers, config, keyfile, TLS, logs, data (by default), DNS records
// Query params:
//   - keep_data=true: Preserve data directory
//   - delete_record=true: Also delete the database record
router.post("/:id/remove", requireAuth, requireScope("databases:write"), remove);

router.post("/:id/backup", requireAuth, requireScope("databases:write"), backup);
router.post("/:id/restore", requireAuth, requireScope("databases:write"), restore);
router.get("/:id/backups", requireAuth, requireScope("databases:read"), getBackupRecords);
router.get("/:id/credentials", requireAuth, requireScope("databases:read"), getCredentials);
router.get("/:id/logs", requireAuth, requireScope("databases:read"), getLogs);

// Node management
router.post("/:id/nodes", requireAuth, requireScope("databases:write"), addNode);
router.delete("/:id/nodes/:serverId", requireAuth, requireScope("databases:write"), removeNode);
router.get("/:id/health", requireAuth, requireScope("databases:read"), getHealth);

// DNS management
// POST   /:id/dns  — create/re-create DNS records (needs Cloudflare config in settings)
// DELETE /:id/dns  — remove DNS records
router.post("/:id/dns", requireAuth, requireScope("databases:write"), configureDNS);
router.delete("/:id/dns", requireAuth, requireScope("databases:write"), removeDNS);

// TLS management
// GET    /:id/tls     — get TLS status and configuration
// POST   /:id/tls     — configure TLS for the replica set (async, uses provision/stream)
// GET    /:id/tls/ca  — download CA certificate for client connections
// DELETE /:id/tls     — disable TLS (clears config, requires reprovision to fully disable)
router.get("/:id/tls", requireAuth, requireScope("databases:read"), getTLSStatus);
router.post("/:id/tls", requireAuth, requireScope("databases:write"), configureTLS);
router.get("/:id/tls/ca", requireAuth, requireScope("databases:read"), getTLSCertificate);
router.delete("/:id/tls", requireAuth, requireScope("databases:write"), disableTLS);

// ---------------------------------------------------------------------------
// SSE — live log stream for provisioning, deletion, and other operations
//
// GET /api/databases/:id/stream
// GET /api/databases/:id/provision/stream  (alias for backwards compatibility)
//
// Sends newline-delimited JSON SSE events:
//   { line: string }              — a log line
//   { done: true, status: '...' } — operation finished
//   comments ':heartbeat'         — keep-alive every 15s
// ---------------------------------------------------------------------------
function createLogStreamHandler(req: express.Request, res: express.Response) {
  const databaseId = req.params.id as string;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write(": connected\n\n");

  // Replay buffered lines so a late-joining client sees full history
  for (const line of logBroker.getBuffer(databaseId)) {
    res.write(`data: ${JSON.stringify({ line })}\n\n`);
  }

  const eventKey = `log:${databaseId}`;

  const onEvent = (event: TLogEvent) => {
    if (res.writableEnded) return;
    if (event.line !== undefined) {
      res.write(`data: ${JSON.stringify({ line: event.line })}\n\n`);
    }
    if (event.done) {
      res.write(`data: ${JSON.stringify({ done: true, status: event.status })}\n\n`);
      res.end();
    }
  };

  logBroker.on(eventKey, onEvent);

  // Heartbeat to survive proxies that close idle connections
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": heartbeat\n\n");
  }, 15_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    logBroker.off(eventKey, onEvent);
  });
}

// Primary stream endpoint (used for all operations: provision, delete, etc.)
router.get("/:id/stream", requireAuth, createLogStreamHandler);

// Backwards-compatible alias for provisioning
router.get("/:id/provision/stream", requireAuth, createLogStreamHandler);

export default router;
