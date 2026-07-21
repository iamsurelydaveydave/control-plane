import { expect } from "chai";
import { describe, it, afterEach } from "mocha";
import { ObjectId } from "mongodb";
import {
  useSSOConfigRepo,
  TSSOConfig,
  ssoProviders,
  modelSSOConfig,
  sanitizeSSOConfig,
} from "../src/resources/sso-config";

describe("SSO Config Resource", function () {
  this.timeout(10000);

  const createdIds: string[] = [];

  afterEach(async () => {
    // Clean up: delete all test configs
    const repo = useSSOConfigRepo();
    for (const id of createdIds) {
      try {
        await repo.deleteById(id);
      } catch {
        // Ignore errors during cleanup
      }
    }
    createdIds.length = 0;
  });

  describe("SSO Config Model", () => {
    it("should validate a SAML config", () => {
      const config = modelSSOConfig({
        name: "Test SAML SSO",
        provider: "saml",
        enabled: false,
        saml: {
          entryPoint: "https://idp.example.com/sso",
          issuer: "https://my-app.example.com/saml/metadata",
          cert: "-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----",
          callbackUrl: "https://my-app.example.com/api/sso/callback/saml",
        },
      });

      expect(config.name).to.equal("Test SAML SSO");
      expect(config.provider).to.equal("saml");
      expect(config.enabled).to.be.false;
      expect(config.saml).to.exist;
      expect(config.saml?.entryPoint).to.equal("https://idp.example.com/sso");
      expect(config.autoProvision).to.be.true; // Default
    });

    it("should validate an OIDC config", () => {
      const config = modelSSOConfig({
        name: "Test OIDC SSO",
        provider: "oidc",
        enabled: true,
        oidc: {
          clientId: "my-client-id",
          clientSecret: "my-secret",
          authorizationUrl: "https://auth.example.com/authorize",
          tokenUrl: "https://auth.example.com/token",
          userInfoUrl: "https://auth.example.com/userinfo",
        },
      });

      expect(config.name).to.equal("Test OIDC SSO");
      expect(config.provider).to.equal("oidc");
      expect(config.enabled).to.be.true;
      expect(config.oidc).to.exist;
      expect(config.oidc?.clientId).to.equal("my-client-id");
    });

    it("should validate a Google provider config with defaults", () => {
      const config = modelSSOConfig({
        name: "Google SSO",
        provider: "google",
        enabled: true,
        oidc: {
          clientId: "google-client-id",
          clientSecret: "google-secret",
        },
      });

      expect(config.provider).to.equal("google");
      expect(config.oidc).to.exist;
      // Google provider should have default URLs populated
      expect(config.oidc?.authorizationUrl).to.include("accounts.google.com");
      expect(config.oidc?.tokenUrl).to.include("googleapis.com");
    });

    it("should reject SAML config without saml configuration", () => {
      try {
        modelSSOConfig({
          name: "Invalid SAML",
          provider: "saml",
          enabled: false,
        });
        expect.fail("Should have thrown validation error");
      } catch (error: any) {
        expect(error.message).to.include("SAML configuration is required");
      }
    });

    it("should reject OIDC provider without oidc configuration", () => {
      try {
        modelSSOConfig({
          name: "Invalid OIDC",
          provider: "google",
          enabled: false,
        });
        expect.fail("Should have thrown validation error");
      } catch (error: any) {
        expect(error.message).to.include("OIDC configuration is required");
      }
    });

    it("should handle ObjectId conversion for defaultRoleId", () => {
      const roleId = new ObjectId().toString();
      const config = modelSSOConfig({
        name: "With Role",
        provider: "oidc",
        enabled: false,
        oidc: {
          clientId: "test",
          clientSecret: "secret",
          authorizationUrl: "https://example.com/auth",
          tokenUrl: "https://example.com/token",
          userInfoUrl: "https://example.com/userinfo",
        },
        defaultRoleId: roleId as any, // string input gets converted to ObjectId
      });

      expect(config.defaultRoleId).to.be.instanceOf(ObjectId);
      expect(config.defaultRoleId?.toString()).to.equal(roleId);
    });

    it("should set default attribute mapping", () => {
      const config = modelSSOConfig({
        name: "Default Mapping",
        provider: "oidc",
        enabled: false,
        oidc: {
          clientId: "test",
          clientSecret: "secret",
          authorizationUrl: "https://example.com/auth",
          tokenUrl: "https://example.com/token",
          userInfoUrl: "https://example.com/userinfo",
        },
      });

      expect(config.attributeMapping).to.exist;
      expect(config.attributeMapping?.email).to.equal("email");
    });

    it("should use nameID as default email mapping for SAML", () => {
      const config = modelSSOConfig({
        name: "SAML Default Mapping",
        provider: "saml",
        enabled: false,
        saml: {
          entryPoint: "https://idp.example.com/sso",
          issuer: "https://sp.example.com",
          cert: "CERT",
        },
      });

      expect(config.attributeMapping?.email).to.equal("nameID");
    });
  });

  describe("SSO Config Sanitization", () => {
    it("should mask client secret in sanitized output", () => {
      const config: TSSOConfig = {
        _id: new ObjectId(),
        name: "Test",
        provider: "oidc",
        enabled: true,
        oidc: {
          clientId: "my-client",
          clientSecret: "super-secret-value",
          authorizationUrl: "https://example.com/auth",
          tokenUrl: "https://example.com/token",
          userInfoUrl: "https://example.com/userinfo",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const sanitized = sanitizeSSOConfig(config);

      expect(sanitized.oidc?.clientId).to.equal("my-client");
      expect(sanitized.oidc?.clientSecret).to.equal("********");
    });

    it("should truncate SAML certificate in sanitized output", () => {
      const longCert = [
        "-----BEGIN CERTIFICATE-----",
        "MIICwTCCAamgAwIBAgIJALvOsZE9lxU2MA0GCSqGSIb3DQEBCwUAMBQxEjAQBgNV",
        "BAMMCWxvY2FsaG9zdDAeFw0yMDA0MDkxNjM4MzlaFw0yMTA0MDkxNjM4MzlaMBQx",
        "EjAQBgNVBAMMCWxvY2FsaG9zdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoC",
        "-----END CERTIFICATE-----",
      ].join("\n");

      const config: TSSOConfig = {
        _id: new ObjectId(),
        name: "Test SAML",
        provider: "saml",
        enabled: true,
        saml: {
          entryPoint: "https://idp.example.com",
          issuer: "sp",
          cert: longCert,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const sanitized = sanitizeSSOConfig(config);

      expect(sanitized.saml?.cert).to.include("...[");
      expect(sanitized.saml?.cert).to.include("lines]...");
    });
  });

  describe("SSO Config Repository", () => {
    it("should create a new SSO config", async () => {
      const repo = useSSOConfigRepo();

      const id = await repo.add({
        name: "Test SSO Config",
        provider: "google",
        enabled: false,
        oidc: {
          clientId: "google-client",
          clientSecret: "google-secret",
        },
      });

      createdIds.push(id.toString());

      expect(id).to.exist;
      expect(id).to.be.instanceOf(ObjectId);
    });

    it("should get SSO config by ID", async () => {
      const repo = useSSOConfigRepo();

      const id = await repo.add({
        name: "Get By ID Test",
        provider: "okta",
        enabled: true,
        oidc: {
          clientId: "okta-client",
          clientSecret: "okta-secret",
        },
      });

      createdIds.push(id.toString());

      const config = await repo.getById(id.toString());

      expect(config).to.exist;
      expect(config.name).to.equal("Get By ID Test");
      expect(config.provider).to.equal("okta");
    });

    it("should list all SSO configs with pagination", async () => {
      const repo = useSSOConfigRepo();

      // Create multiple configs
      const id1 = await repo.add({
        name: "Config 1",
        provider: "google",
        enabled: true,
        oidc: { clientId: "c1", clientSecret: "s1" },
      });
      const id2 = await repo.add({
        name: "Config 2",
        provider: "github",
        enabled: false,
        oidc: { clientId: "c2", clientSecret: "s2" },
      });

      createdIds.push(id1.toString(), id2.toString());

      const result = await repo.getAll({ page: 1, limit: 10 });

      expect(result.items).to.be.an("array");
      expect(result.items.length).to.be.at.least(2);
      expect(result.pages).to.be.at.least(1);
    });

    it("should filter by provider", async () => {
      const repo = useSSOConfigRepo();

      const id1 = await repo.add({
        name: "Google Only",
        provider: "google",
        enabled: true,
        oidc: { clientId: "g", clientSecret: "s" },
      });
      const id2 = await repo.add({
        name: "GitHub Only",
        provider: "github",
        enabled: true,
        oidc: { clientId: "gh", clientSecret: "s" },
      });

      createdIds.push(id1.toString(), id2.toString());

      const googleConfigs = await repo.getAll({ provider: "google" });
      const googleNames = googleConfigs.items.map((c: any) => c.name);

      expect(googleNames).to.include("Google Only");
      expect(googleNames).to.not.include("GitHub Only");
    });

    it("should get only enabled configs", async () => {
      const repo = useSSOConfigRepo();

      const id1 = await repo.add({
        name: "Enabled Config",
        provider: "google",
        enabled: true,
        oidc: { clientId: "e", clientSecret: "s" },
      });
      const id2 = await repo.add({
        name: "Disabled Config",
        provider: "google",
        enabled: false,
        oidc: { clientId: "d", clientSecret: "s" },
      });

      createdIds.push(id1.toString(), id2.toString());

      const enabledConfigs = await repo.getEnabledConfigs();
      const enabledNames = enabledConfigs.map((c) => c.name);

      expect(enabledNames).to.include("Enabled Config");
      expect(enabledNames).to.not.include("Disabled Config");
    });

    it("should update an SSO config", async () => {
      const repo = useSSOConfigRepo();

      const id = await repo.add({
        name: "Before Update",
        provider: "google",
        enabled: false,
        oidc: { clientId: "old", clientSecret: "old" },
      });

      createdIds.push(id.toString());

      await repo.updateById(id.toString(), { name: "After Update", enabled: true });

      const updated = await repo.getById(id.toString());

      expect(updated.name).to.equal("After Update");
      expect(updated.enabled).to.be.true;
    });

    it("should toggle enabled status", async () => {
      const repo = useSSOConfigRepo();

      const id = await repo.add({
        name: "Toggle Test",
        provider: "google",
        enabled: false,
        oidc: { clientId: "t", clientSecret: "s" },
      });

      createdIds.push(id.toString());

      // Enable
      await repo.setEnabled(id.toString(), true);
      let config = await repo.getById(id.toString());
      expect(config.enabled).to.be.true;

      // Disable
      await repo.setEnabled(id.toString(), false);
      config = await repo.getById(id.toString());
      expect(config.enabled).to.be.false;
    });

    it("should delete an SSO config", async () => {
      const repo = useSSOConfigRepo();

      const id = await repo.add({
        name: "To Delete",
        provider: "google",
        enabled: false,
        oidc: { clientId: "d", clientSecret: "s" },
      });

      await repo.deleteById(id.toString());

      try {
        await repo.getById(id.toString());
        expect.fail("Should have thrown NotFoundError");
      } catch (error: any) {
        expect(error.message).to.include("not found");
      }
    });

    it("should reject duplicate names", async () => {
      const repo = useSSOConfigRepo();

      const id1 = await repo.add({
        name: "Unique Name",
        provider: "google",
        enabled: false,
        oidc: { clientId: "u1", clientSecret: "s" },
      });

      createdIds.push(id1.toString());

      try {
        await repo.add({
          name: "Unique Name",
          provider: "github",
          enabled: false,
          oidc: { clientId: "u2", clientSecret: "s" },
        });
        expect.fail("Should have thrown error for duplicate name");
      } catch (error: any) {
        expect(error.message).to.include("already exists");
      }
    });
  });

  describe("SSO Provider Types", () => {
    it("should have all expected providers", () => {
      expect(ssoProviders).to.include("saml");
      expect(ssoProviders).to.include("oidc");
      expect(ssoProviders).to.include("google");
      expect(ssoProviders).to.include("github");
      expect(ssoProviders).to.include("azure-ad");
      expect(ssoProviders).to.include("okta");
    });
  });
});
