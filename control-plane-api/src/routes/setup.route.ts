import express from "express";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { homedir } from "os";
import { join } from "path";
import * as k8s from "@kubernetes/client-node";
import { useUserRepo, useSettingsRepo } from "../resources";
import { requireAuth, rateLimitAuth, logger } from "../utils";

const router = express.Router();

// SSH key paths
const SSH_DIR = process.env.SSH_DIR || join(homedir(), ".ssh");
const PRIVATE_KEY_PATH = join(SSH_DIR, "id_ed25519");
const PUBLIC_KEY_PATH = join(SSH_DIR, "id_ed25519.pub");

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Ensure SSH keypair exists, generating one if needed.
 */
function ensureSSHKey(): { publicKey: string; privateKeyPath: string } {
  // Create .ssh directory if it doesn't exist
  if (!existsSync(SSH_DIR)) {
    mkdirSync(SSH_DIR, { mode: 0o700, recursive: true });
  }

  // Generate keypair if it doesn't exist
  if (!existsSync(PRIVATE_KEY_PATH)) {
    execSync(
      `ssh-keygen -t ed25519 -f "${PRIVATE_KEY_PATH}" -N "" -C "control-plane"`,
      { stdio: "pipe" }
    );
  }

  const publicKey = readFileSync(PUBLIC_KEY_PATH, "utf-8").trim();
  return { publicKey, privateKeyPath: PRIVATE_KEY_PATH };
}

/**
 * Check if setup mode is enabled.
 * Setup mode is enabled if:
 * 1. CONTROLPLANE_SETUP=enabled, OR
 * 2. No users exist in the database yet
 */
async function isSetupEnabled(): Promise<boolean> {
  if (process.env.CONTROLPLANE_SETUP === "enabled") {
    return true;
  }
  
  try {
    const userRepo = useUserRepo();
    const count = await userRepo.count();
    return count === 0;
  } catch {
    // If we can't connect to DB, allow setup
    return true;
  }
}

/**
 * Validate a kubeconfig and context by attempting to connect to the cluster.
 */
async function validateKubeconfigInternal(
  kubeconfigYaml: string,
  context: string
): Promise<{ valid: boolean; error?: string; clusterInfo?: { version: string; platform: string } }> {
  try {
    const kc = new k8s.KubeConfig();
    
    // Load from YAML string
    kc.loadFromString(kubeconfigYaml);
    
    // Set the context
    kc.setCurrentContext(context);
    
    // Try to connect
    const versionApi = kc.makeApiClient(k8s.VersionApi);
    const response = await versionApi.getCode();
    
    return {
      valid: true,
      clusterInfo: {
        version: response.body.gitVersion,
        platform: response.body.platform,
      },
    };
  } catch (error: any) {
    logger.log({
      level: "warn",
      message: `Kubeconfig validation failed: ${error.message}`,
    });
    return {
      valid: false,
      error: error.message || "Failed to connect to cluster",
    };
  }
}

/**
 * Check if a Kubernetes component is installed by checking its namespace or deployment.
 */
