import crypto from "crypto";
import { useWebhookRepo } from "./webhook.repository";
import {
  TWebhook,
  TWebhookEvent,
  TWebhookInput,
  TWebhookUpdate,
  webhookEvents,
  modelWebhook,
} from "./webhook.model";
import { BadRequestError, NotFoundError } from "../../utils/error";
import { logger } from "../../utils";
import { useEmailService } from "../../services/email.service";

// =============================================================================
// Payload Types for different webhook types
// =============================================================================

interface SlackAttachmentField {
  title: string;
  value: string;
  short?: boolean;
}

interface SlackAttachment {
  color: string;
  fields: SlackAttachmentField[];
  footer?: string;
  ts?: number;
}

interface SlackMessage {
  text: string;
  attachments?: SlackAttachment[];
}

interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields: DiscordEmbedField[];
  footer?: { text: string };
  timestamp?: string;
}

interface DiscordMessage {
  content?: string;
  embeds: DiscordEmbed[];
}

interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

interface CustomPayload {
  event: TWebhookEvent;
  timestamp: string;
  data: Record<string, any>;
  signature?: string;
}

// =============================================================================
// Event Color Mapping
// =============================================================================

const eventColors: Record<TWebhookEvent, { slack: string; discord: number; severity: string }> = {
  // App events - green for success, red for failure
  "app.deployed": { slack: "#36a64f", discord: 3066993, severity: "success" },
  "app.failed": { slack: "#dc3545", discord: 15158332, severity: "error" },
  "app.stopped": { slack: "#ffc107", discord: 16776960, severity: "warning" },
  "app.started": { slack: "#36a64f", discord: 3066993, severity: "success" },
  // Database events
  "database.created": { slack: "#36a64f", discord: 3066993, severity: "success" },
  "database.failed": { slack: "#dc3545", discord: 15158332, severity: "error" },
  "database.deleted": { slack: "#ffc107", discord: 16776960, severity: "warning" },
  // Alert events
  "alert.created": { slack: "#dc3545", discord: 15158332, severity: "error" },
  "alert.resolved": { slack: "#36a64f", discord: 3066993, severity: "success" },
  // Node events
  "node.offline": { slack: "#dc3545", discord: 15158332, severity: "error" },
  "node.online": { slack: "#36a64f", discord: 3066993, severity: "success" },
  // Backup events
  "backup.completed": { slack: "#36a64f", discord: 3066993, severity: "success" },
  "backup.failed": { slack: "#dc3545", discord: 15158332, severity: "error" },
};

// =============================================================================
// Event Title Mapping
// =============================================================================

const eventTitles: Record<TWebhookEvent, string> = {
  "app.deployed": "App Deployed Successfully",
  "app.failed": "App Deployment Failed",
  "app.stopped": "App Stopped",
  "app.started": "App Started",
  "database.created": "Database Created",
  "database.failed": "Database Creation Failed",
  "database.deleted": "Database Deleted",
  "alert.created": "Alert Created",
  "alert.resolved": "Alert Resolved",
  "node.offline": "Node Offline",
  "node.online": "Node Online",
  "backup.completed": "Backup Completed",
  "backup.failed": "Backup Failed",
};

// =============================================================================
// Service
// =============================================================================

