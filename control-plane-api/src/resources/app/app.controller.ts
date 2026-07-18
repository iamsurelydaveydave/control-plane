import { Request, Response, NextFunction } from "express";
import { useAppRepo } from "./app.repository";
import { schemaAppCreate, schemaAppUpdate, schemaAppScale, schemaAppDeploy } from "./app.model";
import { BadRequestError } from "../../utils";

export function useAppController() {
  const repo = useAppRepo();

  async function add(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaAppCreate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const id = await repo.add(value);
      res.status(201).json({ message: "App created", appId: id });
    } catch (error) {
      next(error);
    }
  }

  async function getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const app = await repo.getById(id);

      if (!app) {
        next(new BadRequestError("App not found"));
        return;
      }

      res.json({ app });
    } catch (error) {
      next(error);
    }
  }

  async function getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const { search, page, limit, status } = req.query;

      const data = await repo.getAll({
        search: search as string,
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 10,
        status: status as any,
      });

      res.json(data);
    } catch (error) {
      next(error);
    }
  }

  async function updateById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { error, value } = schemaAppUpdate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      await repo.updateById(id, value);
      res.json({ message: "App updated" });
    } catch (error) {
      next(error);
    }
  }

  async function deleteById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      await repo.deleteById(id);
      res.json({ message: "App deleted" });
    } catch (error) {
      next(error);
    }
  }

  async function scale(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { error, value } = schemaAppScale.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      await repo.scale(id, value.desiredReplicas);
      res.json({ message: "App scaled" });
    } catch (error) {
      next(error);
    }
  }

  async function restart(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      // TODO: Implement actual restart logic with Docker/Kamal
      // For now, just update status
      await repo.updateStatus(id, "deploying");

      res.json({ message: "App restart initiated" });
    } catch (error) {
      next(error);
    }
  }

  async function deploy(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { error, value } = schemaAppDeploy.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const app = await repo.getById(id);
      if (!app) {
        next(new BadRequestError("App not found"));
        return;
      }

      // Update image if provided
      if (value.image) {
        await repo.updateById(id, { image: value.image });
      }

      // TODO: Implement actual deploy logic with Docker/Kamal
      await repo.updateStatus(id, "deploying");

      res.json({ message: "Deployment initiated" });
    } catch (error) {
      next(error);
    }
  }

  return {
    add,
    getById,
    getAll,
    updateById,
    deleteById,
    scale,
    restart,
    deploy,
  };
}
