import express from "express";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { useUserRepo, useSettingsRepo } from "../resources";
import { requireAuth, rateLimitAuth } from "../utils";

const router = express.Router();

// SSH key paths
const SSH_DIR = process.env.SSH_DIR || join(homedir(), ".ssh");
const PRIVATE_KEY_PATH = join(SSH_DIR, "id_ed25519");
const PUBLIC_KEY_PATH = join(SSH_DIR, "id_ed25519.pub");

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

// Check if the platform has been initialized
router.get("/status", async (_req, res, next) => {
  try {
    const userRepo = useUserRepo();
    const settingsRepo = useSettingsRepo();
    const count = await userRepo.count();

    // Also return API URL if configured
    const apiUrl = await settingsRepo.get("apiUrl");
    
    res.json({
      initialized: count > 0,
      apiUrl: apiUrl || null,
    });
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
    
    res.status(201).json({
      message: "Platform initialized successfully",
      userId,
    });
  } catch (error) {
    next(error);
  }
});

// Get or update platform configuration
router.get("/config", requireAuth, async (_req, res, next) => {
  try {
    const settingsRepo = useSettingsRepo();
    
    const apiUrl = await settingsRepo.get("apiUrl");
    const initializedAt = await settingsRepo.get("initializedAt");
    
    res.json({
      apiUrl: apiUrl || null,
      initializedAt: initializedAt || null,
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

export default router;
