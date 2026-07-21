import { expect } from "chai";
import { describe, it, afterEach } from "mocha";
import { useScheduledTaskRepo, useTaskHistoryRepo } from "../src/resources/scheduled-task/scheduled-task.repository";
import { useScheduledTaskService } from "../src/resources/scheduled-task/scheduled-task.service";
import {
  scheduledTaskTypes,
  scheduledTaskStatuses,
  TScheduledTaskInput,
} from "../src/resources/scheduled-task/scheduled-task.model";

describe("Scheduled Task Resource", function () {
  this.timeout(10000);

  const createdTaskIds: string[] = [];
  const createdHistoryIds: string[] = [];

  afterEach(async () => {
    // Clean up: delete all test tasks and history
    const taskRepo = useScheduledTaskRepo();
    const historyRepo = useTaskHistoryRepo();

    for (const id of createdTaskIds) {
      try {
        await taskRepo.deleteById(id);
      } catch {
        // Ignore not found errors
      }
    }
    createdTaskIds.length = 0;

    for (const id of createdHistoryIds) {
      try {
        // Task history doesn't have deleteById, it auto-cleans via TTL
      } catch {
        // Ignore errors
      }
    }
    createdHistoryIds.length = 0;
  });

  describe("Scheduled Task Model", () => {
    it("should export all task types", () => {
      expect(scheduledTaskTypes).to.be.an("array");
      expect(scheduledTaskTypes).to.include("backup");
      expect(scheduledTaskTypes).to.include("cleanup");
      expect(scheduledTaskTypes).to.include("health-check");
      expect(scheduledTaskTypes).to.include("script");
      expect(scheduledTaskTypes).to.include("webhook");
    });

    it("should export all task statuses", () => {
      expect(scheduledTaskStatuses).to.be.an("array");
      expect(scheduledTaskStatuses).to.include("active");
      expect(scheduledTaskStatuses).to.include("paused");
      expect(scheduledTaskStatuses).to.include("running");
      expect(scheduledTaskStatuses).to.include("failed");
    });
  });

  describe("Scheduled Task Repository", () => {
    it("should create a new scheduled task", async () => {
      const repo = useScheduledTaskRepo();

      const taskData: TScheduledTaskInput = {
        name: "Test Cleanup Task " + Date.now(),
        type: "cleanup",
        schedule: "0 0 * * *", // Daily at midnight
        config: {
          retentionDays: 30,
        },
      };

      const taskId = await repo.add(taskData);
      createdTaskIds.push(taskId);

      expect(taskId).to.exist;
      expect(taskId).to.be.a("string");
      expect(taskId).to.have.lengthOf(24);
    });

    it("should get scheduled task by ID", async () => {
      const repo = useScheduledTaskRepo();

      const name = "Test Task " + Date.now();
      const taskData: TScheduledTaskInput = {
        name,
        type: "webhook",
        schedule: "*/5 * * * *", // Every 5 minutes
        config: {
          url: "https://example.com/webhook",
          method: "POST",
        },
      };

      const taskId = await repo.add(taskData);
      createdTaskIds.push(taskId);

      const task = await repo.getById(taskId);

      expect(task).to.exist;
      expect(task.name).to.equal(name);
      expect(task.type).to.equal("webhook");
      expect(task.schedule).to.equal("*/5 * * * *");
      expect(task.status).to.equal("active");
      expect(task.config.url).to.equal("https://example.com/webhook");
    });

    it("should get all active tasks", async () => {
      const repo = useScheduledTaskRepo();

      // Create an active task
      const taskId = await repo.add({
        name: "Active Task " + Date.now(),
        type: "health-check",
        schedule: "0 * * * *",
        config: {},
      });
      createdTaskIds.push(taskId);

      const activeTasks = await repo.getActive();

      expect(activeTasks).to.be.an("array");
      expect(activeTasks.length).to.be.at.least(1);

      const found = activeTasks.find(t => t._id?.toString() === taskId);
      expect(found).to.exist;
    });

    it("should update task status to paused", async () => {
      const repo = useScheduledTaskRepo();

      const taskId = await repo.add({
        name: "Pause Test " + Date.now(),
        type: "cleanup",
        schedule: "0 0 * * *",
        config: { retentionDays: 7 },
      });
      createdTaskIds.push(taskId);

      await repo.updateStatus(taskId, "paused");

      const task = await repo.getById(taskId);
      expect(task.status).to.equal("paused");
    });

    it("should update task by ID", async () => {
      const repo = useScheduledTaskRepo();

      const taskId = await repo.add({
        name: "Update Test " + Date.now(),
        type: "cleanup",
        schedule: "0 0 * * *",
        config: { retentionDays: 30 },
      });
      createdTaskIds.push(taskId);

      await repo.updateById(taskId, {
        name: "Updated Task Name",
        schedule: "0 12 * * *", // Changed to noon
      });

      const task = await repo.getById(taskId);
      expect(task.name).to.equal("Updated Task Name");
      expect(task.schedule).to.equal("0 12 * * *");
    });

    it("should delete task by ID", async () => {
      const repo = useScheduledTaskRepo();

      const taskId = await repo.add({
        name: "Delete Test " + Date.now(),
        type: "health-check",
        schedule: "0 * * * *",
        config: {},
      });

      await repo.deleteById(taskId);

      try {
        await repo.getById(taskId);
        expect.fail("Should have thrown NotFoundError");
      } catch (error: any) {
        expect(error.message).to.include("not found");
      }
    });

    it("should get all tasks with pagination", async () => {
      const repo = useScheduledTaskRepo();

      // Create a few tasks
      for (let i = 0; i < 3; i++) {
        const id = await repo.add({
          name: `Pagination Test ${Date.now()}-${i}`,
          type: "cleanup",
          schedule: "0 0 * * *",
          config: { retentionDays: 30 },
        });
        createdTaskIds.push(id);
      }

      const result = await repo.getAll({ page: 1 });

      expect(result.items).to.be.an("array");
      expect(result.pages).to.be.at.least(1);
    });

    it("should filter tasks by status", async () => {
      const repo = useScheduledTaskRepo();

      const taskId = await repo.add({
        name: "Status Filter Test " + Date.now(),
        type: "cleanup",
        schedule: "0 0 * * *",
        config: { retentionDays: 30 },
      });
      createdTaskIds.push(taskId);

      // Pause the task
      await repo.updateStatus(taskId, "paused");

      const pausedTasks = await repo.getAll({ status: "paused" });

      const found = pausedTasks.items.find((t: any) => t._id?.toString() === taskId);
      expect(found).to.exist;
    });

    it("should filter tasks by type", async () => {
      const repo = useScheduledTaskRepo();

      const taskId = await repo.add({
        name: "Type Filter Test " + Date.now(),
        type: "webhook",
        schedule: "0 0 * * *",
        config: { url: "https://example.com/test" },
      });
      createdTaskIds.push(taskId);

      const webhookTasks = await repo.getAll({ type: "webhook" });

      const found = webhookTasks.items.find((t: any) => t._id?.toString() === taskId);
      expect(found).to.exist;
    });

    it("should mark task as running and prevent concurrent execution", async () => {
      const repo = useScheduledTaskRepo();

      const taskId = await repo.add({
        name: "Concurrent Test " + Date.now(),
        type: "health-check",
        schedule: "* * * * *",
        config: {},
      });
      createdTaskIds.push(taskId);

      // First mark should succeed
      const firstMark = await repo.markRunning(taskId);
      expect(firstMark).to.be.true;

      // Second mark should fail (task is already running)
      const secondMark = await repo.markRunning(taskId);
      expect(secondMark).to.be.false;

      // Verify status
      const task = await repo.getById(taskId);
      expect(task.status).to.equal("running");
    });
  });

  describe("Task History Repository", () => {
    it("should create task history entry", async () => {
      const taskRepo = useScheduledTaskRepo();
      const historyRepo = useTaskHistoryRepo();

      // First create a task
      const taskId = await taskRepo.add({
        name: "History Test " + Date.now(),
        type: "health-check",
        schedule: "0 * * * *",
        config: {},
      });
      createdTaskIds.push(taskId);

      const startedAt = new Date();
      const completedAt = new Date(startedAt.getTime() + 1000);

      const historyId = await historyRepo.add({
        taskId,
        status: "success",
        startedAt,
        completedAt,
        duration: 1000,
        output: "Health check passed",
      });

      expect(historyId).to.exist;
      expect(historyId).to.be.a("string");
    });

    it("should get history by task ID", async () => {
      const taskRepo = useScheduledTaskRepo();
      const historyRepo = useTaskHistoryRepo();

      const taskId = await taskRepo.add({
        name: "History Query Test " + Date.now(),
        type: "cleanup",
        schedule: "0 0 * * *",
        config: { retentionDays: 30 },
      });
      createdTaskIds.push(taskId);

      // Add some history entries
      const startedAt = new Date();
      await historyRepo.add({
        taskId,
        status: "success",
        startedAt,
        completedAt: new Date(startedAt.getTime() + 500),
        duration: 500,
      });

      await historyRepo.add({
        taskId,
        status: "failed",
        startedAt: new Date(startedAt.getTime() + 1000),
        completedAt: new Date(startedAt.getTime() + 1200),
        duration: 200,
        error: "Test error",
      });

      const history = await historyRepo.getByTaskId(taskId);

      expect(history.items).to.be.an("array");
      expect(history.items.length).to.equal(2);
    });

    it("should delete history when task is deleted", async () => {
      const taskRepo = useScheduledTaskRepo();
      const historyRepo = useTaskHistoryRepo();

      const taskId = await taskRepo.add({
        name: "Delete History Test " + Date.now(),
        type: "health-check",
        schedule: "0 * * * *",
        config: {},
      });

      // Add history
      await historyRepo.add({
        taskId,
        status: "success",
        startedAt: new Date(),
        completedAt: new Date(),
        duration: 100,
      });

      // Delete history for task
      await historyRepo.deleteByTaskId(taskId);

      // Now delete the task
      await taskRepo.deleteById(taskId);

      // History should be empty
      const history = await historyRepo.getByTaskId(taskId);
      expect(history.items).to.have.lengthOf(0);
    });
  });

  describe("Scheduled Task Service", () => {
    it("should create a task and set next run time", async () => {
      const service = useScheduledTaskService();
      const taskRepo = useScheduledTaskRepo();

      const taskId = await service.create({
        name: "Service Test " + Date.now(),
        type: "cleanup",
        schedule: "0 0 * * *",
        config: { retentionDays: 30 },
      });
      createdTaskIds.push(taskId);

      const task = await taskRepo.getById(taskId);

      expect(task.nextRunAt).to.exist;
      expect(task.nextRunAt).to.be.instanceOf(Date);
      expect(task.nextRunAt!.getTime()).to.be.greaterThan(Date.now());
    });

    it("should calculate next run time correctly", () => {
      const service = useScheduledTaskService();

      // Test daily at midnight
      const nextRun = service.calculateNextRun("0 0 * * *", "UTC");

      expect(nextRun).to.be.instanceOf(Date);
      expect(nextRun.getTime()).to.be.greaterThan(Date.now());
    });

    it("should pause and resume a task", async () => {
      const service = useScheduledTaskService();
      const taskRepo = useScheduledTaskRepo();

      const taskId = await service.create({
        name: "Pause Resume Test " + Date.now(),
        type: "health-check",
        schedule: "0 * * * *",
        config: {},
      });
      createdTaskIds.push(taskId);

      // Pause
      await service.pause(taskId);
      let task = await taskRepo.getById(taskId);
      expect(task.status).to.equal("paused");

      // Resume
      await service.resume(taskId);
      task = await taskRepo.getById(taskId);
      expect(task.status).to.equal("active");
      expect(task.nextRunAt).to.exist;
    });

    it("should execute a health check task", async () => {
      const service = useScheduledTaskService();
      const taskRepo = useScheduledTaskRepo();

      const taskId = await service.create({
        name: "Execute Test " + Date.now(),
        type: "health-check",
        schedule: "0 * * * *",
        config: {},
      });
      createdTaskIds.push(taskId);

      const task = await taskRepo.getById(taskId);
      const result = await service.executeTask(task);

      expect(result).to.exist;
      expect(result.duration).to.be.a("number");
      expect(result.duration).to.be.at.least(0);
      // Health check should succeed (unless dependencies are down)
    });

    it("should execute a cleanup task", async () => {
      const service = useScheduledTaskService();
      const taskRepo = useScheduledTaskRepo();

      const taskId = await service.create({
        name: "Cleanup Execute Test " + Date.now(),
        type: "cleanup",
        schedule: "0 0 * * *",
        config: { retentionDays: 30 },
      });
      createdTaskIds.push(taskId);

      const task = await taskRepo.getById(taskId);
      const result = await service.executeTask(task);

      expect(result).to.exist;
      expect(result.success).to.be.true;
      expect(result.output).to.exist;
    });

    it("should fail gracefully for script tasks (security)", async () => {
      const service = useScheduledTaskService();
      const taskRepo = useScheduledTaskRepo();

      const taskId = await service.create({
        name: "Script Test " + Date.now(),
        type: "script",
        schedule: "0 0 * * *",
        config: { script: "echo hello" },
      });
      createdTaskIds.push(taskId);

      const task = await taskRepo.getById(taskId);
      const result = await service.executeTask(task);

      // Script execution should be blocked for security
      expect(result.success).to.be.false;
      expect(result.error).to.include("security");
    });

    it("should remove task and its history", async () => {
      const service = useScheduledTaskService();
      const taskRepo = useScheduledTaskRepo();
      const historyRepo = useTaskHistoryRepo();

      const taskId = await service.create({
        name: "Remove Test " + Date.now(),
        type: "health-check",
        schedule: "0 * * * *",
        config: {},
      });

      // Add some history
      await historyRepo.add({
        taskId,
        status: "success",
        startedAt: new Date(),
        completedAt: new Date(),
        duration: 100,
      });

      // Remove
      await service.remove(taskId);

      // Task should be gone
      try {
        await taskRepo.getById(taskId);
        expect.fail("Should have thrown NotFoundError");
      } catch (error: any) {
        expect(error.message).to.include("not found");
      }

      // History should be gone
      const history = await historyRepo.getByTaskId(taskId);
      expect(history.items).to.have.lengthOf(0);
    });
  });

  describe("Validation", () => {
    it("should reject invalid cron expression", async () => {
      const repo = useScheduledTaskRepo();

      try {
        await repo.add({
          name: "Invalid Cron " + Date.now(),
          type: "cleanup",
          schedule: "invalid cron expression",
          config: { retentionDays: 30 },
        });
        expect.fail("Should have thrown validation error");
      } catch (error: any) {
        expect(error.message).to.include("cron expression");
      }
    });

    it("should require databaseId for backup tasks", async () => {
      const repo = useScheduledTaskRepo();

      try {
        await repo.add({
          name: "Backup No DB " + Date.now(),
          type: "backup",
          schedule: "0 0 * * *",
          config: {}, // Missing databaseId
        });
        expect.fail("Should have thrown validation error");
      } catch (error: any) {
        expect(error.message).to.include("databaseId");
      }
    });

    it("should require url for webhook tasks", async () => {
      const repo = useScheduledTaskRepo();

      try {
        await repo.add({
          name: "Webhook No URL " + Date.now(),
          type: "webhook",
          schedule: "0 0 * * *",
          config: {}, // Missing url
        });
        expect.fail("Should have thrown validation error");
      } catch (error: any) {
        expect(error.message).to.include("url");
      }
    });

    it("should require script for script tasks", async () => {
      const repo = useScheduledTaskRepo();

      try {
        await repo.add({
          name: "Script No Script " + Date.now(),
          type: "script",
          schedule: "0 0 * * *",
          config: {}, // Missing script
        });
        expect.fail("Should have thrown validation error");
      } catch (error: any) {
        expect(error.message).to.include("script");
      }
    });

    it("should accept valid webhook URL", async () => {
      const repo = useScheduledTaskRepo();

      const taskId = await repo.add({
        name: "Valid Webhook " + Date.now(),
        type: "webhook",
        schedule: "0 0 * * *",
        config: {
          url: "https://example.com/webhook",
          method: "POST",
          headers: { "Authorization": "Bearer test" },
          body: JSON.stringify({ test: true }),
        },
      });
      createdTaskIds.push(taskId);

      const task = await repo.getById(taskId);
      expect(task.config.url).to.equal("https://example.com/webhook");
      expect(task.config.method).to.equal("POST");
    });

    it("should set default retention days for cleanup tasks", async () => {
      const repo = useScheduledTaskRepo();

      const taskId = await repo.add({
        name: "Default Retention " + Date.now(),
        type: "cleanup",
        schedule: "0 0 * * *",
        config: {}, // No retentionDays specified
      });
      createdTaskIds.push(taskId);

      const task = await repo.getById(taskId);
      expect(task.config.retentionDays).to.equal(30); // Default value
    });
  });
});
