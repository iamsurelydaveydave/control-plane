import Joi from "joi";
import { ObjectId } from "mongodb";
import { BadRequestError } from "../../utils";

// ---------------------------------------------------------------------------
// Enums and Types
// ---------------------------------------------------------------------------

export const ssoProviders = ["saml", "oidc", "google", "github", "azure-ad", "okta"] as const;
export type TSSOProvider = (typeof ssoProviders)[number];

export type TSAMLConfig = {
  entryPoint: string; // IdP SSO URL
  issuer: string; // SP Entity ID
  cert: string; // IdP Certificate (PEM format)
  callbackUrl?: string; // ACS URL (auto-generated based on config ID)
  signatureAlgorithm?: "sha1" | "sha256" | "sha512";
  wantAssertionsSigned?: boolean;
  wantAuthnResponseSigned?: boolean;
  identifierFormat?: string;
};

export type TOIDCConfig = {
  clientId: string;
  clientSecret: string; // Encrypted at rest
  authorizationUrl?: string; // For generic OIDC; preset for known providers
  tokenUrl?: string;
  userInfoUrl?: string;
  scope?: string; // Default: 'openid email profile'
  responseType?: string; // Default: 'code'
};

export type TAttributeMapping = {
  email: string; // Default: 'email' (OIDC) or 'nameID' (SAML)
  name?: string; // Default: 'name' or 'displayName'
  firstName?: string;
  lastName?: string;
  groups?: string; // For auto-role assignment based on IdP groups
  avatar?: string;
};

export type TSSOConfig = {
  _id?: ObjectId;
  name: string; // Display name (e.g., "Company SSO")
  provider: TSSOProvider;
  enabled: boolean;

  // SAML configuration
  saml?: TSAMLConfig;

  // OIDC configuration (also used for Google, Azure AD, Okta, GitHub)
  oidc?: TOIDCConfig;

  // Attribute mapping from IdP claims to user fields
  attributeMapping?: TAttributeMapping;

  // Auto-provisioning settings
  autoProvision?: boolean; // Create user on first SSO login
  defaultRoleId?: ObjectId; // Role for auto-provisioned users

  // Organization scoping (for multi-tenant SSO)
  organizationId?: ObjectId;

  // Domain restrictions (only allow emails from these domains)
  allowedDomains?: string[];

  // Metadata
  createdAt?: Date;
  updatedAt?: Date;
};

// ---------------------------------------------------------------------------
// Well-known provider endpoints
// ---------------------------------------------------------------------------

export const OIDC_PROVIDER_DEFAULTS: Record<
  Extract<TSSOProvider, "google" | "github" | "azure-ad" | "okta">,
  Partial<TOIDCConfig>
> = {
  google: {
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid email profile",
  },
  github: {
    authorizationUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userInfoUrl: "https://api.github.com/user",
    scope: "read:user user:email",
  },
  "azure-ad": {
    // Tenant ID is appended at runtime: https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize
    authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    userInfoUrl: "https://graph.microsoft.com/oidc/userinfo",
    scope: "openid email profile",
  },
  okta: {
    // Domain is appended at runtime: https://{domain}/oauth2/default/v1/authorize
    scope: "openid email profile",
  },
};

export const DEFAULT_ATTRIBUTE_MAPPING: TAttributeMapping = {
  email: "email",
  name: "name",
  firstName: "given_name",
  lastName: "family_name",
  groups: "groups",
};

// ---------------------------------------------------------------------------
// Joi Schemas
// ---------------------------------------------------------------------------

const schemaSAMLConfig = Joi.object<TSAMLConfig>({
  entryPoint: Joi.string().uri().required(),
  issuer: Joi.string().required(),
  cert: Joi.string().required(),
  callbackUrl: Joi.string().uri().optional(),
  signatureAlgorithm: Joi.string().valid("sha1", "sha256", "sha512").optional(),
  wantAssertionsSigned: Joi.boolean().optional(),
  wantAuthnResponseSigned: Joi.boolean().optional(),
  identifierFormat: Joi.string().optional(),
});

const schemaOIDCConfig = Joi.object<TOIDCConfig>({
  clientId: Joi.string().required(),
  clientSecret: Joi.string().required(),
  authorizationUrl: Joi.string().uri().optional(),
  tokenUrl: Joi.string().uri().optional(),
  userInfoUrl: Joi.string().uri().optional(),
  scope: Joi.string().optional(),
  responseType: Joi.string().optional(),
});

const schemaAttributeMapping = Joi.object<TAttributeMapping>({
  email: Joi.string().required(),
  name: Joi.string().optional(),
  firstName: Joi.string().optional(),
  lastName: Joi.string().optional(),
  groups: Joi.string().optional(),
  avatar: Joi.string().optional(),
});

