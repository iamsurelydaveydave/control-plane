import { Request, Response, NextFunction } from "express";
import {
  schemaScheduledTaskCreate,
  schemaScheduledTaskUpdate,
  TScheduledTaskStatus,
} from "./scheduled-task.model";
import { useScheduledTaskRepo, useTaskHistoryRepo } from "./scheduled-task.repository";
import { useScheduledTaskService } from "./scheduled-task.service";
import { BadRequestError } from "../../utils/error";

export function useScheduledTaskController() {
  const taskRepo = useScheduledTaskRepo();
  const historyRepo = useTaskHistoryRepo();
  const taskService = useScheduledTaskService();

  /**
   * List all scheduled tasks with optional filters.
   * GET /api/scheduled-tasks
   */
  async function list(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit, status, type, search } = req.query;

      const data = await taskRepo.getAll({
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 20,
        status: status as TScheduledTaskStatus,
        type: type as string,
        search: search as string,
      });

      res.json(data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get a scheduled task by ID.
   * GET /api/scheduled-tasks/:id
   */
  async function getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const task = await taskRepo.getById(id);
      res.json(task);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create a new scheduled task.
   * POST /api/scheduled-tasks
   */
  async function create(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaScheduledTaskCreate.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
      });

      if (error) {
        next(new BadRequestError(error.details.map((d) => d.message).join(", ")));
        return;
      }

      const taskId = await taskService.create(value);
      res.status(201).json({ message: "Scheduled task created", taskId });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update a scheduled task.
   * PATCH /api/scheduled-tasks/:id
   */
  async function update(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      const { error, value } = schemaScheduledTaskUpdate.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
      });

      if (error) {
        next(new BadRequestError(error.details.map((d) => d.message).join(", ")));
        return;
      }

      await taskRepo.updateById(id, value);

      // If schedule changed, recalculate next run
      if (value.schedule || value.timezone) {
        const task = await taskRepo.getById(id);
        const nextRunAt = taskService.calculateNextRun(
          task.schedule,
          task.timezone
        );
        await taskRepo.updateNextRunAt(id, nextRunAt);
      }

      res.json({ message: "Scheduled task updated" });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete a scheduled task.
   * DELETE /api/scheduled-tasks/:id
   */
  async function remove(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      await taskService.remove(id);
      res.json({ message: "Scheduled task deleted" });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Run a task immediately.
   * POST /api/scheduled-tasks/:id/run
   */
  async function runNow(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const result = await taskService.runNow(id);
      res.json({
        message: result.success ? "Task completed successfully" : "Task failed",
        result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Pause a task.
   * POST /api/scheduled-tasks/:id/pause
   */
  async function pause(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      await taskService.pause(id);
      res.json({ message: "Task paused" });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Resume a paused task.
   * POST /api/scheduled-tasks/:id/resume
   */
  async function resume(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      await taskService.resume(id);
      res.json({ message: "Task resumed" });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get task run history.
   * GET /api/scheduled-tasks/:id/history
   */
  async function getHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { page, limit } = req.query;

      // Verify task exists
      await taskRepo.getById(id);

      const data = await historyRepo.getByTaskId(id, {
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 20,
      });

      res.json(data);
    } catch (error) {
      next(error);
    }
  }

  return {
    list,
    getById,
    create,
    update,
    remove,
    runNow,
    pause,
    resume,
    getHistory,
  };
}
