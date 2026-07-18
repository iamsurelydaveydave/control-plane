import { expect } from "chai";
import { describe, it, beforeEach, afterEach } from "mocha";
import { ObjectId } from "mongodb";
import { useAPITokenRepo } from "../src/resources/api-token/api-token.repository";
import { useAPITokenService } from "../src/resources/api-token/api-token.service";

describe("API Token Resource", function () {
  this.timeout(10000);

  let testUserId: ObjectId;
  let createdTokenId: string;
  let plainToken: string;

  beforeEach(() => {
    testUserId = new ObjectId();
  });

  afterEach(async () => {
    // Clean up: delete all tokens for test user
    const repo = useAPITokenRepo();
    await repo.deleteAllByUser(testUserId);
  });

  describe("API Token Service", () => {
    it("should generate a token with cp_ prefix", () => {
      const service = useAPITokenService();
      const token = service.generateToken();

      expect(token).to.exist;
      expect(token).to.match(/^cp_[A-Za-z0-9_-]+$/);
      expect(token.length).to.be.greaterThan(8);
    });

    it("should hash a token deterministically", () => {
      const service = useAPITokenService();
      const token = "cp_test123456789";
      const hash1 = service.hashToken(token);
      const hash2 = service.hashToken(token);

      expect(hash1).to.equal(hash2);
      expect(hash1).to.have.lengthOf(64); // SHA256 hex
    });

    it("should create a new API token", async () => {
      const service = useAPITokenService();
      const result = await service.create(
        testUserId.toString(),
        "Test Token",
        ["servers:read"],
        undefined
      );

      expect(result.token).to.exist;
      expect(result.plainToken).to.exist;
      expect(result.plainToken).to.match(/^cp_/);
      expect(result.token.name).to.equal("Test Token");
      expect(result.token.scopes).to.deep.equal(["servers:read"]);
      expect(result.token.tokenPrefix).to.equal(result.plainToken.substring(0, 8));

      createdTokenId = result.token._id!.toString();
      plainToken = result.plainToken;
    });

    it("should validate a valid token", async () => {
      const service = useAPITokenService();

      // Create a token first
      const { plainToken: newToken } = await service.create(
        testUserId.toString(),
        "Validate Test",
        ["*"]
      );

      // Validate it
      const validated = await service.validateToken(newToken);

      expect(validated).to.exist;
      expect(validated?.name).to.equal("Validate Test");
      expect(validated?.scopes).to.deep.equal(["*"]);
    });

    it("should reject an invalid token", async () => {
      const service = useAPITokenService();
      const validated = await service.validateToken("cp_invalidtoken12345");

      expect(validated).to.be.null;
    });

    it("should reject a token without cp_ prefix", async () => {
      const service = useAPITokenService();
      const validated = await service.validateToken("invalidtoken12345");

      expect(validated).to.be.null;
    });

    it("should reject an expired token", async () => {
      const service = useAPITokenService();

      // Create a token that expired yesterday
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const { plainToken: expiredToken } = await service.create(
        testUserId.toString(),
        "Expired Token",
        ["*"],
        yesterday
      );

      const validated = await service.validateToken(expiredToken);
      expect(validated).to.be.null;
    });

    it("should check scope correctly", async () => {
      const service = useAPITokenService();
      const repo = useAPITokenRepo();

      // Create token with limited scopes
      const { token: publicToken, plainToken: pt } = await service.create(
        testUserId.toString(),
        "Limited Scope",
        ["servers:read", "apps:read"]
      );

      const fullToken = await repo.getById(publicToken._id!);
      expect(fullToken).to.exist;

      expect(service.hasScope(fullToken!, "servers:read")).to.be.true;
      expect(service.hasScope(fullToken!, "apps:read")).to.be.true;
      expect(service.hasScope(fullToken!, "servers:write")).to.be.false;
      expect(service.hasScope(fullToken!, "databases:read")).to.be.false;
    });

    it("should allow all scopes with wildcard", async () => {
      const service = useAPITokenService();
      const repo = useAPITokenRepo();

      const { token: publicToken } = await service.create(
        testUserId.toString(),
        "Full Access",
        ["*"]
      );

      const fullToken = await repo.getById(publicToken._id!);
      expect(fullToken).to.exist;

      expect(service.hasScope(fullToken!, "servers:read")).to.be.true;
      expect(service.hasScope(fullToken!, "servers:write")).to.be.true;
      expect(service.hasScope(fullToken!, "databases:write")).to.be.true;
    });

    it("should get all tokens for a user", async () => {
      const service = useAPITokenService();

      // Create multiple tokens
      await service.create(testUserId.toString(), "Token 1");
      await service.create(testUserId.toString(), "Token 2");

      const tokens = await service.getAllForUser(testUserId.toString());

      expect(tokens).to.have.lengthOf(2);
      // Tokens should not include the actual token hash
      tokens.forEach((t) => {
        expect(t).to.not.have.property("token");
      });
    });

    it("should delete a token", async () => {
      const service = useAPITokenService();

      const { token } = await service.create(testUserId.toString(), "To Delete");
      const deleted = await service.deleteToken(token._id!.toString());

      expect(deleted).to.be.true;

      // Verify it's gone
      const tokens = await service.getAllForUser(testUserId.toString());
      expect(tokens).to.have.lengthOf(0);
    });
  });

  describe("API Token Repository", () => {
    it("should not allow duplicate token names per user", async () => {
      const repo = useAPITokenRepo();
      const service = useAPITokenService();

      await service.create(testUserId.toString(), "Duplicate Name");

      try {
        await service.create(testUserId.toString(), "Duplicate Name");
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        expect(error.message).to.include("already exists");
      }
    });

    it("should update lastUsedAt on validation", async () => {
      const service = useAPITokenService();
      const repo = useAPITokenRepo();

      const { plainToken: pt, token } = await service.create(
        testUserId.toString(),
        "Track Usage"
      );

      // Initially lastUsedAt should be undefined or null
      let storedToken = await repo.getById(token._id!);
      expect(storedToken?.lastUsedAt).to.not.exist;

      // Validate the token
      await service.validateToken(pt);

      // Wait a bit for the async update
      await new Promise((r) => setTimeout(r, 200));

      // Now lastUsedAt should be set
      storedToken = await repo.getById(token._id!);
      expect(storedToken?.lastUsedAt).to.exist;
    });
  });
});