async function checkComponent(
  component: "operator" | "ingress" | "metrics" | "cert-manager"
): Promise<{ status: "ok" | "error"; reason?: string }> {
  try {
    const kc = new k8s.KubeConfig();
    
    // Load kubeconfig from various sources
    const kubeconfigBase64 = process.env.KUBECONFIG_BASE64;
    if (kubeconfigBase64) {
      const kubeconfigYaml = Buffer.from(kubeconfigBase64, "base64").toString("utf-8");
      kc.loadFromString(kubeconfigYaml);
      const context = process.env.CONTROLPLANE_CONTEXT;
      if (context) {
        kc.setCurrentContext(context);
      }
    } else {
      try {
        kc.loadFromCluster();
      } catch {
        const kubeconfigPath = process.env.KUBECONFIG || `${process.env.HOME}/.kube/config`;
        try {
          kc.loadFromFile(kubeconfigPath);
        } catch {
          kc.loadFromFile("/etc/rancher/k3s/k3s.yaml");
        }
      }
    }
    
    const coreApi = kc.makeApiClient(k8s.CoreV1Api);
    const appsApi = kc.makeApiClient(k8s.AppsV1Api);
    
    switch (component) {
      case "operator":
        // Check for controlplane operator namespace
        try {
          await coreApi.readNamespace("controlplane-system");
          return { status: "ok" };
        } catch {
          // Also check for kubero-operator-system (if using Kubero operator)
          try {
            await coreApi.readNamespace("kubero-operator-system");
            return { status: "ok" };
          } catch {
            return { status: "error", reason: "Operator namespace not found" };
          }
        }
        
      case "ingress":
        // Check for ingress-nginx namespace
        try {
          await coreApi.readNamespace("ingress-nginx");
          return { status: "ok" };
        } catch {
          // Also check for traefik (k3s default)
          try {
            await coreApi.readNamespace("traefik");
            return { status: "ok" };
          } catch {
            // Check for traefik in kube-system (k3s default location)
            try {
              await appsApi.readNamespacedDeployment("traefik", "kube-system");
              return { status: "ok" };
            } catch {
              return { status: "error", reason: "Ingress controller not found" };
            }
          }
        }
        
      case "metrics":
        // Check for metrics-server deployment in kube-system
        try {
          await appsApi.readNamespacedDeployment("metrics-server", "kube-system");
          return { status: "ok" };
        } catch {
          return { status: "error", reason: "Metrics server not found" };
        }
        
      case "cert-manager":
        // Check for cert-manager namespace
        try {
          await coreApi.readNamespace("cert-manager");
          return { status: "ok" };
        } catch {
          return { status: "error", reason: "cert-manager not found" };
        }
        
      default:
        return { status: "error", reason: "Unknown component" };
    }
  } catch (error: any) {
    return { status: "error", reason: error.message };
  }
}

// =============================================================================
// Routes
// =============================================================================

// Check if the platform has been initialized
router.get("/status", async (_req, res, next) => {
  try {
    const userRepo = useUserRepo();
    const settingsRepo = useSettingsRepo();
    const count = await userRepo.count();

    // Also return setup mode status and config
    const setupEnabled = await isSetupEnabled();
    const apiUrl = await settingsRepo.get("apiUrl");
    const kubeconfigConfigured = !!process.env.KUBECONFIG_BASE64;
    
    res.json({
      initialized: count > 0,
      setupEnabled,
      kubeconfigConfigured,
      apiUrl: apiUrl || null,
    });
  } catch (error) {
    next(error);
  }
});

