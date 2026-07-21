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

import users from "./users.route";
router.use("/users", users);

import roles from "./roles.route";
router.use("/roles", roles);

import app from "./app.route";
router.use("/apps", app);

import audit from "./audit.route";
router.use("/audit-logs", audit);

import apiTokens from "./api-tokens.route";
router.use("/api-tokens", apiTokens);

import secrets from "./secrets.route";
router.use("/secrets", secrets);

import sshKeys from "./ssh-keys.route";
router.use("/ssh-keys", sshKeys);

import settings from "./settings.route";
router.use("/settings", settings);

// K8s-native routes
import cluster from "./cluster.route";
router.use("/clusters", cluster);

import node from "./node.route";
router.use("/nodes", node);

import databases from "./databases.route";
router.use("/databases", databases);

import metrics from "./metrics.route";
router.use("/metrics", metrics);

import prometheus from "./prometheus.route";
router.use("/prometheus", prometheus);

import alerts from "./alerts.route";
router.use("/alerts", alerts);

import webhooks from "./webhooks.route";
router.use("/webhooks", webhooks);

import logs from "./logs.route";
router.use("/logs", logs);

import scheduledTasks from "./scheduled-tasks.route";
router.use("/scheduled-tasks", scheduledTasks);

// Deployments (approvals and status)
import deployments from "./deployments.route";
router.use("/deployments", deployments);

// GitHub Webhooks
import githubWebhooks from "./webhooks";
router.use("/webhooks", githubWebhooks);

// Organizations (multi-tenancy)
import organizations from "./organizations.route";
router.use("/organizations", organizations);

import invites from "./invites.route";
router.use("/invites", invites);

import addons from "./addons.route";
router.use("/addons", addons);

import registries from "./registries.route";
router.use("/registries", registries);

// Pipelines (deployment stages and promotions)
import pipelines from "./pipelines.route";
router.use("/pipelines", pipelines);

import promotions from "./promotions.route";
router.use("/promotions", promotions);

import sso from "./sso.route";
router.use("/sso", sso);

import pods from "./pods.route";
router.use("/pods", pods);

// Future routes:
// import mongoCluster from "./mongo-cluster.route";
// router.use("/mongo-clusters", mongoCluster);

export default router;