const schemaSSOConfigBase = {
  name: Joi.string().min(1).max(100).required(),
  provider: Joi.string()
    .valid(...ssoProviders)
    .required(),
  enabled: Joi.boolean().default(false),
  saml: schemaSAMLConfig.optional(),
  oidc: schemaOIDCConfig.optional(),
  attributeMapping: schemaAttributeMapping.optional(),
  autoProvision: Joi.boolean().default(true),
  defaultRoleId: Joi.string().optional(),
  organizationId: Joi.string().optional(),
  allowedDomains: Joi.array().items(Joi.string().hostname()).optional(),
};

export const schemaSSOConfigCreate = Joi.object<Partial<TSSOConfig>>(schemaSSOConfigBase).custom(
  (value, helpers) => {
    // Validate that the correct config is provided for the provider type
    if (value.provider === "saml" && !value.saml) {
      return helpers.error("any.required", { message: "SAML configuration is required for SAML provider" });
    }
    if (value.provider !== "saml" && !value.oidc) {
      return helpers.error("any.required", { message: "OIDC configuration is required for OIDC-based providers" });
    }
    return value;
  }
);

export const schemaSSOConfigUpdate = Joi.object<Partial<TSSOConfig>>({
  name: Joi.string().min(1).max(100).optional(),
  enabled: Joi.boolean().optional(),
  saml: schemaSAMLConfig.optional(),
  oidc: schemaOIDCConfig.optional(),
  attributeMapping: schemaAttributeMapping.optional(),
  autoProvision: Joi.boolean().optional(),
  defaultRoleId: Joi.string().optional().allow(null),
  allowedDomains: Joi.array().items(Joi.string().hostname()).optional(),
});

// Query params schema
export const schemaSSOConfigQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  provider: Joi.string()
    .valid(...ssoProviders)
    .optional(),
  enabled: Joi.boolean().optional(),
  organizationId: Joi.string().optional(),
});

// ---------------------------------------------------------------------------
// Model Factory
// ---------------------------------------------------------------------------

export function modelSSOConfig(data: Partial<TSSOConfig>): Omit<TSSOConfig, "_id"> {
  const { error, value } = schemaSSOConfigCreate.validate(data, { abortEarly: false });
  if (error) {
    throw new BadRequestError(`SSO config validation error: ${error.message}`);
  }

  // Cast ObjectId fields
  let defaultRoleId: ObjectId | undefined;
  if (value.defaultRoleId) {
    try {
      defaultRoleId = new ObjectId(value.defaultRoleId);
    } catch {
      throw new BadRequestError("Invalid defaultRoleId format");
    }
  }

  let organizationId: ObjectId | undefined;
  if (value.organizationId) {
    try {
      organizationId = new ObjectId(value.organizationId);
    } catch {
      throw new BadRequestError("Invalid organizationId format");
    }
  }

  // Apply provider defaults for OIDC providers
  let oidc = value.oidc;
  if (oidc && value.provider !== "saml" && value.provider !== "oidc") {
    const defaults = OIDC_PROVIDER_DEFAULTS[value.provider as keyof typeof OIDC_PROVIDER_DEFAULTS];
    if (defaults) {
      oidc = {
        ...defaults,
        ...oidc,
      };
    }
  }

  // Set default attribute mapping
  const attributeMapping = value.attributeMapping || { ...DEFAULT_ATTRIBUTE_MAPPING };
  if (value.provider === "saml" && !value.attributeMapping?.email) {
    attributeMapping.email = "nameID"; // SAML default
  }

  return {
    name: value.name!,
    provider: value.provider!,
    enabled: value.enabled ?? false,
    saml: value.saml,
    oidc,
    attributeMapping,
    autoProvision: value.autoProvision ?? true,
    defaultRoleId,
    organizationId,
    allowedDomains: value.allowedDomains,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Sanitize SSO config for API response (remove sensitive fields)
 */
export function sanitizeSSOConfig(config: TSSOConfig): Partial<TSSOConfig> {
  const sanitized = { ...config };

  // Mask client secret
  if (sanitized.oidc?.clientSecret) {
    sanitized.oidc = {
      ...sanitized.oidc,
      clientSecret: "********",
    };
  }

  // Mask SAML certificate (show only first/last lines)
  if (sanitized.saml?.cert) {
    const cert = sanitized.saml.cert;
    const lines = cert.split("\n").filter((l) => l.trim());
    if (lines.length > 2) {
      sanitized.saml = {
        ...sanitized.saml,
        cert: `${lines[0]}\n...[${lines.length - 2} lines]...\n${lines[lines.length - 1]}`,
      };
    }
  }

  return sanitized;
}
