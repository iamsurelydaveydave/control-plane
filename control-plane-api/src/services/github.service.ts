import crypto from "crypto";
import { logger } from "../utils";

// =============================================================================
// Types
// =============================================================================

export type TGitHubDeploymentState =
  | "pending"
  | "success"
  | "failure"
  | "error"
  | "inactive"
  | "in_progress"
  | "queued";

export interface TGitHubConfig {
  appId?: string;
  privateKey?: string;
  webhookSecret?: string;
  installationId?: string;
}

export interface TSetDeploymentStatusParams {
  owner: string;
  repo: string;
  sha: string;
  state: TGitHubDeploymentState;
  environment: string;
  environmentUrl?: string;
  description?: string;
  deploymentId?: number;
}

export interface TCreateDeploymentParams {
  owner: string;
  repo: string;
  ref: string;
  environment: string;
  description?: string;
  autoMerge?: boolean;
}

// =============================================================================
// Service
// =============================================================================

export function useGitHubService(config?: TGitHubConfig) {
  const GITHUB_API = "https://api.github.com";

  /**
   * Get an installation access token for the GitHub App
   */
  async function getInstallationToken(installationId: string): Promise<string | null> {
    if (!config?.appId || !config?.privateKey) {
      logger.log({
        level: "debug",
        message: "[GitHub] App credentials not configured",
      });
      return null;
    }

    try {
      // Generate JWT for GitHub App
      const jwt = generateAppJWT(config.appId, config.privateKey);

      const response = await fetch(
        `${GITHUB_API}/app/installations/${installationId}/access_tokens`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${jwt}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        }
      );

      if (!response.ok) {
        const error = await response.text();
        logger.log({
          level: "error",
          message: `[GitHub] Failed to get installation token: ${error}`,
        });
        return null;
      }

      const data = await response.json() as { token: string };
      return data.token;
    } catch (error) {
      logger.log({
        level: "error",
        message: `[GitHub] Error getting installation token: ${error}`,
      });
      return null;
    }
  }

  /**
   * Create a GitHub deployment
   */
  async function createDeployment(
    params: TCreateDeploymentParams,
    token: string
  ): Promise<number | null> {
    const { owner, repo, ref, environment, description, autoMerge = false } = params;

    try {
      const response = await fetch(
        `${GITHUB_API}/repos/${owner}/${repo}/deployments`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({
            ref,
            environment,
            description: description || `Deployment to ${environment}`,
            auto_merge: autoMerge,
            required_contexts: [], // Skip status checks for now
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        logger.log({
          level: "error",
          message: `[GitHub] Failed to create deployment: ${error}`,
        });
        return null;
      }

      const data = await response.json() as { id: number };
      logger.log({
        level: "info",
        message: `[GitHub] Created deployment ${data.id} for ${owner}/${repo}@${ref}`,
      });
      return data.id;
    } catch (error) {
      logger.log({
        level: "error",
        message: `[GitHub] Error creating deployment: ${error}`,
      });
      return null;
    }
  }

  /**
   * Update deployment status on GitHub
   */
  async function setDeploymentStatus(
    params: TSetDeploymentStatusParams,
    token: string
  ): Promise<boolean> {
    const {
      owner,
      repo,
      sha,
      state,
      environment,
      environmentUrl,
      description,
      deploymentId,
    } = params;

    try {
      // If we have a deployment ID, update that deployment's status
      if (deploymentId) {
        const response = await fetch(
          `${GITHUB_API}/repos/${owner}/${repo}/deployments/${deploymentId}/statuses`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
            body: JSON.stringify({
              state,
              environment,
              environment_url: environmentUrl,
              description: description || getDefaultDescription(state),
            }),
          }
        );

        if (!response.ok) {
          const error = await response.text();
          logger.log({
            level: "error",
            message: `[GitHub] Failed to set deployment status: ${error}`,
          });
          return false;
        }

        logger.log({
          level: "info",
          message: `[GitHub] Set deployment ${deploymentId} status to ${state}`,
        });
        return true;
      }

      // Otherwise, create a commit status
      const response = await fetch(
        `${GITHUB_API}/repos/${owner}/${repo}/statuses/${sha}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({
            state: mapToCommitState(state),
            context: `deployment/${environment}`,
            target_url: environmentUrl,
            description: description || getDefaultDescription(state),
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        logger.log({
          level: "error",
          message: `[GitHub] Failed to set commit status: ${error}`,
        });
        return false;
      }

      logger.log({
        level: "info",
        message: `[GitHub] Set commit status for ${sha} to ${state}`,
      });
      return true;
    } catch (error) {
      logger.log({
        level: "error",
        message: `[GitHub] Error setting deployment status: ${error}`,
      });
      return false;
    }
  }

  /**
   * Validate GitHub webhook signature
   */
  function validateWebhookSignature(
    payload: string,
    signature: string
  ): boolean {
    if (!config?.webhookSecret) {
      logger.log({
        level: "warn",
        message: "[GitHub] Webhook secret not configured",
      });
      return false;
    }

    const hmac = crypto.createHmac("sha256", config.webhookSecret);
    const digest = `sha256=${hmac.update(payload).digest("hex")}`;

    return crypto.timingSafeEqual(
      Buffer.from(digest),
      Buffer.from(signature)
    );
  }

  /**
   * Parse push event to extract deployment info
   */
  function parsePushEvent(payload: any): {
    owner: string;
    repo: string;
    ref: string;
    sha: string;
    branch: string;
    pusher: string;
    installationId?: string;
  } | null {
    try {
      const fullName = payload.repository?.full_name;
      if (!fullName) return null;

      const [owner, repo] = fullName.split("/");
      const ref = payload.ref;
      const sha = payload.after;
      const branch = ref.replace("refs/heads/", "");
      const pusher = payload.pusher?.name || "unknown";
      const installationId = payload.installation?.id?.toString();

      return { owner, repo, ref, sha, branch, pusher, installationId };
    } catch {
      return null;
    }
  }

  return {
    getInstallationToken,
    createDeployment,
    setDeploymentStatus,
    validateWebhookSignature,
    parsePushEvent,
  };
}

// =============================================================================
// Helpers
// =============================================================================

function generateAppJWT(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const payload = {
    iat: now - 60, // Issued 60 seconds ago to account for clock drift
    exp: now + 10 * 60, // Expires in 10 minutes
    iss: appId,
  };

  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(payload));

  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(signatureInput)
    .sign(privateKey, "base64url");

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function base64urlEncode(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function getDefaultDescription(state: TGitHubDeploymentState): string {
  switch (state) {
    case "pending":
      return "Deployment pending";
    case "in_progress":
      return "Deployment in progress";
    case "queued":
      return "Deployment queued";
    case "success":
      return "Deployment successful";
    case "failure":
      return "Deployment failed";
    case "error":
      return "Deployment error";
    case "inactive":
      return "Deployment inactive";
    default:
      return "Deployment status update";
  }
}

function mapToCommitState(
  state: TGitHubDeploymentState
): "error" | "failure" | "pending" | "success" {
  switch (state) {
    case "success":
      return "success";
    case "failure":
      return "failure";
    case "error":
      return "error";
    default:
      return "pending";
  }
}
