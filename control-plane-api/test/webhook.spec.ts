import { expect } from "chai";
import { describe, it, beforeEach, afterEach, before } from "mocha";
import { ObjectId } from "mongodb";
import { useWebhookRepo } from "../src/resources/webhook/webhook.repository";
import { useWebhookService } from "../src/resources/webhook/webhook.service";
import { TWebhook, TWebhookEvent, webhookEvents } from "../src/resources/webhook/webhook.model";

describe("Webhook Resource", function () {
  this.timeout(10000);

  const createdIds: string[] = [];

  afterEach(async () => {
    // Clean up: delete all test webhooks
    const repo = useWebhookRepo();
    for (const id of createdIds) {
      try {
        await repo.deleteById(id);
      } catch {
        // Ignore not found errors
      }
    }
    createdIds.length = 0;
  });

  describe("Webhook Model", () => {
    it("should export all webhook event types", () => {
      expect(webhookEvents).to.be.an("array");
      expect(webhookEvents).to.include("app.deployed");
      expect(webhookEvents).to.include("app.failed");
      expect(webhookEvents).to.include("database.created");
      expect(webhookEvents).to.include("alert.created");
      expect(webhookEvents).to.include("node.offline");
      expect(webhookEvents).to.include("backup.completed");
    });
  });

  describe("Webhook Repository", () => {
    it("should create a new webhook", async () => {
      const repo = useWebhookRepo();
      
      const webhookId = await repo.add({
        name: "Test Webhook " + Date.now(),
        type: "custom",
        url: "https://example.com/webhook",
        events: ["app.deployed"],
        enabled: true,
        headers: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      createdIds.push(webhookId);

      expect(webhookId).to.exist;
      expect(webhookId).to.be.a("string");
    });

    it("should get webhook by ID", async () => {
      const repo = useWebhookRepo();
      
      const name = "Test Webhook " + Date.now();
      const webhookId = await repo.add({
        name,
        type: "slack",
        url: "https://hooks.slack.com/services/test",
        events: ["app.deployed", "app.failed"],
        enabled: true,
        headers: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      createdIds.push(webhookId);

      const webhook = await repo.getById(webhookId);

      expect(webhook).to.exist;
      expect(webhook.name).to.equal(name);
      expect(webhook.type).to.equal("slack");
      expect(webhook.events).to.deep.equal(["app.deployed", "app.failed"]);
    });

    it("should get webhooks by event", async () => {
      const repo = useWebhookRepo();
      
      const webhookId = await repo.add({
        name: "Test Webhook Event " + Date.now(),
        type: "custom",
        url: "https://example.com/webhook",
        events: ["app.deployed", "database.created"],
        enabled: true,
        headers: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      createdIds.push(webhookId);

      const webhooks = await repo.getByEvent("app.deployed");

      expect(webhooks).to.be.an("array");
      expect(webhooks.length).to.be.at.least(1);
      
      const found = webhooks.find(w => w._id?.toString() === webhookId);
      expect(found).to.exist;
    });

    it("should not return disabled webhooks by event", async () => {
      const repo = useWebhookRepo();
      
      const webhookId = await repo.add({
        name: "Disabled Webhook " + Date.now(),
        type: "custom",
        url: "https://example.com/webhook",
        events: ["app.stopped"],
        enabled: false,
        headers: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      createdIds.push(webhookId);

      const webhooks = await repo.getByEvent("app.stopped");

      const found = webhooks.find(w => w._id?.toString() === webhookId);
      expect(found).to.not.exist;
    });

    it("should update webhook by ID", async () => {
      const repo = useWebhookRepo();
      
      const webhookId = await repo.add({
        name: "Update Test " + Date.now(),
        type: "custom",
        url: "https://example.com/webhook",
        events: ["app.deployed"],
        enabled: true,
        headers: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      createdIds.push(webhookId);

      await repo.updateById(webhookId, {
        enabled: false,
        events: ["app.deployed", "app.failed"],
      });

      const webhook = await repo.getById(webhookId);

      expect(webhook.enabled).to.be.false;
      expect(webhook.events).to.deep.equal(["app.deployed", "app.failed"]);
    });

    it("should update last trigger information", async () => {
      const repo = useWebhookRepo();
      
      const webhookId = await repo.add({
        name: "Trigger Test " + Date.now(),
        type: "custom",
        url: "https://example.com/webhook",
        events: ["app.deployed"],
        enabled: true,
        headers: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      createdIds.push(webhookId);

      await repo.updateLastTrigger(webhookId, "success");

      const webhook = await repo.getById(webhookId);

      expect(webhook.lastTriggeredAt).to.exist;
      expect(webhook.lastStatus).to.equal("success");
    });

    it("should update last trigger with error", async () => {
      const repo = useWebhookRepo();
      
      const webhookId = await repo.add({
        name: "Error Test " + Date.now(),
        type: "custom",
        url: "https://example.com/webhook",
        events: ["app.deployed"],
        enabled: true,
        headers: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      createdIds.push(webhookId);

      await repo.updateLastTrigger(webhookId, "failed", "Connection refused");

      const webhook = await repo.getById(webhookId);

      expect(webhook.lastStatus).to.equal("failed");
      expect(webhook.lastError).to.equal("Connection refused");
    });

    it("should delete webhook by ID", async () => {
      const repo = useWebhookRepo();
      
      const webhookId = await repo.add({
        name: "Delete Test " + Date.now(),
        type: "custom",
        url: "https://example.com/webhook",
        events: ["app.deployed"],
        enabled: true,
        headers: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await repo.deleteById(webhookId);

      try {
        await repo.getById(webhookId);
        expect.fail("Should have thrown NotFoundError");
      } catch (error: any) {
        expect(error.message).to.include("not found");
      }
    });

    it("should get all webhooks with pagination", async () => {
      const repo = useWebhookRepo();
      
      // Create a few webhooks
      for (let i = 0; i < 3; i++) {
        const id = await repo.add({
          name: `Pagination Test ${Date.now()}-${i}`,
          type: "custom",
          url: "https://example.com/webhook",
          events: ["app.deployed"],
          enabled: true,
          headers: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        createdIds.push(id);
      }

      const result = await repo.getAll({ page: 1 });

      expect(result.items).to.be.an("array");
      expect(result.pages).to.be.at.least(1);
      expect(result.total).to.be.at.least(3);
    });
  });

  describe("Webhook Service", () => {
    it("should create a webhook via service", async () => {
      const service = useWebhookService();

      const result = await service.create({
        name: "Service Test " + Date.now(),
        type: "custom",
        url: "https://example.com/webhook",
        events: ["app.deployed"],
      });

      createdIds.push(result.webhookId);

      expect(result.webhookId).to.exist;
      expect(result.webhookId).to.be.a("string");
    });

    it("should reject duplicate webhook names", async () => {
      const service = useWebhookService();
      const name = "Duplicate Test " + Date.now();

      const result = await service.create({
        name,
        type: "custom",
        url: "https://example.com/webhook",
        events: ["app.deployed"],
      });

      createdIds.push(result.webhookId);

      try {
        await service.create({
          name,
          type: "custom",
          url: "https://example.com/webhook2",
          events: ["app.deployed"],
        });
        expect.fail("Should have thrown error");
      } catch (error: any) {
        expect(error.message).to.include("already exists");
      }
    });

    it("should list available events", () => {
      const service = useWebhookService();
      const events = service.getAvailableEvents();

      expect(events).to.be.an("array");
      expect(events.length).to.be.at.least(10);

      const appDeployedEvent = events.find(e => e.event === "app.deployed");
      expect(appDeployedEvent).to.exist;
      expect(appDeployedEvent?.description).to.exist;
    });

    it("should validate slack URL format", async () => {
      const service = useWebhookService();

      try {
        await service.create({
          name: "Bad Slack " + Date.now(),
          type: "slack",
          url: "https://example.com/not-slack",
          events: ["app.deployed"],
        });
        expect.fail("Should have thrown error");
      } catch (error: any) {
        expect(error.message).to.include("hooks.slack.com");
      }
    });

    it("should validate discord URL format", async () => {
      const service = useWebhookService();

      try {
        await service.create({
          name: "Bad Discord " + Date.now(),
          type: "discord",
          url: "https://example.com/not-discord",
          events: ["app.deployed"],
        });
        expect.fail("Should have thrown error");
      } catch (error: any) {
        expect(error.message).to.include("discord.com/api/webhooks");
      }
    });

    it("should validate email format", async () => {
      const service = useWebhookService();

      try {
        await service.create({
          name: "Bad Email " + Date.now(),
          type: "email",
          url: "not-an-email",
          events: ["app.deployed"],
        });
        expect.fail("Should have thrown error");
      } catch (error: any) {
        expect(error.message).to.include("valid email");
      }
    });

    it("should validate custom webhook URL format", async () => {
      const service = useWebhookService();

      try {
        await service.create({
          name: "Bad Custom " + Date.now(),
          type: "custom",
          url: "ftp://example.com/webhook",
          events: ["app.deployed"],
        });
        expect.fail("Should have thrown error");
      } catch (error: any) {
        expect(error.message).to.include("http");
      }
    });
  });
});
