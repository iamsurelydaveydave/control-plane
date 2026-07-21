import express from "express";
import { requireAuth, rateLimitAuth } from "../utils";
import { useAuthController } from "../resources";

const router = express.Router();

const { login, logout, me, updateMe, issueToken } = useAuthController();

// Auth endpoints with strict rate limiting (5 attempts per 15 minutes)
router.post("/login", rateLimitAuth, login);
router.delete("/logout", requireAuth, logout);
router.get("/me", requireAuth, me);
router.patch("/me", requireAuth, updateMe);
router.post("/token", requireAuth, rateLimitAuth, issueToken);

export default router;
