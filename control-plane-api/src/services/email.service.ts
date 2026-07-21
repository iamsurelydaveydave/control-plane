import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { logger } from "../utils";

// =============================================================================
// Types
// =============================================================================

export type TEmailProvider = "smtp" | "resend" | "sendgrid" | "console";

export interface TEmailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
}

export interface TEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface TAlertData {
  name: string;
  severity: string;
  message: string;
}

interface TDeploymentData {
  appName: string;
  version: string;
  status: string;
}

interface TInvitationData {
  email: string;
  orgName: string;
  inviteUrl: string;
}

// =============================================================================
// Configuration
// =============================================================================

function getConfig() {
  const provider = (process.env.EMAIL_PROVIDER || "console") as TEmailProvider;
  const defaultFrom = process.env.EMAIL_FROM || "Control Plane <noreply@controlplane.local>";

  return {
    provider,
    defaultFrom,
    // SMTP config
    smtp: {
      host: process.env.EMAIL_SMTP_HOST || "",
      port: parseInt(process.env.EMAIL_SMTP_PORT || "587", 10),
      user: process.env.EMAIL_SMTP_USER || "",
      pass: process.env.EMAIL_SMTP_PASS || "",
      secure: process.env.EMAIL_SMTP_SECURE === "true",
    },
    // API keys
    resendApiKey: process.env.RESEND_API_KEY || "",
    sendgridApiKey: process.env.SENDGRID_API_KEY || "",
  };
}

// =============================================================================
// Service
// =============================================================================

