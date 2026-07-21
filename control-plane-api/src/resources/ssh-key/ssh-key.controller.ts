import { Request, Response, NextFunction } from "express";
import { useSSHKeyService } from "./ssh-key.service";
import { schemaSSHKeyCreate, schemaSSHKeyImport, schemaSSHKeyUpdate } from "./ssh-key.model";
import { BadRequestError } from "../../utils/error";

export function useSSHKeyController() {
  const service = useSSHKeyService();

  /**
   * GET /ssh-keys - List all SSH keys
   */
  async function list(req: Request, res: Response, next: NextFunction) {
    try {
      const keys = await service.getAll();
      res.json({ items: keys });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /ssh-keys - Generate a new SSH key
   */
  async function create(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaSSHKeyCreate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const { key, privateKey } = await service.create(
        value.name,
        value.type,
        value.isDefault
      );

      // Return the private key only on creation
      res.status(201).json({
        message: "SSH key generated.",
        ...key,
        privateKey, // One-time return
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /ssh-keys/import - Import an existing SSH key
   */
  async function importKey(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaSSHKeyImport.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const key = await service.importKey(
        value.name,
        value.privateKey,
        value.isDefault
      );

      res.status(201).json({
        message: "SSH key imported.",
        ...key,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /ssh-keys/:id - Get SSH key by ID
   */
  async function getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const key = await service.getById(id);

      if (!key) {
        next(new BadRequestError("SSH key not found."));
        return;
      }

      res.json({ key });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /ssh-keys/:id - Update SSH key
   */
  async function update(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { error, value } = schemaSSHKeyUpdate.validate(req.body);
      
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      if (!value.name && value.isDefault === undefined) {
        next(new BadRequestError("Nothing to update."));
        return;
      }

      await service.update(id, value);
      const key = await service.getById(id);

      res.json({
        message: "SSH key updated.",
        key,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /ssh-keys/:id/default - Set SSH key as default
   */
  async function setDefault(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      await service.setDefault(id);

      res.json({ message: "SSH key set as default." });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /ssh-keys/:id - Delete SSH key
   */
  async function remove(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      await service.deleteKey(id);

      res.json({ message: "SSH key deleted." });
    } catch (error) {
      next(error);
    }
  }

  return {
    list,
    create,
    importKey,
    getById,
    update,
    setDefault,
    remove,
  };
}
