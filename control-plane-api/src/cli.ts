#!/usr/bin/env node
/**
 * Control Plane CLI
 * 
 * Administrative commands for managing the Control Plane.
 * 
 * Usage:
 *   node cli.js <command> [options]
 * 
 * Commands:
 *   reset-password <email> <password>  - Reset a user's password
 *   create-admin <email> <password>    - Create an admin user
 *   delete-user <email>                - Delete a user
 *   list-users                         - List all users
 *   clear-cache [namespace]            - Clear Redis cache
 *   help                               - Show this help
 */

import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import Redis from "ioredis";

// Load environment variables
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
const REDIS_URL = process.env.REDIS_URL;
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);

// Colors for terminal output
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(message: string, color: keyof typeof colors = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message: string) {
  log(`✓ ${message}`, "green");
}

function logError(message: string) {
  log(`✗ ${message}`, "red");
}

function logInfo(message: string) {
  log(`ℹ ${message}`, "blue");
}

async function getMongoClient(): Promise<MongoClient> {
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI environment variable is not set");
  }
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  return client;
}

async function getRedisClient(): Promise<Redis | null> {
  if (!REDIS_URL) {
    logInfo("REDIS_URL not set, skipping Redis operations");
    return null;
  }
  try {
    const redis = new Redis(REDIS_URL);
    await redis.ping();
    return redis;
  } catch (error) {
    logInfo("Could not connect to Redis, skipping cache operations");
    return null;
  }
}

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

// ================================
// Commands
// ================================

async function resetPassword(email: string, newPassword: string) {
  logInfo(`Resetting password for: ${email}`);
  
  const client = await getMongoClient();
  const redis = await getRedisClient();
  
  try {
    const db = client.db();
    const users = db.collection("cp_users");
    
    const user = await users.findOne({ email });
    if (!user) {
      logError(`User not found: ${email}`);
      process.exit(1);
    }
    
    const hashedPassword = await hashPassword(newPassword);
    
    await users.updateOne(
      { email },
      { $set: { password: hashedPassword, updatedAt: new Date() } }
    );
    
    // Clear user cache
    if (redis) {
      const keys = await redis.keys("cp_users*");
      if (keys.length > 0) {
        await redis.del(...keys);
        logInfo(`Cleared ${keys.length} cache keys`);
      }
    }
    
    logSuccess(`Password reset successfully for: ${email}`);
  } finally {
    await client.close();
    if (redis) await redis.quit();
  }
}

async function createAdmin(email: string, password: string) {
  logInfo(`Creating admin user: ${email}`);
  
  const client = await getMongoClient();
  const redis = await getRedisClient();
  
  try {
    const db = client.db();
    const users = db.collection("cp_users");
    const roles = db.collection("cp_roles");
    
    // Check if user exists
    const existingUser = await users.findOne({ email });
    if (existingUser) {
      logError(`User already exists: ${email}`);
      process.exit(1);
    }
    
    // Get admin role
    const adminRole = await roles.findOne({ name: "admin" });
    
    const hashedPassword = await hashPassword(password);
    
    await users.insertOne({
      email,
      password: hashedPassword,
      role: "admin",
      roleId: adminRole?._id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    
    // Clear cache
    if (redis) {
      const keys = await redis.keys("cp_users*");
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }
    
    logSuccess(`Admin user created: ${email}`);
  } finally {
    await client.close();
    if (redis) await redis.quit();
  }
}

async function deleteUser(email: string) {
  logInfo(`Deleting user: ${email}`);
  
  const client = await getMongoClient();
  const redis = await getRedisClient();
  
  try {
    const db = client.db();
    const users = db.collection("cp_users");
    
    const result = await users.deleteOne({ email });
    
    if (result.deletedCount === 0) {
      logError(`User not found: ${email}`);
      process.exit(1);
    }
    
    // Clear cache
    if (redis) {
      const keys = await redis.keys("cp_users*");
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }
    
    logSuccess(`User deleted: ${email}`);
  } finally {
    await client.close();
    if (redis) await redis.quit();
  }
}

async function listUsers() {
  const client = await getMongoClient();
  
  try {
    const db = client.db();
    const users = db.collection("cp_users");
    
    const userList = await users
      .find({}, { projection: { password: 0 } })
      .toArray();
    
    if (userList.length === 0) {
      logInfo("No users found");
      return;
    }
    
    log(`\nUsers (${userList.length}):`, "cyan");
    log("─".repeat(60), "cyan");
    
    for (const user of userList) {
      console.log(`  ${user.email}`);
      console.log(`    ID: ${user._id}`);
      console.log(`    Role: ${user.role || "none"}`);
      console.log(`    Created: ${user.createdAt}`);
      console.log("");
    }
  } finally {
    await client.close();
  }
}

async function clearCache(namespace?: string) {
  const redis = await getRedisClient();
  
  if (!redis) {
    logError("Redis not available");
    process.exit(1);
  }
  
  try {
    const pattern = namespace ? `${namespace}*` : "*";
    logInfo(`Clearing cache with pattern: ${pattern}`);
    
    const keys = await redis.keys(pattern);
    
    if (keys.length === 0) {
      logInfo("No cache keys found");
      return;
    }
    
    await redis.del(...keys);
    logSuccess(`Cleared ${keys.length} cache keys`);
  } finally {
    await redis.quit();
  }
}

function showHelp() {
  console.log(`
${colors.cyan}Control Plane CLI${colors.reset}

${colors.yellow}Usage:${colors.reset}
  node cli.js <command> [options]

${colors.yellow}Commands:${colors.reset}
  reset-password <email> <password>  Reset a user's password
  create-admin <email> <password>    Create an admin user
  delete-user <email>                Delete a user
  list-users                         List all users
  clear-cache [namespace]            Clear Redis cache (e.g., cp_users)
  help                               Show this help

${colors.yellow}Examples:${colors.reset}
  node cli.js reset-password admin@example.com newpassword123
  node cli.js create-admin admin@example.com securepassword
  node cli.js delete-user user@example.com
  node cli.js list-users
  node cli.js clear-cache cp_users

${colors.yellow}Environment Variables:${colors.reset}
  MONGODB_URI   MongoDB connection string (required)
  REDIS_URL     Redis connection string (optional)
`);
}

// ================================
// Main
// ================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (!command || command === "help" || command === "--help" || command === "-h") {
    showHelp();
    process.exit(0);
  }
  
  try {
    switch (command) {
      case "reset-password": {
        const email = args[1];
        const password = args[2];
        if (!email || !password) {
          logError("Usage: reset-password <email> <password>");
          process.exit(1);
        }
        await resetPassword(email, password);
        break;
      }
      
      case "create-admin": {
        const email = args[1];
        const password = args[2];
        if (!email || !password) {
          logError("Usage: create-admin <email> <password>");
          process.exit(1);
        }
        await createAdmin(email, password);
        break;
      }
      
      case "delete-user": {
        const email = args[1];
        if (!email) {
          logError("Usage: delete-user <email>");
          process.exit(1);
        }
        await deleteUser(email);
        break;
      }
      
      case "list-users":
        await listUsers();
        break;
      
      case "clear-cache":
        await clearCache(args[1]);
        break;
      
      default:
        logError(`Unknown command: ${command}`);
        showHelp();
        process.exit(1);
    }
  } catch (error: any) {
    logError(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
