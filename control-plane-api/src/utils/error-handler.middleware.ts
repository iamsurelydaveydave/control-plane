import { Request, Response, NextFunction } from "express";
import { AppError } from "./error";
import { logger } from "./logger";

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
    });
    return;
  }

  logger.log({
    level: "error",
    message: `Unhandled error: ${err.message}`,
  });

  res.status(500).json({
    error: "Internal server error",
  });
}
