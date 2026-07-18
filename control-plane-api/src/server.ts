import { MONGO_DB, MONGO_URI, PORT } from "./config";
import setup from "./setup";
import { logger, useAtlas } from "./utils";

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

    app.listen(PORT, () => {
      logger.log({
        level: "info",
        message: `Control Plane API running on http://localhost:${PORT}`,
      });
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
