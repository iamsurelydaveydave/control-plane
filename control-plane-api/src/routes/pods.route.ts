import express, { Request, Response, NextFunction } from "express";
import Joi from "joi";
import { requireAuth, requirePermission } from "../utils/auth.middleware";
import { usePodExecService } from "../services/pod-exec.service";
import { BadRequestError } from "../utils/error";

const router = express.Router();

// All pod routes require authentication
router.use(requireAuth);

const podExecService = usePodExecService();

// Validation schemas
const schemaExecBody = Joi.object({
  container: Joi.string().required(),
  command: Joi.array().items(Joi.string()).min(1).required(),
});

const schemaLogsQuery = Joi.object({
  container: Joi.string(),
  tail: Joi.number().integer().min(1).max(10000),
  sinceSeconds: Joi.number().integer().min(1),
  timestamps: Joi.boolean(),
});

/**
 * GET /api/pods
 * List all pods across namespaces
 */
async function listAllPods(req: Request, res: Response, next: NextFunction) {
  try {
    const labelSelector = req.query.labelSelector as string | undefined;
    const pods = await podExecService.listPods(undefined, labelSelector);
    res.json({ pods });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/pods/:namespace
 * List pods in a specific namespace
 */
async function listNamespacedPods(req: Request, res: Response, next: NextFunction) {
  try {
    const namespace = req.params.namespace as string;
    const labelSelector = req.query.labelSelector as string | undefined;
    const pods = await podExecService.listPods(namespace, labelSelector);
    res.json({ pods });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/pods/:namespace/:pod
 * Get pod details
 */
async function getPodDetails(req: Request, res: Response, next: NextFunction) {
  try {
    const namespace = req.params.namespace as string;
    const pod = req.params.pod as string;
    const podDetails = await podExecService.getPod(namespace, pod);
    res.json(podDetails);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/pods/:namespace/:pod/logs
 * Get pod logs
 */
async function getPodLogs(req: Request, res: Response, next: NextFunction) {
  try {
    const namespace = req.params.namespace as string;
    const pod = req.params.pod as string;

    const { error, value } = schemaLogsQuery.validate(req.query);
    if (error) {
      next(new BadRequestError(error.message));
      return;
    }

    const logs = await podExecService.getPodLogs(namespace, pod, {
      container: value.container,
      tailLines: value.tail,
      sinceSeconds: value.sinceSeconds,
      timestamps: value.timestamps,
    });

    res.json(logs);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/pods/:namespace/:pod/exec
 * Execute a one-shot command in a pod
 */
async function execCommand(req: Request, res: Response, next: NextFunction) {
  try {
    const namespace = req.params.namespace as string;
    const pod = req.params.pod as string;

    const { error, value } = schemaExecBody.validate(req.body);
    if (error) {
      next(new BadRequestError(error.message));
      return;
    }

    const result = await podExecService.exec(namespace, pod, value.container, value.command);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

// Routes with permission checks
router.get("/", requirePermission("pods:read"), listAllPods);
router.get("/:namespace", requirePermission("pods:read"), listNamespacedPods);
router.get("/:namespace/:pod", requirePermission("pods:read"), getPodDetails);
router.get("/:namespace/:pod/logs", requirePermission("pods:read"), getPodLogs);
router.post("/:namespace/:pod/exec", requirePermission("pods:exec"), execCommand);

// Note: WebSocket endpoint for interactive shell is handled separately in server.ts
// Connect via: ws://host/api/pods/:namespace/:pod/exec?container=xxx

export default router;
