import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import { useUserService } from "../user";
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

export function useAuthController() {
  const userService = useUserService();
  const sessionStore = useSessionStore();

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
        next(new BadRequestError("Invalid email or password"));
        return;
      }

      const isValid = await comparePassword(password, user.password);
      if (!isValid) {
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

      res.json({
        message: "Login successful",
        user: {
          _id: user._id,
          email: user.email,
          role: user.role,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async function logout(req: Request, res: Response, next: NextFunction) {
    try {
      const sid = req.cookies?.sid;
      if (sid) {
        await sessionStore.destroy(sid);
      }

      res.clearCookie("sid", clearSidCookieOptions());
      res.clearCookie("user", clearIdentityCookieOptions());

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

      res.json({
        user: {
          _id: user._id,
          email: user.email,
          role: user.role,
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
    issueToken,
  };
}
