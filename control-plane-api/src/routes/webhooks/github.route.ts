import express, { Request, Response } from "express";
import { useGitHubService } from "../../services/github.service";
import { useAppRepo } from "../../resources/app/app.repository";
import { useAppService } from "../../resources/app/app.service";
import { logger } from "../../utils";
import { GITHUB_WEBHOOK_SECRET } from "../../config";

const router = express.Router();

// Initialize GitHub service with webhook secret
const githubService = useGitHubService({
  webhookSecret: GITHUB_WEBHOOK_SECRET,
});

/**
 * GitHub Webhook Handler
 * POST /api/webhooks/github
 *
 * Handles GitHub events for auto-deploy functionality.
 * Requires X-Hub-Signature-256 header for signature validation.
 */
router.post("/github", express.raw({ type: "application/json" }), async (req: Request, res: Response) => {
  const event = req.headers["x-github-event"] as string;
  const signature = req.headers["x-hub-signature-256"] as string;
  const deliveryId = req.headers["x-github-delivery"] as string;

  // Get raw body for signature validation
  const rawBody = req.body.toString("utf8");

  // Validate signature if webhook secret is configured
  if (GITHUB_WEBHOOK_SECRET) {
    if (!signature || !githubService.validateWebhookSignature(rawBody, signature)) {
      logger.log({
        level: "warn",
        message: `[GitHub Webhook] Invalid signature for delivery ${deliveryId}`,
      });
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
  }

  // Parse the payload
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch (error) {
    logger.log({
      level: "error",
      message: `[GitHub Webhook] Invalid JSON payload: ${error}`,
    });
    res.status(400).json({ error: "Invalid JSON payload" });
    return;
  }

  logger.log({
    level: "info",
    message: `[GitHub Webhook] Received event: ${event} (delivery: ${deliveryId})`,
  });

  try {
    switch (event) {
      case "push":
        await handlePushEvent(payload);
        break;

      case "ping":
        // GitHub sends a ping event when webhook is first configured
        logger.log({
          level: "info",
          message: `[GitHub Webhook] Ping received from ${payload.repository?.full_name || "unknown"}`,
        });
        break;

      case "deployment":
        // Could handle deployment events from GitHub
        logger.log({
          level: "debug",
          message: `[GitHub Webhook] Deployment event received`,
        });
        break;

      default:
        logger.log({
          level: "debug",
          message: `[GitHub Webhook] Unhandled event type: ${event}`,
        });
    }

    res.status(200).json({ received: true });
  } catch (error) {
    logger.log({
      level: "error",
      message: `[GitHub Webhook] Error handling ${event}: ${error}`,
    });
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Handle push events - triggers auto-deploy for linked apps
 */
async function handlePushEvent(payload: any) {
  const pushInfo = githubService.parsePushEvent(payload);
  if (!pushInfo) {
    logger.log({
      level: "warn",
      message: "[GitHub Webhook] Could not parse push event",
    });
    return;
  }

  const { owner, repo, branch, sha, pusher, installationId } = pushInfo;

  logger.log({
    level: "info",
    message: `[GitHub Webhook] Push to ${owner}/${repo}@${branch} by ${pusher} (${sha.substring(0, 7)})`,
  });

  // Find apps linked to this repository
  const appRepo = useAppRepo();
  const appService = useAppService();

  try {
    // Query for apps with matching GitHub config
    const apps = await appRepo.getByGitHubRepo(owner, repo);

    if (apps.length === 0) {
      logger.log({
        level: "debug",
        message: `[GitHub Webhook] No apps linked to ${owner}/${repo}`,
      });
      return;
    }

    for (const app of apps) {
      // Check if this branch matches the app's configured branch
      const targetBranch = app.github?.branch || "main";
      if (branch !== targetBranch) {
        logger.log({
          level: "debug",
          message: `[GitHub Webhook] Branch ${branch} does not match ${targetBranch} for app ${app.name}`,
        });
        continue;
      }

      // Check if auto-deploy is enabled
      if (!app.github?.autoDeployOnPush) {
        logger.log({
          level: "debug",
          message: `[GitHub Webhook] Auto-deploy not enabled for app ${app.name}`,
        });
        continue;
      }

      // Check if app is in a deployable state
      if (app.status === "deploying") {
        logger.log({
          level: "info",
          message: `[GitHub Webhook] App ${app.name} is already deploying, skipping`,
        });
        continue;
      }

      logger.log({
        level: "info",
        message: `[GitHub Webhook] Triggering auto-deploy for ${app.name} (${sha.substring(0, 7)})`,
      });

      // Trigger deployment
      try {
        await appService.deploy(app._id!.toString(), {
          version: sha,
          // Could pass additional context like gitRef, pusher, etc.
        });

        logger.log({
          level: "info",
          message: `[GitHub Webhook] Auto-deploy triggered for ${app.name}`,
        });
      } catch (deployError) {
        logger.log({
          level: "error",
          message: `[GitHub Webhook] Failed to trigger deploy for ${app.name}: ${deployError}`,
        });
      }
    }
  } catch (error) {
    logger.log({
      level: "error",
      message: `[GitHub Webhook] Error finding apps for ${owner}/${repo}: ${error}`,
    });
  }
}

export default router;
