import { MongoClient, Db } from "mongodb";

interface AtlasConfig {
  name?: string;
  uri: string;
  db: string;
}

export class useAtlas {
  private static client: MongoClient | null = null;
  private static database: Db | null = null;

  public static async initialize(config: AtlasConfig): Promise<void> {
    if (this.client) {
      console.warn(`Client is already initialized. Skipping initialization.`);
      return;
    }

    const { uri, db } = config;
    this.client = new MongoClient(uri, {
      maxPoolSize: 10,
      maxIdleTimeMS: 60000,
      connectTimeoutMS: 60000,
      readPreference: "secondaryPreferred",
      writeConcern: { w: 1 },
    });

    try {
      await this.client.connect();
      this.database = this.client.db(db);
      console.log(`Connected to database "${db}".`);
    } catch (error) {
      this.client = null;
      throw error;
    }
  }

  public static getClient(): MongoClient | null {
    return this.client;
  }

  public static getDb(): Db | null {
    return this.database;
  }

  public static async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.database = null;
      console.log(`Closed connection to the database.`);
    } else {
      console.warn(`No client is currently initialized.`);
    }
  }
}