export function useEmailService() {
  const config = getConfig();
  let smtpTransporter: Transporter | null = null;

  /**
   * Get or create SMTP transporter (lazy initialization)
   */
  function getSmtpTransporter(): Transporter {
    if (smtpTransporter) return smtpTransporter;

    smtpTransporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user
        ? {
            user: config.smtp.user,
            pass: config.smtp.pass,
          }
        : undefined,
    });

    return smtpTransporter;
  }

  /**
   * Send email via SMTP using nodemailer
   */
  async function sendViaSMTP(options: TEmailOptions): Promise<TEmailResult> {
    const transporter = getSmtpTransporter();

    try {
      const result = await transporter.sendMail({
        from: options.from || config.defaultFrom,
        to: Array.isArray(options.to) ? options.to.join(", ") : options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });

      logger.log({
        level: "info",
        message: `[Email] Sent via SMTP: ${options.subject} to ${options.to}`,
      });

      return { success: true, messageId: result.messageId };
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `[Email] SMTP send failed: ${error.message}`,
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Send email via Resend API
   * Docs: https://resend.com/docs/api-reference/emails/send-email
   */
  async function sendViaResend(options: TEmailOptions): Promise<TEmailResult> {
    if (!config.resendApiKey) {
      return { success: false, error: "RESEND_API_KEY not configured" };
    }

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: options.from || config.defaultFrom,
          to: Array.isArray(options.to) ? options.to : [options.to],
          subject: options.subject,
          html: options.html,
          text: options.text,
        }),
      });

      const data = (await response.json()) as { id?: string; message?: string };

      if (!response.ok) {
        throw new Error(data.message || `HTTP ${response.status}`);
      }

      logger.log({
        level: "info",
        message: `[Email] Sent via Resend: ${options.subject} to ${options.to}`,
      });

      return { success: true, messageId: data.id };
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `[Email] Resend send failed: ${error.message}`,
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Send email via SendGrid API
   * Docs: https://docs.sendgrid.com/api-reference/mail-send/mail-send
   */
  async function sendViaSendGrid(options: TEmailOptions): Promise<TEmailResult> {
    if (!config.sendgridApiKey) {
      return { success: false, error: "SENDGRID_API_KEY not configured" };
    }

    const toAddresses = Array.isArray(options.to) ? options.to : [options.to];

    try {
      const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.sendgridApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [
            {
              to: toAddresses.map((email) => ({ email })),
            },
          ],
          from: { email: extractEmail(options.from || config.defaultFrom) },
          subject: options.subject,
          content: [
            ...(options.text ? [{ type: "text/plain", value: options.text }] : []),
            ...(options.html ? [{ type: "text/html", value: options.html }] : []),
          ],
        }),
      });

      // SendGrid returns 202 Accepted on success with no body
      if (!response.ok) {
        const data = (await response.json()) as { errors?: Array<{ message: string }> };
        const errorMsg = data.errors?.map((e) => e.message).join(", ") || `HTTP ${response.status}`;
        throw new Error(errorMsg);
      }

      // SendGrid doesn't return messageId in the response
      const messageId = response.headers.get("x-message-id") || undefined;

      logger.log({
        level: "info",
        message: `[Email] Sent via SendGrid: ${options.subject} to ${options.to}`,
      });

      return { success: true, messageId };
    } catch (error: any) {
      logger.log({
        level: "error",
        message: `[Email] SendGrid send failed: ${error.message}`,
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Console provider - just logs the email (for development)
   */
  async function sendViaConsole(options: TEmailOptions): Promise<TEmailResult> {
    const messageId = `console-${Date.now()}`;

    logger.log({
      level: "info",
      message: `[Email] Console mode - would send email:
  To: ${Array.isArray(options.to) ? options.to.join(", ") : options.to}
  From: ${options.from || config.defaultFrom}
  Subject: ${options.subject}
  Text: ${options.text || "(no text)"}
  HTML: ${options.html ? "(HTML content present)" : "(no HTML)"}`,
    });

    return { success: true, messageId };
  }

  /**
   * Send an email using the configured provider
   */
  async function send(options: TEmailOptions): Promise<TEmailResult> {
    // Validate required fields
    if (!options.to || (Array.isArray(options.to) && options.to.length === 0)) {
      return { success: false, error: "Recipient (to) is required" };
    }
    if (!options.subject) {
      return { success: false, error: "Subject is required" };
    }
    if (!options.html && !options.text) {
      return { success: false, error: "Either html or text content is required" };
    }

    switch (config.provider) {
      case "smtp":
        return sendViaSMTP(options);
      case "resend":
        return sendViaResend(options);
      case "sendgrid":
        return sendViaSendGrid(options);
      case "console":
      default:
        return sendViaConsole(options);
    }
  }

  // ===========================================================================
  // Pre-built Templates
  // ===========================================================================

  /**
   * Send an alert notification email
   */
  async function sendAlertNotification(alert: TAlertData, to: string): Promise<TEmailResult> {
    const severityColors: Record<string, string> = {
      critical: "#dc3545",
      warning: "#ffc107",
      info: "#17a2b8",
    };
    const color = severityColors[alert.severity.toLowerCase()] || "#6c757d";

    const html = `
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
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <span class="severity">${escapeHtml(alert.severity)}</span>
      <h2 style="margin: 10px 0 0 0;">${escapeHtml(alert.name)}</h2>
    </div>
    <div class="content">
      <p>${escapeHtml(alert.message)}</p>
      <p style="color: #666; font-size: 14px;">
        Triggered at: ${new Date().toISOString()}
      </p>
    </div>
    <div class="footer">
      Sent by Control Plane
    </div>
  </div>
</body>
</html>`;

    const text = `[${alert.severity.toUpperCase()}] ${alert.name}

${alert.message}

Triggered at: ${new Date().toISOString()}

---
Sent by Control Plane`;

    return send({
      to,
      subject: `[${alert.severity.toUpperCase()}] ${alert.name}`,
      html,
      text,
    });
  }

  /**
   * Send a deployment notification email
   */
  async function sendDeploymentNotification(
    deployment: TDeploymentData,
    to: string
  ): Promise<TEmailResult> {
    const statusColors: Record<string, string> = {
      success: "#28a745",
      failed: "#dc3545",
      pending: "#ffc107",
      running: "#17a2b8",
    };
    const color = statusColors[deployment.status.toLowerCase()] || "#6c757d";
    const statusEmoji = deployment.status.toLowerCase() === "success" ? "✅" : deployment.status.toLowerCase() === "failed" ? "❌" : "🔄";

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: ${color}; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f9f9f9; padding: 20px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 8px 8px; }
    .status { display: inline-block; background: rgba(255,255,255,0.2); padding: 4px 12px; border-radius: 4px; font-size: 12px; text-transform: uppercase; }
    .detail { margin: 10px 0; }
    .label { color: #666; font-size: 14px; }
    .value { font-weight: 500; }
    .footer { margin-top: 20px; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <span class="status">${escapeHtml(deployment.status)}</span>
      <h2 style="margin: 10px 0 0 0;">Deployment ${statusEmoji}</h2>
    </div>
    <div class="content">
      <div class="detail">
        <span class="label">Application:</span>
        <span class="value">${escapeHtml(deployment.appName)}</span>
      </div>
      <div class="detail">
        <span class="label">Version:</span>
        <span class="value">${escapeHtml(deployment.version)}</span>
      </div>
      <div class="detail">
        <span class="label">Status:</span>
        <span class="value">${escapeHtml(deployment.status)}</span>
      </div>
      <p style="color: #666; font-size: 14px; margin-top: 20px;">
        Deployment time: ${new Date().toISOString()}
      </p>
    </div>
    <div class="footer">
      Sent by Control Plane
    </div>
  </div>
</body>
</html>`;

    const text = `Deployment ${statusEmoji} - ${deployment.appName}

Application: ${deployment.appName}
Version: ${deployment.version}
Status: ${deployment.status}

Deployment time: ${new Date().toISOString()}

---
Sent by Control Plane`;

    return send({
      to,
      subject: `[Deployment ${deployment.status.toUpperCase()}] ${deployment.appName} v${deployment.version}`,
      html,
      text,
    });
  }

  /**
   * Send an invitation email
   */
  async function sendInvitation(invitation: TInvitationData): Promise<TEmailResult> {
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #4f46e5; color: white; padding: 30px; border-radius: 8px 8px 0 0; text-align: center; }
    .content { background: #f9f9f9; padding: 30px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 8px 8px; text-align: center; }
    .button { display: inline-block; background: #4f46e5; color: white; padding: 14px 28px; border-radius: 6px; text-decoration: none; font-weight: 500; margin: 20px 0; }
    .button:hover { background: #4338ca; }
    .footer { margin-top: 20px; font-size: 12px; color: #666; }
    .link { word-break: break-all; color: #4f46e5; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">You're Invited!</h1>
    </div>
    <div class="content">
      <p>You've been invited to join <strong>${escapeHtml(invitation.orgName)}</strong> on Control Plane.</p>
      <a href="${escapeHtml(invitation.inviteUrl)}" class="button">Accept Invitation</a>
      <p style="color: #666; font-size: 14px;">Or copy and paste this link:</p>
      <p class="link">${escapeHtml(invitation.inviteUrl)}</p>
    </div>
    <div class="footer">
      <p>If you didn't expect this invitation, you can safely ignore this email.</p>
      <p>Sent by Control Plane</p>
    </div>
  </div>
</body>
</html>`;

    const text = `You're Invited!

You've been invited to join ${invitation.orgName} on Control Plane.

Accept the invitation by visiting:
${invitation.inviteUrl}

If you didn't expect this invitation, you can safely ignore this email.

---
Sent by Control Plane`;

    return send({
      to: invitation.email,
      subject: `You're invited to join ${invitation.orgName} on Control Plane`,
      html,
      text,
    });
  }

  return {
    send,
    sendAlertNotification,
    sendDeploymentNotification,
    sendInvitation,
  };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Extract email address from "Name <email@example.com>" format
 */
function extractEmail(fromString: string): string {
  const match = fromString.match(/<(.+)>/);
  return match ? match[1] : fromString;
}

/**
 * Escape HTML to prevent XSS
 */
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
