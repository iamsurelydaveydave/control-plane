import * as dotenv from "dotenv";
dotenv.config();

// MongoDB - support both MONGODB_URI and MONGO_URI
export const MONGO_URI = (process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://localhost:27017") as string;
export const MONGO_DB = (process.env.MONGO_DB || "control_plane") as string;
export const PORT = Number(process.env.PORT || 3001);
export const SECRET_KEY = process.env.SECRET_KEY as string;
export const isDev = process.env.NODE_ENV !== "production";

export const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS as string)?.split(",") || [];

// Redis - support REDIS_URL (full URL) or separate host/port/password
export const REDIS_URL = process.env.REDIS_URL as string;
export const REDIS_HOST = process.env.REDIS_HOST as string;
export const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
export const REDIS_PASSWORD = process.env.REDIS_PASSWORD as string;

// JWT settings
export const ACCESS_TOKEN_SECRET = (process.env.ACCESS_TOKEN_SECRET as string) || "access_token_secret";
export const REFRESH_TOKEN_SECRET = (process.env.REFRESH_TOKEN_SECRET as string) || "refresh_token_secret";
export const ACCESS_TOKEN_EXPIRY = (process.env.ACCESS_TOKEN_EXPIRY as string) || "15m";
export const REFRESH_TOKEN_EXPIRY = (process.env.REFRESH_TOKEN_EXPIRY as string) || "30d";

// Session
export const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS || 14400);

// Bcrypt
export const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);

// Cookie settings
export const COOKIE_SAMESITE = (process.env.COOKIE_SAMESITE as "none" | "lax" | "strict") || "none";
export const DOMAIN = (process.env.DOMAIN as string) || "localhost";

// Initial admin user (from install script)
export const ROOT_USERNAME = process.env.ROOT_USERNAME as string;
export const ROOT_USER_EMAIL = process.env.ROOT_USER_EMAIL as string;
export const ROOT_USER_PASSWORD = process.env.ROOT_USER_PASSWORD as string;
