import crypto from "crypto";
import { ObjectId } from "mongodb";
import {
  TSSOConfig,
  OIDC_PROVIDER_DEFAULTS,
  DEFAULT_ATTRIBUTE_MAPPING,
} from "../resources/sso-config/sso.config.model";
import { useUserRepo, TUser } from "../resources/user";
import { hashPassword, useSessionStore, generateSessionId, logger, BadRequestError, InternalServerError } from "../utils";
import { DOMAIN, SESSION_TTL_SECONDS } from "../config";

// ---------------------------------------------------------------------------
// State Management (for OIDC CSRF protection)
// ---------------------------------------------------------------------------

// In-memory state store with TTL (in production, use Redis)
const stateStore = new Map<string, { configId: string; relayState?: string; expiresAt: number }>();

function generateState(configId: string, relayState?: string): string {
  const state = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
  stateStore.set(state, { configId, relayState, expiresAt });
  return state;
}

function validateState(state: string, configId: string): { relayState?: string } | null {
  const data = stateStore.get(state);
  if (!data) return null;

  stateStore.delete(state);

  if (data.expiresAt < Date.now()) return null;
  if (data.configId !== configId) return null;

  return { relayState: data.relayState };
}

// Clean up expired states periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of stateStore.entries()) {
    if (value.expiresAt < now) {
      stateStore.delete(key);
    }
  }
}, 60 * 1000);

// ---------------------------------------------------------------------------
// SAML Helpers
// ---------------------------------------------------------------------------

function buildCallbackUrl(configId: string, protocol: "saml" | "oidc"): string {
  // Build the callback URL based on the app domain
  const baseUrl = `https://api.${DOMAIN}`;
  return `${baseUrl}/api/sso/${configId}/callback/${protocol}`;
}

// ---------------------------------------------------------------------------
// SSO Service
// ---------------------------------------------------------------------------

