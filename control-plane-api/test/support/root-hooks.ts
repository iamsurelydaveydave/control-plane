import { useAtlas } from "../../src/utils/atlas";
import { createAllIndexes } from "../../src/setup";

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";
const MONGO_DB = process.env.MONGO_DB || "control_plane_test";

export const mochaHooks = {
  async beforeAll(this: Mocha.Context) {
    this.timeout(30000); // Increase timeout for DB connection

    // Connect to test database
    await useAtlas.initialize({ uri: MONGO_URI, db: MONGO_DB, name: "test" });
    console.log(`Connected to test database: ${MONGO_DB}`);

    // Create indexes
    await createAllIndexes();
    console.log("Indexes created");
  },

  async afterAll() {
    // Close database connection
    await useAtlas.close();
    console.log("Database connection closed");
  },
};
