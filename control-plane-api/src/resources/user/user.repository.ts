import { ObjectId } from "mongodb";
import { modelUser, TUser } from "./user.model";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
  logger,
  makeCacheKey,
  useRepo,
  paginate,
} from "../../utils";
import type { TPermission } from "../role";

export function useUserRepo() {
  const namespace_collection = "cp_users";
  const repo = useRepo(namespace_collection);

  async function createIndexes() {
    try {
      await repo.collection.createIndexes([
        { key: { email: 1 }, unique: true },
        { key: { roleId: 1 } },
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

  async function getAll({ page = 1, limit = 20 } = {}) {
    const cacheKey = makeCacheKey(namespace_collection, { page, limit, tag: "getAll" });

    try {
      const cached = await repo.getCache<ReturnType<typeof paginate>>(cacheKey);
      if (cached) {
        return cached;
      }

      const skip = (page > 0 ? page - 1 : 0) * limit;
      const [items, total] = await Promise.all([
        repo.collection
          .find<TUser>({})
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .project({ password: 0 }) // Exclude password from list
          .toArray(),
        repo.collection.countDocuments({}),
      ]);

      const result = paginate(items, page, limit, total);
      repo.setCache(cacheKey, result, 300).catch((err) => {
        logger.log({
          level: "error",
          message: `Failed to set cache for users: ${err.message}`,
        });
      });

      return result;
    } catch (error) {
      throw new InternalServerError("Failed to get users");
    }
  }

  async function updateById(
    _id: string | ObjectId,
    data: Partial<Omit<TUser, "_id" | "createdAt">>
  ) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid user ID");
    }

    // Handle roleId conversion
    if (data.roleId !== undefined) {
      if (data.roleId === null || data.roleId === undefined) {
        // To unset roleId, we need to use $unset in a separate operation
        // For simplicity, we set it to null here
        (data as any).roleId = null;
      } else if (typeof data.roleId === "string") {
        try {
          data.roleId = new ObjectId(data.roleId);
        } catch {
          throw new BadRequestError("Invalid roleId format");
        }
      }
    }

    try {
      const updateDoc: any = { $set: { ...data, updatedAt: new Date() } };
      
      // If roleId is null, unset it instead
      if (data.roleId === null) {
        delete updateDoc.$set.roleId;
        updateDoc.$unset = { roleId: "" };
      }

      const result = await repo.collection.updateOne({ _id }, updateDoc);
      
      if (!result.matchedCount) {
        throw new NotFoundError("User not found");
      }
      
      repo.delCachedData();
      return result;
    } catch (error: any) {
      if (error instanceof NotFoundError || error instanceof BadRequestError) {
        throw error;
      }
      if (error.message?.includes("duplicate")) {
        throw new BadRequestError("Email already in use");
      }
      throw new InternalServerError("Failed to update user");
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

  async function updateEmail(_id: string | ObjectId, email: string) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid user ID");
    }

    try {
      const result = await repo.collection.updateOne(
        { _id },
        { $set: { email, updatedAt: new Date() } }
      );
      repo.delCachedData();
      return result;
    } catch (error: any) {
      if (error.message?.includes("duplicate")) {
        throw new BadRequestError("Email already in use");
      }
      throw new InternalServerError("Failed to update email");
    }
  }

  async function count() {
    try {
      return await repo.collection.countDocuments();
    } catch (error) {
      throw new InternalServerError("Failed to count users");
    }
  }

  async function deleteById(_id: string | ObjectId) {
    try {
      _id = new ObjectId(_id);
    } catch {
      throw new BadRequestError("Invalid user ID");
    }

    try {
      const result = await repo.collection.deleteOne({ _id });
      if (!result.deletedCount) {
        throw new NotFoundError("User not found");
      }
      repo.delCachedData();
      return result;
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof BadRequestError) {
        throw error;
      }
      throw new InternalServerError("Failed to delete user");
    }
  }

  return {
    createIndexes,
    add,
    getByEmail,
    getById,
    getAll,
    updateById,
    updatePassword,
    updateEmail,
    count,
    deleteById,
  };
}
