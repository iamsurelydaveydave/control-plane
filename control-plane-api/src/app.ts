import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import router from "./routes";
import { ALLOWED_ORIGINS, isDev } from "./config";
import { errorHandler } from "./utils";

const app = express();

app.set("trust proxy", 1);

console.log("Allowed origins:", ALLOWED_ORIGINS);

app.use(
  cors({
    origin: ALLOWED_ORIGINS,
    credentials: true,
  })
);

app.use(cookieParser());

// Security headers
app.use(helmet());
app.disable("x-powered-by");

// Routes
app.use("/api", router);

// Error handler
app.use(errorHandler);

export default app;