export function useWebhookService() {
  const repo = useWebhookRepo();
  const emailService = useEmailService();

  /**
   * Create a new webhook
   */
  async function create(data: TWebhookInput): Promise<{ webhookId: string }> {
    // Check for duplicate name
    const existing = await repo.getByName(data.name);
    if (existing) {
      throw new BadRequestError(`Webhook with name '${data.name}' already exists.`);
    }

    const webhook = modelWebhook(data);
    const webhookId = await repo.add(webhook);

    logger.log({
      level: "info",
      message: `[Webhook] Created webhook: ${data.name} (${data.type})`,
    });

    return { webhookId };
  }

  /**
   * Update a webhook
   */
  async function update(id: string, data: TWebhookUpdate): Promise<void> {
    // Check name uniqueness if changing name
    if (data.name) {
      const existing = await repo.getByName(data.name);
      if (existing && existing._id?.toString() !== id) {
        throw new BadRequestError(`Webhook with name '${data.name}' already exists.`);
      }
    }

    await repo.updateById(id, data);

    logger.log({
      level: "info",
      message: `[Webhook] Updated webhook: ${id}`,
    });
  }

  /**
   * Delete a webhook
   */
  async function remove(id: string): Promise<void> {
    await repo.deleteById(id);

    logger.log({
      level: "info",
      message: `[Webhook] Deleted webhook: ${id}`,
    });
  }

  /**
   * Trigger webhooks for an event
   */
  async function trigger(event: TWebhookEvent, payload: Record<string, any>): Promise<void> {
    try {
      const webhooks = await repo.getByEvent(event);

      if (webhooks.length === 0) {
        logger.log({
          level: "debug",
          message: `[Webhook] No webhooks subscribed to event: ${event}`,
        });
        return;
      }

      logger.log({
        level: "info",
        message: `[Webhook] Triggering ${webhooks.length} webhook(s) for event: ${event}`,
      });

      // Fire webhooks in parallel but don't await - fire and forget
      for (const webhook of webhooks) {
        sendWebhook(webhook, event, payload).catch((error) => {
          logger.log({
            level: "error",
            message: `[Webhook] Failed to send webhook ${webhook.name}: ${error.message}`,
          });
        });
      }
    } catch (error) {
      logger.log({
        level: "error",
        message: `[Webhook] Error triggering webhooks for event ${event}: ${error}`,
      });
    }
  }

  /**
   * Send to a specific webhook
   */
  async function sendWebhook(
    webhook: TWebhook,
    event: TWebhookEvent,
    payload: Record<string, any>
  ): Promise<boolean> {
    const webhookId = webhook._id?.toString();
    if (!webhookId) return false;

    try {
      let formattedPayload: any;
      let contentType = "application/json";

      switch (webhook.type) {
        case "slack":
          formattedPayload = formatSlackPayload(event, payload);
          break;
        case "discord":
          formattedPayload = formatDiscordPayload(event, payload);
          break;
        case "email": {
            formattedPayload = formatEmailPayload(event, payload, webhook.url);
            // Send email via the email service
            const emailResult = await emailService.send({
              to: webhook.url, // For email webhooks, URL is the email address
              subject: formattedPayload.subject,
              text: formattedPayload.body,
              html: formatEmailHtml(event, payload),
            });

            if (!emailResult.success) {
              throw new Error(emailResult.error || "Email send failed");
            }

            logger.log({
              level: "info",
              message: `[Webhook] Email sent to ${webhook.url}: ${formattedPayload.subject}`,
            });
            await repo.updateLastTrigger(webhookId, "success");
            return true;
          }
        case "custom":
        default:
          formattedPayload = formatCustomPayload(event, payload, webhook.secret);
          break;
      }

      const headers: Record<string, string> = {
        "Content-Type": contentType,
        "User-Agent": "ControlPlane-Webhook/1.0",
        ...webhook.headers,
      };

      // Add signature header for custom webhooks with secret
      if (webhook.type === "custom" && webhook.secret) {
        const signature = createSignature(JSON.stringify(formattedPayload), webhook.secret);
        headers["X-Webhook-Signature"] = signature;
      }

      const response = await fetch(webhook.url, {
        method: "POST",
        headers,
        body: JSON.stringify(formattedPayload),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      await repo.updateLastTrigger(webhookId, "success");

      logger.log({
        level: "info",
        message: `[Webhook] Successfully sent webhook: ${webhook.name} (${event})`,
      });

      return true;
    } catch (error: any) {
      const errorMessage = error.message || "Unknown error";
      await repo.updateLastTrigger(webhookId, "failed", errorMessage);

      logger.log({
        level: "error",
        message: `[Webhook] Failed to send webhook ${webhook.name}: ${errorMessage}`,
      });

      return false;
    }
  }

  /**
   * Test a webhook
   */
  async function testWebhook(id: string): Promise<{ success: boolean; error?: string }> {
    const webhook = await repo.getById(id);

    const testPayload = {
      test: true,
      message: "This is a test webhook from Control Plane",
      timestamp: new Date().toISOString(),
    };

    // Use a generic test event
    const testEvent: TWebhookEvent = webhook.events[0] || "app.deployed";

    try {
      const success = await sendWebhook(webhook, testEvent, testPayload);
      return { success };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get available webhook events
   */
  function getAvailableEvents(): { event: TWebhookEvent; description: string }[] {
    return webhookEvents.map((event) => ({
      event,
      description: eventTitles[event],
    }));
  }

  return {
    create,
    update,
    remove,
    trigger,
    testWebhook,
    getAvailableEvents,
  };
}

// =============================================================================
// Payload Formatters
// =============================================================================

function formatSlackPayload(event: TWebhookEvent, payload: Record<string, any>): SlackMessage {
  const color = eventColors[event]?.slack || "#6c757d";
  const title = eventTitles[event] || event;

  const fields: SlackAttachmentField[] = [];

  // Build fields from payload
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined && value !== null && key !== "test") {
      const formattedKey = key
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (str) => str.toUpperCase())
        .replace(/Id$/, " ID");

      fields.push({
        title: formattedKey,
        value: formatValue(value),
        short: String(value).length < 30,
      });
    }
  }

  return {
    text: title,
    attachments: [
      {
        color,
        fields,
        footer: "Control Plane",
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  };
}

function formatDiscordPayload(event: TWebhookEvent, payload: Record<string, any>): DiscordMessage {
  const color = eventColors[event]?.discord || 9807270;
  const title = eventTitles[event] || event;

  const fields: DiscordEmbedField[] = [];

  // Build fields from payload
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined && value !== null && key !== "test") {
      const formattedKey = key
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (str) => str.toUpperCase())
        .replace(/Id$/, " ID");

      fields.push({
        name: formattedKey,
        value: formatValue(value),
        inline: String(value).length < 30,
      });
    }
  }

  return {
    embeds: [
      {
        title,
        color,
        fields,
        footer: { text: "Control Plane" },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function formatEmailPayload(
  event: TWebhookEvent,
  payload: Record<string, any>,
  to: string
): EmailMessage {
  const title = eventTitles[event] || event;
  const severity = eventColors[event]?.severity || "info";

  let body = `[${severity.toUpperCase()}] ${title}\n\n`;
  body += `Event: ${event}\n`;
  body += `Time: ${new Date().toISOString()}\n\n`;
  body += "Details:\n";

  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined && value !== null && key !== "test") {
      const formattedKey = key
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (str) => str.toUpperCase())
        .replace(/Id$/, " ID");

      body += `  ${formattedKey}: ${formatValue(value)}\n`;
    }
  }

  body += "\n---\nSent by Control Plane";

  return {
    to,
    subject: `[Control Plane] ${title}`,
    body,
  };
}

function formatCustomPayload(
  event: TWebhookEvent,
  payload: Record<string, any>,
  secret?: string
): CustomPayload {
  const customPayload: CustomPayload = {
    event,
    timestamp: new Date().toISOString(),
    data: payload,
  };

  return customPayload;
}

// =============================================================================
// Helpers
// =============================================================================

function formatValue(value: any): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function createSignature(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function escapeHtml(text: string): string {
  const htmlEscapes: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return text.replace(/[&<>"']/g, (char) => htmlEscapes[char] || char);
}

function formatEmailHtml(event: TWebhookEvent, payload: Record<string, any>): string {
  const title = eventTitles[event] || event;
  const color = eventColors[event]?.slack || "#6c757d";
  const severity = eventColors[event]?.severity || "info";

  // Build details rows
  let detailsHtml = "";
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined && value !== null && key !== "test") {
      const formattedKey = key
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (str) => str.toUpperCase())
        .replace(/Id$/, " ID");

      detailsHtml += `
        <tr>
          <td style="padding: 8px 12px; color: #666; font-size: 14px;">${escapeHtml(formattedKey)}</td>
          <td style="padding: 8px 12px; font-weight: 500;">${escapeHtml(formatValue(value))}</td>
        </tr>`;
    }
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: ${color}; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f9f9f9; padding: 20px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 8px 8px; }
    .severity { display: inline-block; background: rgba(255,255,255,0.2); padding: 4px 12px; border-radius: 4px; font-size: 12px; text-transform: uppercase; }
    .footer { margin-top: 20px; font-size: 12px; color: #666; }
    table { width: 100%; border-collapse: collapse; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <span class="severity">${escapeHtml(severity)}</span>
      <h2 style="margin: 10px 0 0 0;">${escapeHtml(title)}</h2>
    </div>
    <div class="content">
      <p style="color: #666; font-size: 14px;">Event: <strong>${escapeHtml(event)}</strong></p>
      <table>
        <tbody>
          ${detailsHtml}
        </tbody>
      </table>
      <p style="color: #666; font-size: 14px; margin-top: 20px;">
        Triggered at: ${new Date().toISOString()}
      </p>
    </div>
    <div class="footer">
      Sent by Control Plane
    </div>
  </div>
</body>
</html>`;
}
