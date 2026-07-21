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
// COOKIE_DOMAIN is the primary env var (set by install.sh as ".example.com");
// DOMAIN is a fallback for backwards compatibility.
export const DOMAIN = (process.env.COOKIE_DOMAIN || process.env.DOMAIN || "localhost") as string;

// Initial admin user (from install script)
export const ROOT_USERNAME = process.env.ROOT_USERNAME as string;
export const ROOT_USER_EMAIL = process.env.ROOT_USER_EMAIL as string;
export const ROOT_USER_PASSWORD = process.env.ROOT_USER_PASSWORD as string;

// Kubernetes
export const K8S_KUBECONFIG = process.env.K8S_KUBECONFIG as string;
export const K8S_NAMESPACE = (process.env.K8S_NAMESPACE || "controlplane") as string;

// Rate Limiting
export const RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED !== "false";
export const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10);
export const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || "100", 10);

// Auth Rate Limiting (stricter)
export const RATE_LIMIT_AUTH_WINDOW_MS = parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS || "900000", 10); // 15 minutes
export const RATE_LIMIT_AUTH_MAX = parseInt(process.env.RATE_LIMIT_AUTH_MAX || "5", 10);

// Heavy Operations Rate Limiting
export const RATE_LIMIT_HEAVY_WINDOW_MS = parseInt(process.env.RATE_LIMIT_HEAVY_WINDOW_MS || "60000", 10);
export const RATE_LIMIT_HEAVY_MAX = parseInt(process.env.RATE_LIMIT_HEAVY_MAX || "10", 10);

// GitHub Integration
export const GITHUB_APP_ID = process.env.GITHUB_APP_ID as string;
export const GITHUB_PRIVATE_KEY = process.env.GITHUB_PRIVATE_KEY as string;
export const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET as string;
