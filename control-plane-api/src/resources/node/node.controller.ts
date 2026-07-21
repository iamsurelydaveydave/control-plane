import { Request, Response, NextFunction } from "express";
import { useNodeRepo } from "./node.repository";
import { useNodeService } from "./node.service";
import { useNodeProvisioningService } from "./node.provisioning";
import {
  schemaNodeCreate,
  schemaNodeUpdate,
  schemaJoinToken,
  schemaNodeLabel,
  schemaNodeTaint,
  schemaNodeProvision,
  modelNode,
} from "./node.model";
import { BadRequestError } from "../../utils/error";

export function useNodeController() {
  const repo = useNodeRepo();
  const service = useNodeService();
  const provisioningService = useNodeProvisioningService();

  /**
   * GET /nodes - List all nodes (across all clusters)
   */
  async function list(req: Request, res: Response, next: NextFunction) {
    try {
      const nodes = await repo.getAll();
      res.json({ nodes });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /nodes/cluster/:clusterId - List nodes for a specific cluster
   */
  async function listByCluster(req: Request, res: Response, next: NextFunction) {
    try {
      const clusterId = req.params.clusterId as string;
      const page = Number(req.query.page) || 1;
      const role = req.query.role as string | undefined;
      const status = req.query.status as string | undefined;

      const result = await service.listNodes(clusterId, { page, role, status });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /nodes/:id - Get node by ID
   */
  async function getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const node = await service.getNode(id);
      res.json({ node });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /nodes/join-token - Generate worker join command
   */
  async function generateJoinToken(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaJoinToken.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const result = await service.generateJoinToken(value.clusterId, value.nodeName);

      res.status(201).json({
        message: "Join token generated. Run the command on your worker VM to join the cluster.",
        node: result.node,
        joinCommand: result.joinCommand,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /nodes/:id/sync - Sync node status from K8s
   */
  async function sync(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const node = await service.syncNode(id);

      res.json({
        message: "Node synced.",
        node,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /nodes/sync-all - Sync all nodes for a cluster from K8s
   */
  async function syncAll(req: Request, res: Response, next: NextFunction) {
    try {
      const clusterId = req.body.clusterId as string;
      if (!clusterId) {
        next(new BadRequestError("clusterId is required"));
        return;
      }

      const nodes = await service.syncAllNodes(clusterId);

      res.json({
        message: `Synced ${nodes.length} nodes.`,
        nodes,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /nodes/:id/cordon - Mark node as unschedulable
   */
  async function cordon(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const node = await service.cordonNode(id);

      res.json({
        message: "Node cordoned (marked as unschedulable).",
        node,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /nodes/:id/uncordon - Mark node as schedulable
   */
  async function uncordon(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const node = await service.uncordonNode(id);

      res.json({
        message: "Node uncordoned (marked as schedulable).",
        node,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /nodes/:id/drain - Drain all pods from node
   */
  async function drain(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const options = {
        gracePeriodSeconds: req.body.gracePeriodSeconds as number | undefined,
        ignoreDaemonSets: req.body.ignoreDaemonSets as boolean | undefined,
        deleteEmptyDirData: req.body.deleteEmptyDirData as boolean | undefined,
      };

      const node = await service.drainNode(id, options);

      res.json({
        message: "Node drained.",
        node,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /nodes/:id - Remove node from cluster
   */
  async function remove(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      await service.removeNode(id);

      res.json({
        message: "Node removed from cluster.",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /nodes/:id/labels - Add label to node
   */
  async function addLabel(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { error, value } = schemaNodeLabel.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const node = await service.addLabel(id, value.key, value.value);

      res.json({
        message: "Label added.",
        node,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /nodes/:id/labels/:key - Remove label from node
   */
  async function removeLabel(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const key = req.params.key as string;

      const node = await service.removeLabel(id, key);

      res.json({
        message: "Label removed.",
        node,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /nodes/test-connection - Test SSH connection before provisioning
   */
  async function testConnection(req: Request, res: Response, next: NextFunction) {
    try {
      const { host, sshPort, sshUser, sshKeyId } = req.body;

      if (!host || !sshKeyId) {
        next(new BadRequestError("host and sshKeyId are required"));
        return;
      }

      const result = await provisioningService.testConnection({
        host,
        sshPort: sshPort || 22,
        sshUser: sshUser || "root",
        sshKeyId,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /nodes/provision - Create and provision a new worker node
   */
  async function provision(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaNodeProvision.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      // Check if node name already exists in this cluster
      const existing = await repo.getByName(value.clusterId, value.name);
      if (existing) {
        next(new BadRequestError(`Node with name '${value.name}' already exists in this cluster.`));
        return;
      }

      // Create the node record
      const nodeData = modelNode({
        clusterId: value.clusterId,
        name: value.name,
        host: value.host,
        sshUser: value.sshUser,
        sshPort: value.sshPort,
        sshKeyId: value.sshKeyId,
        role: "worker",
      });

      const nodeId = await repo.add(nodeData);

      // Start provisioning (runs in background)
      await provisioningService.startProvisioning(nodeId);

      const node = await repo.getById(nodeId);

      res.status(201).json({
        message: "Node provisioning started.",
        node,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /nodes/:id/provisioning-status - Get provisioning status
   */
  async function getProvisioningStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const result = await provisioningService.getProvisioningStatus(id);
      const node = await repo.getById(id);

      res.json({
        node,
        provisioningStatus: result.status,
        provisioningLog: result.log,
        provisioningStartedAt: result.startedAt,
        provisioningCompletedAt: result.completedAt,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /nodes/:id/retry-provision - Retry provisioning a failed node
   */
  async function retryProvision(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const node = await repo.getById(id);

      if (node.status !== "failed" && node.status !== "pending") {
        next(new BadRequestError("Can only retry provisioning for failed or pending nodes."));
        return;
      }

      // Reset status
      await repo.updateStatus(id, "pending", "Retrying provisioning...");
      await repo.updateProvisioningStatus(id, "idle");

      // Start provisioning
      await provisioningService.startProvisioning(id);

      const updatedNode = await repo.getById(id);

      res.json({
        message: "Provisioning retry started.",
        node: updatedNode,
      });
    } catch (error) {
      next(error);
    }
  }

  return {
    list,
    listByCluster,
    getById,
    generateJoinToken,
    sync,
    syncAll,
    cordon,
    uncordon,
    drain,
    remove,
    addLabel,
    removeLabel,
    // Provisioning
    testConnection,
    provision,
    getProvisioningStatus,
    retryProvision,
  };
}
