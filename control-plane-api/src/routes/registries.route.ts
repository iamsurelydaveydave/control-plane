import express from "express";
import { requireAuth, requirePermission } from "../utils";
import { useRegistryController } from "../resources/registry";

const router = express.Router();

const {
  list,
  getById,
  add,
  updateById,
  deleteById,
  verify,
  syncSecrets,
  createPullSecret,
  deletePullSecret,
  listRepositories,
  listTags,
  deleteTag,
} = useRegistryController();

// All registry routes require authentication
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Registry CRUD
// ---------------------------------------------------------------------------

// List all registries
router.get("/", requirePermission("registries:read"), list);

// Get registry by ID
router.get("/:id", requirePermission("registries:read"), getById);

// Create a new registry
router.post("/", requirePermission("registries:create"), add);

// Update registry
router.patch("/:id", requirePermission("registries:update"), updateById);

// Delete registry
router.delete("/:id", requirePermission("registries:delete"), deleteById);

// ---------------------------------------------------------------------------
// Registry Operations
// ---------------------------------------------------------------------------

// Verify registry credentials
router.post("/:id/verify", requirePermission("registries:update"), verify);

// Sync pull secrets to all namespaces
router.post(
  "/:id/sync-secrets",
  requirePermission("registries:update"),
  syncSecrets
);

// Create pull secret in a namespace
router.post(
  "/:id/pull-secrets",
  requirePermission("registries:update"),
  createPullSecret
);

// Delete pull secret from a namespace
router.delete(
  "/:id/pull-secrets/:namespace",
  requirePermission("registries:update"),
  deletePullSecret
);

// ---------------------------------------------------------------------------
// Image Operations
// ---------------------------------------------------------------------------

// List repositories in the registry
router.get(
  "/:id/repositories",
  requirePermission("registries:read"),
  listRepositories
);

// List tags for a repository (repo is URL-encoded, may contain slashes)
router.get(
  "/:id/repositories/:repo/tags",
  requirePermission("registries:read"),
  listTags
);

// Delete a tag from a repository
router.delete(
  "/:id/repositories/:repo/tags/:tag",
  requirePermission("registries:update"),
  deleteTag
);

export default router;
