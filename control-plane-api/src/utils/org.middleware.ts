import { Request, Response, NextFunction } from "express";
import { useOrganizationRepo } from "../resources/organization/organization.repository";
import { useOrganizationService } from "../resources/organization/organization.service";
import { TOrganization } from "../resources/organization/organization.model";
import { BadRequestError, ForbiddenError, NotFoundError } from "./error";

// Extend Express Request to include organization
declare module "express-serve-static-core" {
  interface Request {
    organization?: TOrganization;
  }
}

/**
 * Extract organization ID from various sources:
 * 1. X-Organization-Id header
 * 2. Query parameter (orgId)
 * 3. Route parameter (orgId or id when nested under /organizations)
 */
function extractOrgId(req: Request): string | undefined {
  // 1. Try X-Organization-Id header
  const headerOrgId = req.headers["x-organization-id"];
  if (headerOrgId && typeof headerOrgId === "string") {
    return headerOrgId;
  }

  // 2. Try query parameter
  const queryOrgId = req.query.orgId;
  if (queryOrgId && typeof queryOrgId === "string") {
    return queryOrgId;
  }

  // 3. Try route parameter
  const paramOrgId = req.params.orgId;
  if (paramOrgId) {
    return Array.isArray(paramOrgId) ? paramOrgId[0] : paramOrgId;
  }

  return undefined;
}

/**
 * Middleware to resolve organization from request.
 * Supports extraction from header, query param, or route param.
 * Also validates that the requesting user is a member of the organization.
 *
 * Usage:
 * ```
 * router.get("/", requireAuth, resolveOrganization(), list);
 * router.post("/", requireAuth, resolveOrganization(), checkOrgLimit("apps"), create);
 * ```
 */
export function resolveOrganization() {
  const orgRepo = useOrganizationRepo();
  const orgService = useOrganizationService();

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = extractOrgId(req);

      if (!orgId) {
        next(new BadRequestError("Organization ID is required. Provide via X-Organization-Id header, orgId query param, or route param."));
        return;
      }

      // Get the organization
      const org = await orgRepo.getById(orgId);
      if (!org) {
        next(new NotFoundError("Organization not found"));
        return;
      }

      // Get the user ID from the request (set by requireAuth)
      const userId = req.cookies?.user;
      if (!userId) {
        next(new BadRequestError("User not authenticated"));
        return;
      }

      // Check if user is a member of this organization
      const isMember = await orgService.isMember(org._id!, userId);
      if (!isMember) {
        next(new ForbiddenError("Not a member of this organization"));
        return;
      }

      // Attach organization to request
      req.organization = org;

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Middleware to check organization resource limits before creating resources.
 * Must be used after resolveOrganization().
 *
 * Usage:
 * ```
 * router.post("/", requireAuth, resolveOrganization(), checkOrgLimit("apps"), create);
 * ```
 */
export function checkOrgLimit(resource: "apps" | "databases" | "users" | "storage") {
  const orgService = useOrganizationService();

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.organization) {
        next(new BadRequestError("Organization not resolved. Use resolveOrganization() middleware first."));
        return;
      }

      // This will throw BadRequestError if limit is exceeded
      await orgService.checkResourceLimit(req.organization._id!, resource);

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Middleware to require organization ownership.
 * Must be used after resolveOrganization().
 *
 * Usage:
 * ```
 * router.delete("/:orgId", requireAuth, resolveOrganization(), requireOrgOwner, remove);
 * ```
 */
export function requireOrgOwner(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.organization) {
      next(new BadRequestError("Organization not resolved. Use resolveOrganization() middleware first."));
      return;
    }

    const userId = req.cookies?.user;
    if (!userId) {
      next(new BadRequestError("User not authenticated"));
      return;
    }

    if (String(req.organization.ownerId) !== userId) {
      next(new ForbiddenError("Only the organization owner can perform this action"));
      return;
    }

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Optional middleware to resolve organization if provided, but don't require it.
 * Useful for endpoints that can work with or without organization context.
 *
 * Usage:
 * ```
 * router.get("/", requireAuth, resolveOrganizationOptional(), list);
 * ```
 */
export function resolveOrganizationOptional() {
  const orgRepo = useOrganizationRepo();
  const orgService = useOrganizationService();

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = extractOrgId(req);

      if (!orgId) {
        // No org specified, continue without organization context
        next();
        return;
      }

      // Get the organization
      const org = await orgRepo.getById(orgId);
      if (!org) {
        // Org not found, continue without organization context
        next();
        return;
      }

      // Get the user ID from the request
      const userId = req.cookies?.user;
      if (!userId) {
        next();
        return;
      }

      // Check if user is a member of this organization
      const isMember = await orgService.isMember(org._id!, userId);
      if (isMember) {
        // Attach organization to request
        req.organization = org;
      }

      next();
    } catch (error) {
      // On error, continue without organization context
      next();
    }
  };
}