// Validate kubeconfig (setup mode only)
router.post("/kubeconfig/validate", async (req, res, next) => {
  try {
    const setupEnabled = await isSetupEnabled();
    if (!setupEnabled) {
      res.status(403).json({
        valid: false,
        error: "Setup mode is disabled. Set CONTROLPLANE_SETUP=enabled to enable.",
      });
      return;
    }
    
    const { kubeconfig, context } = req.body;
    
    if (!kubeconfig) {
      res.status(400).json({ valid: false, error: "kubeconfig is required" });
      return;
    }
    
    if (!context) {
      res.status(400).json({ valid: false, error: "context is required" });
      return;
    }
    
    const result = await validateKubeconfigInternal(kubeconfig, context);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

// Save kubeconfig and update running config (setup mode only)
router.post("/save", async (req, res, next) => {
  try {
    const setupEnabled = await isSetupEnabled();
    if (!setupEnabled) {
      res.status(403).json({
        status: "error",
        error: "Setup mode is disabled. Set CONTROLPLANE_SETUP=enabled to enable.",
      });
      return;
    }
    
    const {
      KUBECONFIG_BASE64,
      CONTROLPLANE_CONTEXT,
      CONTROLPLANE_NAMESPACE,
      CONTROLPLANE_SESSION_KEY,
      CONTROLPLANE_WEBHOOK_SECRET,
    } = req.body;
    
    // Validate required fields
    if (!KUBECONFIG_BASE64) {
      res.status(400).json({ status: "error", error: "KUBECONFIG_BASE64 is required" });
      return;
    }
    
    // Decode and validate the kubeconfig
    let kubeconfigYaml: string;
    try {
      kubeconfigYaml = Buffer.from(KUBECONFIG_BASE64, "base64").toString("utf-8");
    } catch {
      res.status(400).json({ status: "error", error: "Invalid base64-encoded kubeconfig" });
      return;
    }
    
    // Validate the kubeconfig
    const validation = await validateKubeconfigInternal(
      kubeconfigYaml,
      CONTROLPLANE_CONTEXT || ""
    );
    
    if (!validation.valid) {
      res.status(400).json({ status: "error", error: validation.error });
      return;
    }
    
    // Update environment variables for running instance
    process.env.KUBECONFIG_BASE64 = KUBECONFIG_BASE64;
    process.env.CONTROLPLANE_CONTEXT = CONTROLPLANE_CONTEXT || "";
    process.env.CONTROLPLANE_NAMESPACE = CONTROLPLANE_NAMESPACE || "controlplane";
    
    if (CONTROLPLANE_SESSION_KEY) {
      process.env.CONTROLPLANE_SESSION_KEY = CONTROLPLANE_SESSION_KEY;
    }
    if (CONTROLPLANE_WEBHOOK_SECRET) {
      process.env.CONTROLPLANE_WEBHOOK_SECRET = CONTROLPLANE_WEBHOOK_SECRET;
    }
    
    // Disable setup mode after successful save
    process.env.CONTROLPLANE_SETUP = "disabled";
    
    // Store in settings for persistence
    const settingsRepo = useSettingsRepo();
    await settingsRepo.set("kubeconfigConfigured", "true");
    await settingsRepo.set("kubeconfigContext", CONTROLPLANE_CONTEXT || "");
    await settingsRepo.set("namespace", CONTROLPLANE_NAMESPACE || "controlplane");
    
    // Attempt to create the namespace
    try {
      const kc = new k8s.KubeConfig();
      kc.loadFromString(kubeconfigYaml);
      if (CONTROLPLANE_CONTEXT) {
        kc.setCurrentContext(CONTROLPLANE_CONTEXT);
      }
      
      const coreApi = kc.makeApiClient(k8s.CoreV1Api);
      const namespace = CONTROLPLANE_NAMESPACE || "controlplane";
      
      try {
        await coreApi.readNamespace(namespace);
        logger.log({ level: "info", message: `Namespace ${namespace} already exists` });
      } catch {
        // Create namespace if it doesn't exist
        await coreApi.createNamespace({
          apiVersion: "v1",
          kind: "Namespace",
          metadata: {
            name: namespace,
            labels: {
              "app.kubernetes.io/managed-by": "controlplane",
            },
          },
        });
        logger.log({ level: "info", message: `Created namespace ${namespace}` });
      }
    } catch (error: any) {
      logger.log({
        level: "warn",
        message: `Failed to create namespace: ${error.message}`,
      });
      // Don't fail the save - namespace might already exist or user might create manually
    }
    
    logger.log({
      level: "info",
      message: "Setup configuration saved successfully",
    });
    
    res.status(201).json({
      status: "ok",
      message: "Configuration saved successfully",
      clusterInfo: validation.clusterInfo,
    });
  } catch (error) {
    next(error);
  }
});

// Check if a component is installed
router.get("/check/:component", async (req, res, next) => {
  try {
    const { component } = req.params;
    
    if (!["operator", "ingress", "metrics", "cert-manager"].includes(component)) {
      res.status(400).json({ status: "error", reason: "Invalid component" });
      return;
    }
    
    const result = await checkComponent(component as "operator" | "ingress" | "metrics" | "cert-manager");
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Initialize the platform (create first admin user)
// Rate limited to prevent brute-force attacks during setup
router.post("/init", rateLimitAuth, async (req, res, next) => {
  try {
    const userRepo = useUserRepo();
    const settingsRepo = useSettingsRepo();
    const { useUserService } = await import("../resources");
    const userService = useUserService();
    
    // Check if already initialized
    const count = await userRepo.count();
    if (count > 0) {
      res.status(400).json({ error: "Platform already initialized" });
      return;
    }
    
    const { email, password, apiUrl } = req.body;
    
    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }
    
    if (password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }
    
    // Ensure SSH key exists
    ensureSSHKey();
    
    // Create the admin user
    const userId = await userService.createUser(email, password);
    
    // Mark as initialized
    await settingsRepo.set("initialized", "true");
    await settingsRepo.set("initializedAt", new Date().toISOString());

    // Store API URL if provided (for frontend reference)
    if (apiUrl) {
      await settingsRepo.set("apiUrl", apiUrl);
    }
    
    // Disable setup mode
    process.env.CONTROLPLANE_SETUP = "disabled";
    
    logger.log({
      level: "info",
      message: `Platform initialized with admin user: ${email}`,
    });
    
    res.status(201).json({
      message: "Platform initialized successfully",
      userId,
    });
  } catch (error) {
    next(error);
  }
});

// Get or update platform configuration (auth required)
router.get("/config", requireAuth, async (_req, res, next) => {
  try {
    const settingsRepo = useSettingsRepo();
    
    const apiUrl = await settingsRepo.get("apiUrl");
    const initializedAt = await settingsRepo.get("initializedAt");
    const kubeconfigConfigured = await settingsRepo.get("kubeconfigConfigured");
    const namespace = await settingsRepo.get("namespace");
    
    res.json({
      apiUrl: apiUrl || null,
      initializedAt: initializedAt || null,
      kubeconfigConfigured: kubeconfigConfigured === "true",
      namespace: namespace || "controlplane",
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/config", requireAuth, async (req, res, next) => {
  try {
    const settingsRepo = useSettingsRepo();
    const { apiUrl } = req.body;
    
    if (apiUrl !== undefined) {
      await settingsRepo.set("apiUrl", apiUrl);
    }
    
    res.json({
      message: "Configuration updated",
    });
  } catch (error) {
    next(error);
  }
});

// Get SSH public key (for copying to servers)
router.get("/ssh-key", requireAuth, async (_req, res, next) => {
  try {
    const { publicKey } = ensureSSHKey();
    
    res.json({
      publicKey,
      copyCommand: `echo "${publicKey}" >> ~/.ssh/authorized_keys`,
    });
  } catch (error) {
    next(error);
  }
});

// Generate .env content for download
router.post("/generate-env", async (req, res, next) => {
  try {
    const {
      KUBECONFIG_BASE64,
      CONTROLPLANE_CONTEXT,
      CONTROLPLANE_NAMESPACE,
      CONTROLPLANE_SESSION_KEY,
      CONTROLPLANE_WEBHOOK_SECRET,
    } = req.body;
    
    let envContent = "# Control Plane Configuration\n";
    envContent += "# Generated by setup wizard\n\n";
    
    if (KUBECONFIG_BASE64) {
      envContent += `KUBECONFIG_BASE64=${KUBECONFIG_BASE64}\n`;
    }
    if (CONTROLPLANE_CONTEXT) {
      envContent += `CONTROLPLANE_CONTEXT=${CONTROLPLANE_CONTEXT}\n`;
    }
    if (CONTROLPLANE_NAMESPACE) {
      envContent += `CONTROLPLANE_NAMESPACE=${CONTROLPLANE_NAMESPACE}\n`;
    }
    if (CONTROLPLANE_SESSION_KEY) {
      envContent += `CONTROLPLANE_SESSION_KEY=${CONTROLPLANE_SESSION_KEY}\n`;
    }
    if (CONTROLPLANE_WEBHOOK_SECRET) {
      envContent += `CONTROLPLANE_WEBHOOK_SECRET=${CONTROLPLANE_WEBHOOK_SECRET}\n`;
    }
    
    res.json({ content: envContent });
  } catch (error) {
    next(error);
  }
});

export default router;
