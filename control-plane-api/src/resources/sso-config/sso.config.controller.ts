import { Request, Response, NextFunction } from "express";
import { useSSOConfigRepo } from "./sso.config.repository";
import { useSSOService } from "../../services/sso.service";
import {
  schemaSSOConfigCreate,
  schemaSSOConfigUpdate,
  schemaSSOConfigQuery,
  sanitizeSSOConfig,
  TSSOConfig,
} from "./sso.config.model";
import { BadRequestError } from "../../utils";

export function useSSOConfigController() {
  const repo = useSSOConfigRepo();
  const ssoService = useSSOService();

  // Helper to extract string id from params
  function extractId(req: Request): string {
    const id = req.params.id;
    if (Array.isArray(id)) {
      throw new BadRequestError("Invalid ID format");
    }
    return id;
  }

  // ---------------------------------------------------------------------------
  // Admin CRUD endpoints
  // ---------------------------------------------------------------------------

  async function list(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaSSOConfigQuery.validate(req.query);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const result = await repo.getAll({
        page: value.page,
        limit: value.limit,
        provider: value.provider,
        enabled: value.enabled,
        organizationId: value.organizationId,
      });

      // Sanitize sensitive fields
      const sanitizedItems = (result.items as TSSOConfig[]).map(sanitizeSSOConfig);

      res.json({
        ...result,
        items: sanitizedItems,
      });
    } catch (error) {
      next(error);
    }
  }

  async function get(req: Request, res: Response, next: NextFunction) {
    try {
      const id = extractId(req);
      const config = await repo.getById(id);
      res.json({ ssoConfig: sanitizeSSOConfig(config) });
    } catch (error) {
      next(error);
    }
  }

  async function add(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaSSOConfigCreate.validate(req.body, { abortEarly: false });
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const ssoConfigId = await repo.add(value);

      res.status(201).json({
        message: "SSO config created",
        ssoConfigId: ssoConfigId.toString(),
      });
    } catch (error) {
      next(error);
    }
  }

  async function update(req: Request, res: Response, next: NextFunction) {
    try {
      const id = extractId(req);
      const { error, value } = schemaSSOConfigUpdate.validate(req.body, { abortEarly: false });
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      await repo.updateById(id, value);

      res.json({ message: "SSO config updated" });
    } catch (error) {
      next(error);
    }
  }

  async function remove(req: Request, res: Response, next: NextFunction) {
    try {
      const id = extractId(req);
      await repo.deleteById(id);
      res.json({ message: "SSO config deleted" });
    } catch (error) {
      next(error);
    }
  }

  async function enable(req: Request, res: Response, next: NextFunction) {
    try {
      const id = extractId(req);
      await repo.setEnabled(id, true);
      res.json({ message: "SSO config enabled" });
    } catch (error) {
      next(error);
    }
  }

  async function disable(req: Request, res: Response, next: NextFunction) {
    try {
      const id = extractId(req);
      await repo.setEnabled(id, false);
      res.json({ message: "SSO config disabled" });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // SAML Metadata endpoint
  // ---------------------------------------------------------------------------

  async function getMetadata(req: Request, res: Response, next: NextFunction) {
    try {
      const id = extractId(req);
      const config = await repo.getById(id);

      if (config.provider !== "saml") {
        next(new BadRequestError("Metadata is only available for SAML providers"));
        return;
      }

      const metadata = ssoService.generateSAMLMetadata(config);

      res.set("Content-Type", "application/xml");
      res.send(metadata);
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // SSO Login Flow endpoints
  // ---------------------------------------------------------------------------

  async function initiateLogin(req: Request, res: Response, next: NextFunction) {
    try {
      const id = extractId(req);
      const config = await repo.getById(id);

      if (!config.enabled) {
        next(new BadRequestError("SSO config is not enabled"));
        return;
      }

      let redirectUrl: string;

      if (config.provider === "saml") {
        redirectUrl = await ssoService.initiateSAMLLogin(config);
      } else {
        // All other providers use OIDC
        const state = req.query.state as string | undefined;
        redirectUrl = await ssoService.initiateOIDCLogin(config, state);
      }

      res.json({ redirectUrl });
    } catch (error) {
      next(error);
    }
  }

  async function handleSAMLCallback(req: Request, res: Response, next: NextFunction) {
    try {
      const id = extractId(req);
      const config = await repo.getById(id);

      if (config.provider !== "saml") {
        next(new BadRequestError("Invalid callback endpoint for this provider"));
        return;
      }

      const { SAMLResponse, RelayState } = req.body;
      if (!SAMLResponse) {
        next(new BadRequestError("Missing SAML response"));
        return;
      }

      const { user, sessionId } = await ssoService.handleSAMLCallback(config, SAMLResponse);

      // The frontend redirect URL should be in RelayState or use a default
      const redirectUrl = RelayState || "/";

      res.json({
        message: "SAML login successful",
        user: {
          _id: user._id,
          email: user.email,
          role: user.role,
        },
        sessionId,
        redirectUrl,
      });
    } catch (error) {
      next(error);
    }
  }

  async function handleOIDCCallback(req: Request, res: Response, next: NextFunction) {
    try {
      const id = extractId(req);
      const config = await repo.getById(id);

      if (config.provider === "saml") {
        next(new BadRequestError("Invalid callback endpoint for SAML provider"));
        return;
      }

      const { code, state, error: oauthError, error_description } = req.query;

      if (oauthError) {
        next(new BadRequestError(`OAuth error: ${oauthError} - ${error_description || "Unknown error"}`));
        return;
      }

      if (!code || typeof code !== "string") {
        next(new BadRequestError("Missing authorization code"));
        return;
      }

      const { user, sessionId } = await ssoService.handleOIDCCallback(
        config,
        code,
        state as string | undefined
      );

      res.json({
        message: "OIDC login successful",
        user: {
          _id: user._id,
          email: user.email,
          role: user.role,
        },
        sessionId,
      });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Public endpoint: list enabled SSO options (for login page)
  // ---------------------------------------------------------------------------

  async function listEnabled(req: Request, res: Response, next: NextFunction) {
    try {
      const organizationId = req.query.organizationId as string | undefined;
      const configs = await repo.getEnabledConfigs(organizationId);

      // Only return public info needed for login page
      const publicConfigs = configs.map((c) => ({
        _id: c._id,
        name: c.name,
        provider: c.provider,
      }));

      res.json({ ssoConfigs: publicConfigs });
    } catch (error) {
      next(error);
    }
  }

  return {
    list,
    get,
    add,
    update,
    remove,
    enable,
    disable,
    getMetadata,
    initiateLogin,
    handleSAMLCallback,
    handleOIDCCallback,
    listEnabled,
  };
}
