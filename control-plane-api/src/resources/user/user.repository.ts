import { ObjectId } from "mongodb";
import { modelUser, TUser } from "./user.model";
import {
  BadRequestError,
  InternalServerError,
  logger,
  makeCacheKey,
  useRepo,
} from "../../utils";

export function useUserRepo() {
  const namespace_collection = "cp_users";
  const repo = useRepo(namespace_collection);

  async function createIndexes() {
    try {
      await repo.collection.createIndexes([
        { key: { email: 1 }, unique: true },
      ]);
    } catch (error) {
      logger.log({
        level: "error",
        message: `Failed to create user indexes: ${error}`,
      });
    }
  }

  async function add(value: Partial<TUser>) {
    try {
      const user = modelUser(value);
      const res = await repo.collection.insertOne(user);
      repo.delCachedData();
      return res.insertedId;
    } catch (error: any) {
      logger.log({ level: "error", message: `${error}` });

      if (error.message?.includes("duplicate")) {
        throw new BadRequestError("Email already exists");
      }

      throw new InternalServerError("Failed to create user");
    }
  }

  async function getByEmail(email: string) {
    const cacheKey = makeCacheKey(namespace_collection, { email, tag: "by-email" });

    try {
      const cached = await repo.getCache<TUser>(cacheKey);
      if (cached) {
        return cached;
      }

      const result = await repo.collection.findOne<TUser>({ email });

      if (result) {
        repo.setCache(cacheKey, result, 300).catch((err) => {
          logger.log({
            level: "error",
            message: `Failed to set cache for user by email: ${err.message}`,
          });
        });
      }

      return result;
    } catch (error) {
      throw new InternalServerError("Failed to get user by email");
    }
  }

  async function getById(_id: string | ObjectId) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid user ID");
    }

    const cacheKey = makeCacheKey(namespace_collection, { _id: String(_id), tag: "by-id" });

    try {
      const cached = await repo.getCache<TUser>(cacheKey);
      if (cached) {
        return cached;
      }

      const result = await repo.collection.findOne<TUser>({ _id });

      if (result) {
        repo.setCache(cacheKey, result, 300).catch((err) => {
          logger.log({
            level: "error",
            message: `Failed to set cache for user by id: ${err.message}`,
          });
        });
      }

      return result;
    } catch (error) {
      throw new InternalServerError("Failed to get user by id");
    }
  }

  async function updatePassword(_id: string | ObjectId, password: string) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid user ID");
    }

    try {
      const result = await repo.collection.updateOne(
        { _id },
        { $set: { password, updatedAt: new Date() } }
      );
      repo.delCachedData();
      return result;
    } catch (error) {
      throw new InternalServerError("Failed to update password");
    }
  }

  async function count() {
    try {
      return await repo.collection.countDocuments();
    } catch (error) {
      throw new InternalServerError("Failed to count users");
    }
  }

  return {
    createIndexes,
    add,
    getByEmail,
    getById,
    updatePassword,
    count,
  };
}
