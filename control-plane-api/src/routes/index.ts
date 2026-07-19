import express from "express";

const router = express.Router();

router.get("/v1", (_req, res) => {
  res.json({
    message: "Control Plane API",
    version: "0.1.0",
  });
});

// Health check endpoint
router.use(express.json());

// Sanitize MongoDB operators
import { sanitizeMongo } from "../utils";
router.use(sanitizeMongo);

import health from "./health.route";
router.use("/health", health);

import setup from "./setup.route";
router.use("/setup", setup);

import auth from "./auth.route";
router.use("/auth", auth);

import server from "./server.route";
router.use("/servers", server);

import app from "./app.route";
router.use("/apps", app);

import database from "./database.route";
router.use("/databases", database);

import audit from "./audit.route";
router.use("/audit-logs", audit);

import sshKeys from "./ssh-keys.route";
router.use("/ssh-keys", sshKeys);

import apiTokens from "./api-tokens.route";
router.use("/api-tokens", apiTokens);

import secrets from "./secrets.route";
router.use("/secrets", secrets);

export default router;
