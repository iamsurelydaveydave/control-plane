import express from "express";
import { useNodeController } from "../resources/node";
import { requireAuth, requirePermission } from "../utils/auth.middleware";

const router = express.Router();
const controller = useNodeController();

// All node routes require authentication
router.use(requireAuth);

// List all nodes (across all clusters)
router.get("/", requirePermission("nodes:read"), controller.list);

// List nodes for a specific cluster
router.get("/cluster/:clusterId", requirePermission("nodes:read"), controller.listByCluster);

// Generate join token for new worker node (manual method)
router.post("/join-token", requirePermission("nodes:create"), controller.generateJoinToken);

// Test SSH connection before provisioning
router.post("/test-connection", requirePermission("nodes:create"), controller.testConnection);

// Provision a new worker node (automated method)
router.post("/provision", requirePermission("nodes:create"), controller.provision);

// Sync all nodes for a cluster from K8s
router.post("/sync-all", requirePermission("nodes:read"), controller.syncAll);

// Get node by ID
router.get("/:id", requirePermission("nodes:read"), controller.getById);

// Get provisioning status
router.get("/:id/provisioning-status", requirePermission("nodes:read"), controller.getProvisioningStatus);

// Retry provisioning for a failed node
router.post("/:id/retry-provision", requirePermission("nodes:update"), controller.retryProvision);

// Sync single node from K8s
router.post("/:id/sync", requirePermission("nodes:read"), controller.sync);

// Cordon node (mark unschedulable)
router.post("/:id/cordon", requirePermission("nodes:update"), controller.cordon);

// Uncordon node (mark schedulable)
router.post("/:id/uncordon", requirePermission("nodes:update"), controller.uncordon);

// Drain node (evict pods)
router.post("/:id/drain", requirePermission("nodes:update"), controller.drain);

// Remove node from cluster
router.delete("/:id", requirePermission("nodes:delete"), controller.remove);

// Add label to node
router.post("/:id/labels", requirePermission("nodes:update"), controller.addLabel);

// Remove label from node
router.delete("/:id/labels/:key", requirePermission("nodes:update"), controller.removeLabel);

export default router;
