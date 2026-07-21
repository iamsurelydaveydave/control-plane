import { Request, Response, NextFunction } from "express";
import { useWebhookRepo } from "./webhook.repository";
import { useWebhookService } from "./webhook.service";
import { schemaWebhookCreate, schemaWebhookUpdate } from "./webhook.model";
import { BadRequestError } from "../../utils/error";

export function useWebhookController() {
  const repo = useWebhookRepo();
  const service = useWebhookService();

  /**
   * List all webhooks
   */
  async function list(req: Request, res: Response, next: NextFunction) {
    try {
      const page = Number(req.query.page) || 1;
      const type = req.query.type ? String(req.query.type) : undefined;
      const enabled = req.query.enabled !== undefined
        ? req.query.enabled === "true"
        : undefined;

      const result = await repo.getAll({ page, type, enabled });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get a single webhook by ID
   */
  async function getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const webhook = await repo.getById(id);
      res.json(webhook);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create a new webhook
   */
  async function create(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaWebhookCreate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const result = await service.create(value);
      res.status(201).json({ message: "Webhook created.", ...result });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update a webhook
   */
  async function update(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaWebhookUpdate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const id = String(req.params.id);
      await service.update(id, value);
      res.json({ message: "Webhook updated." });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete a webhook
   */
  async function remove(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      await service.remove(id);
      res.json({ message: "Webhook deleted." });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Test a webhook
   */
  async function test(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const result = await service.testWebhook(id);
      if (result.success) {
        res.json({ message: "Webhook test sent successfully." });
      } else {
        res.status(400).json({
          message: "Webhook test failed.",
          error: result.error,
        });
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * List available webhook events
   */
  async function listEvents(_req: Request, res: Response, next: NextFunction) {
    try {
      const events = service.getAvailableEvents();
      res.json({ events });
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
    test,
    listEvents,
  };
}
