import { expect } from "chai";
import { describe, it, before, after } from "mocha";
import { useUserRepo, useUserService } from "../src/resources";
import { hashPassword } from "../src/utils";

describe("User Resource", function () {
  this.timeout(10000);

  const testEmail = `test-${Date.now()}@example.com`;
  const testPassword = "testpassword123";
  let createdUserId: string;

  describe("User Repository", () => {
    it("should create a user", async () => {
      const repo = useUserRepo();
      const hashedPassword = await hashPassword(testPassword);
      
      const userId = await repo.add({
        email: testEmail,
        password: hashedPassword,
      });

      expect(userId).to.exist;
      createdUserId = userId.toString();
    });

    it("should get user by email", async () => {
      const repo = useUserRepo();
      const user = await repo.getByEmail(testEmail);

      expect(user).to.exist;
      expect(user?.email).to.equal(testEmail);
    });

    it("should get user by id", async () => {
      const repo = useUserRepo();
      const user = await repo.getById(createdUserId);

      expect(user).to.exist;
      expect(user?.email).to.equal(testEmail);
    });
  });

  describe("User Service", () => {
    it("should not create duplicate admin when one exists", async () => {
      const service = useUserService();
      const result = await service.ensureDefaultAdmin(
        "another@example.com",
        "password123"
      );

      // Should return null since a user already exists
      expect(result).to.be.null;
    });
  });
});
