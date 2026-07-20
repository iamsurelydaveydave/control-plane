import express from "express";
import { requireAuth, requireScope, logBroker } from "../utils";
import type { TLogEvent } from "../utils";
import { useAppController } from "../resources";

const router = express.Router();

const {
  add, getById, getAll, updateById, deleteById,
  deploy, redeploy, rollback,
  stop, start, restart,
  getLogs, getVersion, appExec,
  getDeployments,
} = useAppController();

// CRUD
router.get("/", requireAuth, requireScope("apps:read"), getAll);
router.post("/", requireAuth, requireScope("apps:write"), add);
router.get("/:id", requireAuth, requireScope("apps:read"), getById);
router.patch("/:id", requireAuth, requireScope("apps:write"), updateById);
router.delete("/:id", requireAuth, requireScope("apps:write"), deleteById);

// Deployment
router.post("/:id/deploy", requireAuth, requireScope("deployments:write"), deploy);
router.post("/:id/redeploy", requireAuth, requireScope("deployments:write"), redeploy);
router.post("/:id/rollback", requireAuth, requireScope("deployments:write"), rollback);
router.post("/:id/rollback/:version", requireAuth, requireScope("deployments:write"), rollback);

// Lifecycle
router.post("/:id/stop", requireAuth, requireScope("apps:write"), stop);
router.post("/:id/start", requireAuth, requireScope("apps:write"), start);
router.post("/:id/restart", requireAuth, requireScope("apps:write"), restart);

// Inspection
router.get("/:id/logs", requireAuth, requireScope("apps:read"), getLogs);
router.get("/:id/version", requireAuth, requireScope("apps:read"), getVersion);
router.get("/:id/deployments", requireAuth, requireScope("deployments:read"), getDeployments);

// Execution
router.post("/:id/exec", requireAuth, requireScope("apps:write"), appExec);

// SSE — live deployment log stream
router.get("/:id/deploy/stream", requireAuth, (req, res) => {
  const appId = req.params.id as string;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write(": connected\n\n");

  for (const line of logBroker.getBuffer(appId)) {
    res.write(`data: ${JSON.stringify({ line })}\n\n`);
  }

  const eventKey = `log:${appId}`;

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

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": heartbeat\n\n");
  }, 15_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    logBroker.off(eventKey, onEvent);
  });
});

export default router;