export function useSSOService() {
  const userRepo = useUserRepo();
  const sessionStore = useSessionStore();

  // -------------------------------------------------------------------------
  // SAML Login Flow
  // -------------------------------------------------------------------------

  async function initiateSAMLLogin(config: TSSOConfig): Promise<string> {
    if (!config.saml) {
      throw new BadRequestError("SAML configuration missing");
    }

    const { entryPoint, issuer } = config.saml;
    const callbackUrl = config.saml.callbackUrl || buildCallbackUrl(String(config._id), "saml");

    // Build SAML AuthnRequest
    const id = `_${crypto.randomBytes(16).toString("hex")}`;
    const issueInstant = new Date().toISOString();

    const authnRequest = `<?xml version="1.0" encoding="UTF-8"?>
<samlp:AuthnRequest
    xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
    xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
    ID="${id}"
    Version="2.0"
    IssueInstant="${issueInstant}"
    Destination="${entryPoint}"
    AssertionConsumerServiceURL="${callbackUrl}"
    ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">
    <saml:Issuer>${issuer}</saml:Issuer>
    <samlp:NameIDPolicy
        Format="${config.saml.identifierFormat || "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"}"
        AllowCreate="true"/>
</samlp:AuthnRequest>`;

    // Deflate and base64 encode for redirect binding
    const { deflateRaw } = await import("zlib");
    const deflated = await new Promise<Buffer>((resolve, reject) => {
      deflateRaw(authnRequest, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    const samlRequest = encodeURIComponent(deflated.toString("base64"));
    const redirectUrl = `${entryPoint}?SAMLRequest=${samlRequest}`;

    logger.log({
      level: "debug",
      message: `Initiated SAML login for config ${config._id}`,
    });

    return redirectUrl;
  }

  async function handleSAMLCallback(
    config: TSSOConfig,
    samlResponse: string
  ): Promise<{ user: TUser; sessionId: string }> {
    if (!config.saml) {
      throw new BadRequestError("SAML configuration missing");
    }

    try {
      // Decode the SAML response
      const xml = Buffer.from(samlResponse, "base64").toString("utf-8");

      // Parse and validate the SAML response
      // In production, use a library like @node-saml/node-saml for proper validation
      const attributes = parseSAMLResponse(xml, config);

      // Extract user info based on attribute mapping
      const mapping = config.attributeMapping || DEFAULT_ATTRIBUTE_MAPPING;
      const email = attributes[mapping.email];

      if (!email) {
        throw new BadRequestError("Email not found in SAML response");
      }

      // Validate domain restrictions
      if (config.allowedDomains?.length) {
        const domain = email.split("@")[1]?.toLowerCase();
        if (!config.allowedDomains.map((d) => d.toLowerCase()).includes(domain)) {
          throw new BadRequestError(`Email domain ${domain} is not allowed`);
        }
      }

      // Find or create user
      const name = attributes[mapping.name || "name"] || attributes["displayName"] || email.split("@")[0];
      const user = await findOrCreateUser(email, name, config);

      // Create session
      const sessionId = await createSSOSession(user);

      logger.log({
        level: "info",
        message: `SAML login successful for ${email} via ${config.name}`,
      });

      return { user, sessionId };
    } catch (error) {
      logger.log({
        level: "error",
        message: `SAML callback error: ${error}`,
      });
      if (error instanceof BadRequestError) {
        throw error;
      }
      throw new InternalServerError("Failed to process SAML response");
    }
  }

  // -------------------------------------------------------------------------
  // OIDC Login Flow
  // -------------------------------------------------------------------------

  async function initiateOIDCLogin(config: TSSOConfig, relayState?: string): Promise<string> {
    if (!config.oidc) {
      throw new BadRequestError("OIDC configuration missing");
    }

    const configId = String(config._id);
    const state = generateState(configId, relayState);
    const callbackUrl = buildCallbackUrl(configId, "oidc");

    // Get provider-specific URLs
    let authorizationUrl = config.oidc.authorizationUrl;
    if (!authorizationUrl && config.provider !== "oidc") {
      const defaults = OIDC_PROVIDER_DEFAULTS[config.provider as keyof typeof OIDC_PROVIDER_DEFAULTS];
      authorizationUrl = defaults?.authorizationUrl;
    }

    if (!authorizationUrl) {
      throw new BadRequestError("Authorization URL not configured");
    }

    const scope = config.oidc.scope || "openid email profile";
    const responseType = config.oidc.responseType || "code";

    const params = new URLSearchParams({
      client_id: config.oidc.clientId,
      redirect_uri: callbackUrl,
      response_type: responseType,
      scope,
      state,
    });

    // Provider-specific parameters
    if (config.provider === "google") {
      params.append("access_type", "offline");
      params.append("prompt", "select_account");
    }

    const redirectUrl = `${authorizationUrl}?${params.toString()}`;

    logger.log({
      level: "debug",
      message: `Initiated OIDC login for config ${config._id} (${config.provider})`,
    });

    return redirectUrl;
  }

  async function handleOIDCCallback(
    config: TSSOConfig,
    code: string,
    state?: string
  ): Promise<{ user: TUser; sessionId: string }> {
    if (!config.oidc) {
      throw new BadRequestError("OIDC configuration missing");
    }

    const configId = String(config._id);

    // Validate state
    if (state) {
      const stateData = validateState(state, configId);
      if (!stateData) {
        throw new BadRequestError("Invalid or expired state parameter");
      }
    }

    try {
      // Exchange code for tokens
      const tokens = await exchangeCodeForTokens(config, code);

      // Get user info
      const userInfo = await fetchUserInfo(config, tokens.access_token);

      // Extract user info based on attribute mapping
      const mapping = config.attributeMapping || DEFAULT_ATTRIBUTE_MAPPING;
      const email = userInfo[mapping.email] || userInfo.email;

      if (!email) {
        throw new BadRequestError("Email not found in user info");
      }

      // Validate domain restrictions
      if (config.allowedDomains?.length) {
        const domain = email.split("@")[1]?.toLowerCase();
        if (!config.allowedDomains.map((d) => d.toLowerCase()).includes(domain)) {
          throw new BadRequestError(`Email domain ${domain} is not allowed`);
        }
      }

      // Build name from available fields
      let name = userInfo[mapping.name || "name"];
      if (!name && mapping.firstName && mapping.lastName) {
        const firstName = userInfo[mapping.firstName];
        const lastName = userInfo[mapping.lastName];
        if (firstName || lastName) {
          name = [firstName, lastName].filter(Boolean).join(" ");
        }
      }
      if (!name) {
        name = email.split("@")[0];
      }

      // Find or create user
      const user = await findOrCreateUser(email, name, config);

      // Create session
      const sessionId = await createSSOSession(user);

      logger.log({
        level: "info",
        message: `OIDC login successful for ${email} via ${config.name} (${config.provider})`,
      });

      return { user, sessionId };
    } catch (error) {
      logger.log({
        level: "error",
        message: `OIDC callback error: ${error}`,
      });
      if (error instanceof BadRequestError) {
        throw error;
      }
      throw new InternalServerError("Failed to process OIDC callback");
    }
  }

  // -------------------------------------------------------------------------
  // Helper Functions
  // -------------------------------------------------------------------------

  async function findOrCreateUser(email: string, name: string, config: TSSOConfig): Promise<TUser> {
    // Check if user exists
    let user = await userRepo.getByEmail(email);

    if (user) {
      return user;
    }

    // Auto-provision if enabled
    if (!config.autoProvision) {
      throw new BadRequestError("User not found and auto-provisioning is disabled");
    }

    // Create new user with random password (SSO users don't use passwords)
    const randomPassword = crypto.randomBytes(32).toString("hex");
    const hashedPassword = await hashPassword(randomPassword);

    const userId = await userRepo.add({
      email,
      password: hashedPassword,
      roleId: config.defaultRoleId,
    });

    user = await userRepo.getById(userId.toString());
    if (!user) {
      throw new InternalServerError("Failed to create user");
    }

    logger.log({
      level: "info",
      message: `Auto-provisioned user ${email} via SSO config ${config.name}`,
    });

    return user;
  }

  async function createSSOSession(user: TUser): Promise<string> {
    const sid = generateSessionId();
    const userId = String(user._id);

    await sessionStore.set(
      sid,
      { userId, email: user.email, createdAt: Date.now() },
      SESSION_TTL_SECONDS
    );

    return sid;
  }

  function generateSAMLMetadata(config: TSSOConfig): string {
    if (!config.saml) {
      throw new BadRequestError("SAML configuration missing");
    }

    const entityId = config.saml.issuer;
    const callbackUrl = config.saml.callbackUrl || buildCallbackUrl(String(config._id), "saml");

    return `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
    entityID="${entityId}">
    <md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="${config.saml.wantAssertionsSigned ?? true}"
        protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
        <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
        <md:AssertionConsumerService
            Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
            Location="${callbackUrl}"
            index="0"/>
    </md:SPSSODescriptor>
</md:EntityDescriptor>`;
  }

  return {
    initiateSAMLLogin,
    handleSAMLCallback,
    initiateOIDCLogin,
    handleOIDCCallback,
    findOrCreateUser,
    generateSAMLMetadata,
  };
}

// ---------------------------------------------------------------------------
// Private Helpers
// ---------------------------------------------------------------------------

function parseSAMLResponse(xml: string, config: TSSOConfig): Record<string, string> {
  // Simple XML parsing for SAML attributes
  // In production, use a proper SAML library for signature validation
  const attributes: Record<string, string> = {};

  // Extract NameID
  const nameIdMatch = xml.match(/<saml:NameID[^>]*>([^<]+)<\/saml:NameID>/);
  if (nameIdMatch) {
    attributes.nameID = nameIdMatch[1];
    // Default email to nameID for email format
    if (nameIdMatch[1].includes("@")) {
      attributes.email = nameIdMatch[1];
    }
  }

  // Extract Attributes
  const attrRegex = /<saml:Attribute[^>]*Name="([^"]+)"[^>]*>[\s\S]*?<saml:AttributeValue[^>]*>([^<]+)<\/saml:AttributeValue>/g;
  let match;
  while ((match = attrRegex.exec(xml)) !== null) {
    const name = match[1];
    const value = match[2];
    // Map common SAML attribute names
    if (name.includes("emailaddress") || name.includes("email")) {
      attributes.email = value;
    } else if (name.includes("displayname") || name.includes("name")) {
      attributes.name = value;
    } else if (name.includes("givenname") || name.includes("firstname")) {
      attributes.given_name = value;
    } else if (name.includes("surname") || name.includes("lastname")) {
      attributes.family_name = value;
    } else {
      // Store with the original name
      const shortName = name.split("/").pop() || name;
      attributes[shortName.toLowerCase()] = value;
    }
  }

  logger.log({
    level: "debug",
    message: `Parsed SAML attributes: ${JSON.stringify(Object.keys(attributes))}`,
  });

  return attributes;
}

async function exchangeCodeForTokens(
  config: TSSOConfig,
  code: string
): Promise<{ access_token: string; id_token?: string; refresh_token?: string }> {
  if (!config.oidc) {
    throw new BadRequestError("OIDC configuration missing");
  }

  // Get token URL
  let tokenUrl = config.oidc.tokenUrl;
  if (!tokenUrl && config.provider !== "oidc") {
    const defaults = OIDC_PROVIDER_DEFAULTS[config.provider as keyof typeof OIDC_PROVIDER_DEFAULTS];
    tokenUrl = defaults?.tokenUrl;
  }

  if (!tokenUrl) {
    throw new BadRequestError("Token URL not configured");
  }

  const callbackUrl = buildCallbackUrl(String(config._id), "oidc");

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl,
    client_id: config.oidc.clientId,
    client_secret: config.oidc.clientSecret,
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.log({
      level: "error",
      message: `Token exchange failed: ${response.status} - ${errorText}`,
    });
    throw new BadRequestError("Failed to exchange authorization code");
  }

  const data = await response.json() as { access_token: string; id_token?: string; refresh_token?: string };
  return data;
}

