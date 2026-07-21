import { Request, Response, NextFunction } from "express";
import { useRegistryRepo } from "./registry.repository";
import { useRegistryService } from "./registry.service";
import {
  schemaRegistryCreate,
  schemaRegistryUpdate,
  registryToResponse,
} from "./registry.model";
import { BadRequestError, NotFoundError } from "../../utils";

// =============================================================================
// Controller
// =============================================================================

export function useRegistryController() {
  const repo = useRegistryRepo();
  const service = useRegistryService();

  // ---------------------------------------------------------------------------
  // List registries
  // ---------------------------------------------------------------------------
  async function list(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        page = "1",
        limit = "20",
        search = "",
        status,
        type,
        organizationId,
      } = req.query;

      const result = await repo.getAll({
        page: Number(page),
        limit: Number(limit),
        search: String(search),
        status: status as any,
        type: String(type || ""),
        organizationId: String(organizationId || ""),
      });

      res.json({
        items: result.items.map(registryToResponse),
        total: result.total,
        page: result.page,
        pages: result.pages,
        pageRange: result.pageRange,
      });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Get registry by ID
  // ---------------------------------------------------------------------------
  async function getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const registry = await repo.getById(id);

      if (!registry) {
        next(new NotFoundError("Registry not found"));
        return;
      }

      res.json({ registry: registryToResponse(registry) });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Create registry
  // ---------------------------------------------------------------------------
  async function add(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaRegistryCreate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const registryId = await service.create(value);

      res.status(201).json({
        message: "Registry created",
        registryId,
      });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Update registry
  // ---------------------------------------------------------------------------
  async function updateById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { error, value } = schemaRegistryUpdate.validate(req.body);

      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      // Check if registry exists
      const existing = await repo.getById(id);
      if (!existing) {
        next(new NotFoundError("Registry not found"));
        return;
      }

      // If credentials changed, set status back to pending
      if (value.credentials) {
        value.status = "pending";
      }

      await repo.updateById(id, value);

      res.json({ message: "Registry updated" });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Delete registry
  // ---------------------------------------------------------------------------
  async function deleteById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      // Get registry to clean up K8s secrets
      const registry = await repo.getById(id);
      if (!registry) {
        next(new NotFoundError("Registry not found"));
        return;
      }

      // Delete pull secrets from all namespaces
      for (const namespace of registry.namespaces || []) {
        try {
          await service.deletePullSecret(id, namespace);
        } catch (err) {
          // Continue even if some deletions fail
        }
      }

      await repo.deleteById(id);

      res.json({ message: "Registry deleted" });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Verify credentials
  // ---------------------------------------------------------------------------
  async function verify(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      const isValid = await service.verifyCredentials(id);

      res.json({
        message: isValid ? "Credentials verified" : "Verification failed",
        valid: isValid,
      });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Sync pull secrets to all namespaces
  // ---------------------------------------------------------------------------
  async function syncSecrets(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      await service.syncPullSecrets(id);

      res.json({ message: "Pull secrets synced" });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Create pull secret in a namespace
  // ---------------------------------------------------------------------------
  async function createPullSecret(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const id = req.params.id as string;
      const { namespace } = req.body;

      if (!namespace) {
        next(new BadRequestError("Namespace is required"));
        return;
      }

      const secretName = await service.createPullSecret(id, namespace);

      res.status(201).json({
        message: "Pull secret created",
        secretName,
        namespace,
      });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Delete pull secret from a namespace
  // ---------------------------------------------------------------------------
  async function deletePullSecret(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const id = req.params.id as string;
      const namespace = req.params.namespace as string;

      await service.deletePullSecret(id, namespace);

      res.json({ message: "Pull secret deleted" });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // List repositories
  // ---------------------------------------------------------------------------
  async function listRepositories(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const id = req.params.id as string;

      const repositories = await service.listRepositories(id);

      res.json({ repositories });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // List tags for a repository
  // ---------------------------------------------------------------------------
  async function listTags(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const repository = req.params.repo as string;

      // Decode the repository name (may contain slashes)
      const decodedRepo = decodeURIComponent(repository);

      const tags = await service.listTags(id, decodedRepo);

      res.json({ tags });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Delete a tag
  // ---------------------------------------------------------------------------
  async function deleteTag(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const repository = req.params.repo as string;
      const tag = req.params.tag as string;

      // Decode the repository name
      const decodedRepo = decodeURIComponent(repository);

      await service.deleteTag(id, decodedRepo, tag);

      res.json({ message: "Tag deleted" });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Set default registry
  // ---------------------------------------------------------------------------
  async function setDefault(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      await repo.setDefault(id);

      res.json({ message: "Default registry updated." });
    } catch (error) {
      next(error);
    }
  }

  return {
    list,
    getById,
    add,
    updateById,
    deleteById,
    verify,
    setDefault,
    syncSecrets,
    createPullSecret,
    deletePullSecret,
    listRepositories,
    listTags,
    deleteTag,
  };
}
