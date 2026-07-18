import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import { useSSHKeyService } from "./ssh-key.service";
import { BadRequestError } from "../../utils";

const schemaCreate = Joi.object({
  name: Joi.string().max(100).required(),
  type: Joi.string().valid("ed25519", "rsa").default("ed25519"),
  isDefault: Joi.boolean().default(false),
});

const schemaImport = Joi.object({
  name: Joi.string().max(100).required(),
  privateKey: Joi.string().required(),
  isDefault: Joi.boolean().default(false),
});

const schemaUpdate = Joi.object({
  name: Joi.string().max(100).optional(),
  isDefault: Joi.boolean().optional(),
});

export function useSSHKeyController() {
  const service = useSSHKeyService();

  async function getAll(_req: Request, res: Response, next: NextFunction) {
    try {
      const keys = await service.getAll();
      res.json({ items: keys });
    } catch (error) {
      next(error);
    }
  }

  async function getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const key = await service.getById(id);
      
      if (!key) {
        next(new BadRequestError("SSH key not found"));
        return;
      }

      res.json(key);
    } catch (error) {
      next(error);
    }
  }

  async function create(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaCreate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const { key, privateKey } = await service.create(value.name, value.type, value.isDefault);
      
      // Return the private key only once — it cannot be retrieved later
      res.status(201).json({
        ...key,
        privateKey,
        message: "Save this private key now. It cannot be retrieved later.",
      });
    } catch (error) {
      next(error);
    }
  }

  async function importKey(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaImport.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const key = await service.importKey(value.name, value.privateKey, value.isDefault);
      res.status(201).json(key);
    } catch (error) {
      next(error);
    }
  }

  async function update(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { error, value } = schemaUpdate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      await service.update(id, value);
      res.json({ message: "SSH key updated" });
    } catch (error) {
      next(error);
    }
  }

  async function deleteKey(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      await service.deleteKey(id);
      res.json({ message: "SSH key deleted" });
    } catch (error) {
      next(error);
    }
  }

  async function setDefault(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      await service.setDefault(id);
      res.json({ message: "SSH key set as default" });
    } catch (error) {
      next(error);
    }
  }

  return {
    getAll,
    getById,
    create,
    importKey,
    update,
    deleteKey,
    setDefault,
  };
}
