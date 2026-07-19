import { Request, Response, NextFunction } from "express";
import { useSecretRepo } from "./secret.repository";
import { schemaSecretCreate, schemaSecretUpdate, secretToResponse } from "./secret.model";
import { BadRequestError, NotFoundError } from "../../utils";

export function useSecretController() {
  const repo = useSecretRepo();

  // ---------------------------------------------------------------------------
  // Create a new secret
  // ---------------------------------------------------------------------------
  async function add(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaSecretCreate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      // Check if secret with same name already exists (for same app or global)
      const existing = await repo.getByName(value.name, value.appId || null);
      if (existing) {
        next(new BadRequestError(`Secret "${value.name}" already exists`));
        return;
      }

      const id = await repo.add(value);
      
      res.status(201).json({
        message: "Secret created",
        secretId: id.toString(),
      });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Get secret by ID (metadata only, value is never returned)
  // ---------------------------------------------------------------------------
  async function getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const secret = await repo.getById(id);

      if (!secret) {
        next(new NotFoundError("Secret not found"));
        return;
      }

      res.json({ secret: secretToResponse(secret) });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // List secrets (metadata only)
  // ---------------------------------------------------------------------------
  async function getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const { appId } = req.query;

      const secrets = await repo.getAll({
        appId: appId as string | undefined,
        includeGlobal: true,
      });

      res.json({
        items: secrets.map(secretToResponse),
      });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // List global secrets only
  // ---------------------------------------------------------------------------
  async function getGlobal(req: Request, res: Response, next: NextFunction) {
    try {
      const secrets = await repo.getAll({ appId: undefined });

      res.json({
        items: secrets.map(secretToResponse),
      });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Update secret
  // ---------------------------------------------------------------------------
  async function updateById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { error, value } = schemaSecretUpdate.validate(req.body);
      
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      if (!value.value && value.description === undefined) {
        next(new BadRequestError("Nothing to update"));
        return;
      }

      await repo.updateById(id, value);
      
      res.json({ message: "Secret updated" });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Delete secret
  // ---------------------------------------------------------------------------
  async function deleteById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      await repo.deleteById(id);
      res.json({ message: "Secret deleted" });
    } catch (error) {
      next(error);
    }
  }

  return {
    add,
    getById,
    getAll,
    getGlobal,
    updateById,
    deleteById,
  };
}
