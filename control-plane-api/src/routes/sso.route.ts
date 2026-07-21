import express from "express";
import { requireAuth, requireAdmin } from "../utils";
import { useSSOConfigController } from "../resources/sso-config";

const router = express.Router();

const {
  list,
  get,
  add,
  update,
  remove,
  enable,
  disable,
  getMetadata,
  initiateLogin,
  handleSAMLCallback,
  handleOIDCCallback,
  listEnabled,
} = useSSOConfigController();

// ---------------------------------------------------------------------------
// Admin endpoints (require auth + admin)
// ---------------------------------------------------------------------------

// List all SSO configs
router.get("/configs", requireAuth, requireAdmin, list);

// Create new SSO config
router.post("/configs", requireAuth, requireAdmin, add);

// Get single SSO config
router.get("/configs/:id", requireAuth, requireAdmin, get);

// Update SSO config
router.patch("/configs/:id", requireAuth, requireAdmin, update);

// Delete SSO config
router.delete("/configs/:id", requireAuth, requireAdmin, remove);

// Enable/disable SSO config
router.post("/configs/:id/enable", requireAuth, requireAdmin, enable);
router.post("/configs/:id/disable", requireAuth, requireAdmin, disable);

// Get SAML SP metadata (public for IdP configuration, but only for valid configs)
router.get("/configs/:id/metadata", getMetadata);

// ---------------------------------------------------------------------------
// Public SSO flow endpoints (no auth required - these are for login)
// ---------------------------------------------------------------------------

// List enabled SSO options (for login page)
router.get("/options", listEnabled);

// Initiate SSO login
router.get("/:id/login", initiateLogin);

// SAML Assertion Consumer Service (ACS) - POST binding
// This needs to parse form data from IdP
router.post(
  "/:id/callback/saml",
  express.urlencoded({ extended: false }), // SAML responses come as form data
  handleSAMLCallback
);

// OIDC callback - GET with query params (code, state)
router.get("/:id/callback/oidc", handleOIDCCallback);

export default router;
