import { Request, Response, NextFunction } from "express";
import { useServerRepo } from "./server.repository";
import { schemaServerCreate, schemaServerUpdate } from "./server.model";
import { BadRequestError } from "../../utils";

export function useServerController() {
  const repo = useServerRepo();

  async function add(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaServerCreate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const id = await repo.add(value);
      res.status(201).json({ message: "Server created", serverId: id });
    } catch (error) {
      next(error);
    }
  }

  async function getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const server = await repo.getById(id);

      if (!server) {
        next(new BadRequestError("Server not found"));
        return;
      }

      res.json({ server });
    } catch (error) {
      next(error);
    }
  }

  async function getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const { search, page, limit, status, tag } = req.query;

      const data = await repo.getAll({
        search: search as string,
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 10,
        status: status as any,
        tag: tag as string,
      });

      res.json(data);
    } catch (error) {
      next(error);
    }
  }

  async function updateById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { error, value } = schemaServerUpdate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      await repo.updateById(id, value);
      res.json({ message: "Server updated" });
    } catch (error) {
      next(error);
    }
  }

  async function deleteById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      await repo.deleteById(id);
      res.json({ message: "Server deleted" });
    } catch (error) {
      next(error);
    }
  }

  async function getStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const server = await repo.getById(id);

      if (!server) {
        next(new BadRequestError("Server not found"));
        return;
      }

      res.json({
        status: server.status,
        lastHealthCheck: server.lastHealthCheck,
        resources: server.resources,
      });
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
    getStatus,
  };
}
