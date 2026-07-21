import http from "http";
import { WebSocketServer } from "ws";
import { MONGO_DB, MONGO_URI, PORT } from "./config";
import setup from "./setup";
import { logger, useAtlas } from "./utils";
import { startNodeSyncWorker, startAlertCheckWorker, startTaskSchedulerWorker } from "./workers";
import {
  authenticateWebSocketRequest,
  handlePodExecConnection,
  isPodExecPath,
} from "./websocket";

useAtlas
  .initialize({ uri: MONGO_URI, db: MONGO_DB, name: "default" })
  .then(() => {
    logger.log({
      level: "info",
      message: "Successfully connected to MongoDB",
    });

    // Run setup
    setup();

    const app = require("./app").default;

    // Create HTTP server from Express app
    const server = http.createServer(app);

    // WebSocket server (noServer mode for manual upgrade handling)
    const wss = new WebSocketServer({ noServer: true });

    // Handle WebSocket upgrades
    server.on("upgrade", async (request, socket, head) => {
      const url = request.url || "";

      // Pod exec WebSocket endpoint
      if (isPodExecPath(url)) {
        try {
          // Authenticate the request
          const auth = await authenticateWebSocketRequest(request);

          if (!auth) {
            logger.log({
              level: "warn",
              message: `[ws] Unauthorized WebSocket upgrade attempt: ${url}`,
            });
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
          }

          // Upgrade the connection
          wss.handleUpgrade(request, socket, head, (ws) => {
            handlePodExecConnection(ws, auth);
          });
        } catch (error: any) {
          logger.log({
            level: "error",
            message: `[ws] WebSocket upgrade error: ${error.message}`,
          });
          socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
          socket.destroy();
        }
      } else {
        // Unknown WebSocket path
        logger.log({
          level: "warn",
          message: `[ws] Unknown WebSocket path: ${url}`,
        });
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
      }
    });

    server.listen(PORT, () => {
      logger.log({
        level: "info",
        message: `Control Plane API running on http://localhost:${PORT}`,
      });

      // Start background workers
      startNodeSyncWorker();
      startAlertCheckWorker();
      startTaskSchedulerWorker();
    });
  })
  .catch((err) => {
    console.error(err);
    logger.log({
      level: "error",
      message: `Failed to start server: ${JSON.stringify(err)}`,
    });
    process.exit(1);
  });
