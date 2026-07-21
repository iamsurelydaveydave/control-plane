import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import { useUserService } from "../user";
import { useAuditLogService } from "../audit-log";
import { useRoleService } from "../role";
import {
  BadRequestError,
  comparePassword,
  generateSessionId,
  signJwt,
  useSessionStore,
  sidCookieOptions,
  identityCookieOptions,
  clearSidCookieOptions,
  clearIdentityCookieOptions,
} from "../../utils";
import {
  ACCESS_TOKEN_SECRET,
  ACCESS_TOKEN_EXPIRY,
  REFRESH_TOKEN_SECRET,
  REFRESH_TOKEN_EXPIRY,
  SESSION_TTL_SECONDS,
} from "../../config";

const schemaLogin = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

const schemaUpdateMe = Joi.object({
  currentPassword: Joi.string().required(),
  email: Joi.string().email().optional(),
  newPassword: Joi.string().min(8).optional(),
  confirmPassword: Joi.string().optional(),
}).custom((value, helpers) => {
  if (value.newPassword && value.newPassword !== value.confirmPassword) {
    return helpers.error("any.invalid", { message: "Passwords do not match" });
  }
  if (!value.email && !value.newPassword) {
    return helpers.error("any.invalid", { message: "Provide at least an email or new password" });
  }
  return value;
});

export function useAuthController() {
  const userService = useUserService();
  const sessionStore = useSessionStore();
  const auditService = useAuditLogService();
  const roleService = useRoleService();

  async function login(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaLogin.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const { email, password } = value;
      const user = await userService.getByEmail(email);

      if (!user) {
        // Log failed login attempt
        await auditService.logAction({
          req,
          action: "login_failed",
          resource: "user",
          details: { email, reason: "User not found" },
          success: false,
          errorMessage: "Invalid email or password",
        });

        next(new BadRequestError("Invalid email or password"));
        return;
      }

      const isValid = await comparePassword(password, user.password);
      if (!isValid) {
        // Log failed login attempt
        await auditService.logAction({
          req,
          action: "login_failed",
          resource: "user",
          resourceId: String(user._id),
          details: { email, reason: "Invalid password" },
          success: false,
          errorMessage: "Invalid email or password",
        });

        next(new BadRequestError("Invalid email or password"));
        return;
      }

      // Create session
      const sid = generateSessionId();
      const userId = String(user._id);

      await sessionStore.set(
        sid,
        { userId, email: user.email, createdAt: Date.now() },
        SESSION_TTL_SECONDS
      );

      res.cookie("sid", sid, sidCookieOptions());
      res.cookie("user", userId, identityCookieOptions());

      // Log successful login
      await auditService.logAction({
        req,
        action: "login",
        resource: "user",
        resourceId: userId,
        details: { email: user.email },
        success: true,
      });

      // Get role name if user has a role
      let roleName: string | undefined;
      if (user.roleId) {
        try {
          const role = await roleService.getById(String(user.roleId));
          roleName = role.name;
        } catch {
          // Ignore role lookup failures
        }
      }

      res.json({
        message: "Login successful",
        user: {
          _id: user._id,
          email: user.email,
          role: user.role,
          roleId: user.roleId,
          roleName,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async function logout(req: Request, res: Response, next: NextFunction) {
    try {
      const sid = req.cookies?.sid;
      const userId = req.cookies?.user;

      if (sid) {
        await sessionStore.destroy(sid);
      }

      res.clearCookie("sid", clearSidCookieOptions());
      res.clearCookie("user", clearIdentityCookieOptions());

      // Log logout
      if (userId) {
        await auditService.logAction({
          req,
          action: "logout",
          resource: "user",
          resourceId: userId,
          success: true,
        });
      }

      res.json({ message: "Logged out successfully" });
    } catch (error) {
      next(error);
    }
  }

  async function me(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.cookies?.user;
      if (!userId) {
        next(new BadRequestError("Not authenticated"));
        return;
      }

      const user = await userService.getById(userId);
      if (!user) {
        next(new BadRequestError("User not found"));
        return;
      }

      // Get role name if user has a role
      let roleName: string | undefined;
      if (user.roleId) {
        try {
          const role = await roleService.getById(String(user.roleId));
          roleName = role.name;
        } catch {
          // Ignore role lookup failures
        }
      }

      res.json({
        user: {
          _id: user._id,
          email: user.email,
          role: user.role,
          roleId: user.roleId,
          roleName,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async function updateMe(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.cookies?.user;
      if (!userId) {
        next(new BadRequestError("Not authenticated"));
        return;
      }

      const { error, value } = schemaUpdateMe.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const user = await userService.getById(userId);
      if (!user) {
        next(new BadRequestError("User not found"));
        return;
      }

      // Verify current password before allowing any change
      const isValid = await comparePassword(value.currentPassword, user.password);
      if (!isValid) {
        next(new BadRequestError("Current password is incorrect"));
        return;
      }

      await userService.updateProfile(userId, {
        email: value.email,
        newPassword: value.newPassword,
      });

      // Log profile update
      await auditService.logAction({
        req,
        action: "update",
        resource: "user",
        resourceId: userId,
        changes: [
          ...(value.email ? [{ field: "email", oldValue: user.email, newValue: value.email }] : []),
          ...(value.newPassword ? [{ field: "password", oldValue: "[redacted]", newValue: "[redacted]" }] : []),
        ],
        success: true,
      });

      res.json({
        message: "Profile updated successfully",
        user: {
          _id: user._id,
          email: value.email ?? user.email,
          role: user.role,
          roleId: user.roleId,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async function issueToken(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.cookies?.user;
      if (!userId) {
        next(new BadRequestError("Not authenticated"));
        return;
      }

      const user = await userService.getById(userId);
      if (!user) {
        next(new BadRequestError("User not found"));
        return;
      }

      const accessToken = signJwt(
        { sub: userId, type: "access", email: user.email },
        ACCESS_TOKEN_SECRET,
        ACCESS_TOKEN_EXPIRY
      );

      const refreshToken = signJwt(
        { sub: userId, type: "refresh" },
        REFRESH_TOKEN_SECRET,
        REFRESH_TOKEN_EXPIRY
      );

      res.json({
        accessToken,
        refreshToken,
        expiresIn: ACCESS_TOKEN_EXPIRY,
      });
    } catch (error) {
      next(error);
    }
  }

  return {
    login,
    logout,
    me,
    updateMe,
    issueToken,
  };
}
