import express from "express";
import { requireAuth } from "../utils";
import { useAuditLogController } from "../resources";

const router = express.Router();

const { getAll } = useAuditLogController();

router.get("/", requireAuth, getAll);

export default router;
