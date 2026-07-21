import express from "express";

const router = express.Router();

// GitHub webhook handler
import github from "./github.route";
router.use("/", github);

export default router;
