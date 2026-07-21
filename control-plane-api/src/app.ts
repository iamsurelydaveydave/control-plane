import express from "express";
import cookieParser from "cookie-parser";
import router from "./routes";
import { ALLOWED_ORIGINS } from "./config";
import {
  errorHandler,
  securityHeaders,
  corsConfig,
  requestId,
  validateContentType,
  sanitizeInput,
  preventNoSQL,
  rateLimitApi,
  metricsMiddleware,
} from "./utils";

const app = express();

// Trust proxy for accurate IP detection (required for rate limiting)
app.set("trust proxy", 1);

console.log("Allowed origins:", ALLOWED_ORIGINS);

// ---------------------------------------------------------------------------
// Security Middleware (order matters)
// ---------------------------------------------------------------------------

// Request ID for tracing
app.use(requestId);

// Prometheus metrics middleware (track all requests)
app.use(metricsMiddleware);

// Security headers (helmet)
app.use(securityHeaders);
app.disable("x-powered-by");

// CORS configuration
app.use(corsConfig);

// Cookie parser
app.use(cookieParser());

// Global API rate limiting (applied before body parsing for efficiency)
app.use("/api", rateLimitApi);

// Body parsing (after rate limit to protect against large payloads)
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Content-Type validation
app.use(validateContentType);

// Input sanitization (deep sanitize body/query/params)
app.use(sanitizeInput);

// NoSQL injection prevention
app.use(preventNoSQL);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.use("/api", router);

// ---------------------------------------------------------------------------
// Error Handler
// ---------------------------------------------------------------------------

app.use(errorHandler);

export default app;
