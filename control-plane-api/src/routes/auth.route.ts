import express from "express";
import { requireAuth } from "../utils";
import { useAuthController } from "../resources";

const router = express.Router();

const { login, logout, me, updateMe, issueToken } = useAuthController();

router.post("/login", login);
router.delete("/logout", requireAuth, logout);
router.get("/me", requireAuth, me);
router.patch("/me", requireAuth, updateMe);
router.post("/token", requireAuth, issueToken);

export default router;