async function fetchUserInfo(
  config: TSSOConfig,
  accessToken: string
): Promise<Record<string, any>> {
  if (!config.oidc) {
    throw new BadRequestError("OIDC configuration missing");
  }

  // Get userinfo URL
  let userInfoUrl = config.oidc.userInfoUrl;
  if (!userInfoUrl && config.provider !== "oidc") {
    const defaults = OIDC_PROVIDER_DEFAULTS[config.provider as keyof typeof OIDC_PROVIDER_DEFAULTS];
    userInfoUrl = defaults?.userInfoUrl;
  }

  if (!userInfoUrl) {
    throw new BadRequestError("UserInfo URL not configured");
  }

  const response = await fetch(userInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.log({
      level: "error",
      message: `UserInfo fetch failed: ${response.status} - ${errorText}`,
    });
    throw new BadRequestError("Failed to fetch user info");
  }

  const data = await response.json() as Record<string, any>;

  // GitHub special handling: need to fetch email separately if not included
  if (config.provider === "github" && !data.email) {
    const emailsResponse = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (emailsResponse.ok) {
      const emails = await emailsResponse.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
      const primaryEmail = emails.find((e) => e.primary && e.verified);
      if (primaryEmail) {
        data.email = primaryEmail.email;
      }
    }
  }

  return data;
}
