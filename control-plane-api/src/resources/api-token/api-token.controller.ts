import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import { useAPITokenService } from "./api-token.service";
import { availableScopes } from "./api-token.model";
import { BadRequestError } from "../../utils";

const schemaCreate = Joi.object({
  name: Joi.string().max(100).required(),
  scopes: Joi.array().items(Joi.string().valid(...availableScopes)).default(["*"]),
  expiresInDays: Joi.number().min(1).max(365).optional(),
});

export function useAPITokenController() {
  const service = useAPITokenService();

  async function getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.cookies?.user;
      if (!userId) {
        next(new BadRequestError("Not authenticated"));
        return;
      }

      const tokens = await service.getAllForUser(userId);
      res.json({ items: tokens });
    } catch (error) {
      next(error);
    }
  }

  async function create(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.cookies?.user;
      if (!userId) {
        next(new BadRequestError("Not authenticated"));
        return;
      }

      const { error, value } = schemaCreate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      let expiresAt: Date | undefined;
      if (value.expiresInDays) {
        expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + value.expiresInDays);
      }

      const { token, plainToken } = await service.create(
        userId,
        value.name,
        value.scopes,
        expiresAt
      );

      // Return the plain token only once - it cannot be retrieved later
      res.status(201).json({
        ...token,
        token: plainToken,
        message: "Save this token now. It cannot be retrieved later.",
      });
    } catch (error) {
      next(error);
    }
  }

  async function deleteToken(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      await service.deleteToken(id);
      res.json({ message: "API token deleted" });
    } catch (error) {
      next(error);
    }
  }

  async function getScopes(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json({ scopes: availableScopes });
    } catch (error) {
      next(error);
    }
  }

  return {
    getAll,
    create,
    deleteToken,
    getScopes,
  };
}
