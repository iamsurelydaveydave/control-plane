import express from "express";
import { requireAuth, requirePermission, logBroker } from "../utils";
import type { TLogEvent } from "../utils";
import { useAppController } from "../resources";
import { useDeploymentApprovalController } from "../resources/deployment-approval";

const router = express.Router();

const {
  add, getById, getAll, updateById, deleteById,
  deploy, redeploy, rollback,
  stop, start, restart, scale,
  getLogs, getVersion, getStatus, appExec,
  getDeployments, getLatestDeployment, getDeploymentStatus,
} = useAppController();

const approvalController = useDeploymentApprovalController();

// CRUD
router.get("/", requireAuth, requirePermission("apps:read"), getAll);
router.post("/", requireAuth, requirePermission("apps:create"), add);
router.get("/:id", requireAuth, requirePermission("apps:read"), getById);
router.patch("/:id", requireAuth, requirePermission("apps:update"), updateById);
router.delete("/:id", requireAuth, requirePermission("apps:delete"), deleteById);

// Deployment
router.post("/:id/deploy", requireAuth, requirePermission("apps:deploy"), deploy);
router.post("/:id/redeploy", requireAuth, requirePermission("apps:deploy"), redeploy);
router.post("/:id/rollback", requireAuth, requirePermission("apps:deploy"), rollback);
router.post("/:id/rollback/:version", requireAuth, requirePermission("apps:deploy"), rollback);

// Deployment approval
router.post("/:id/deploy/request", requireAuth, requirePermission("apps:deploy"), approvalController.requestApproval);
router.get("/:id/approvals", requireAuth, requirePermission("apps:read"), approvalController.getAppApprovals);

// Lifecycle
router.post("/:id/stop", requireAuth, requirePermission("apps:update"), stop);
router.post("/:id/start", requireAuth, requirePermission("apps:update"), start);
router.post("/:id/restart", requireAuth, requirePermission("apps:update"), restart);
router.patch("/:id/scale", requireAuth, requirePermission("apps:update"), scale);

// Inspection
router.get("/:id/logs", requireAuth, requirePermission("apps:read"), getLogs);
router.get("/:id/version", requireAuth, requirePermission("apps:read"), getVersion);
router.get("/:id/status", requireAuth, requirePermission("apps:read"), getStatus);
router.get("/:id/deployments", requireAuth, requirePermission("apps:read"), getDeployments);
router.get("/:id/deployments/latest", requireAuth, requirePermission("apps:read"), getLatestDeployment);
router.get("/:id/deployments/:deploymentId/status", requireAuth, requirePermission("apps:read"), getDeploymentStatus);

// Execution
router.post("/:id/exec", requireAuth, requirePermission("apps:update"), appExec);

// SSE — live deployment log stream
router.get("/:id/deploy/stream", requireAuth, requirePermission("apps:read"), (req, res) => {
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
