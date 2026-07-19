import { useUserRepo } from "./user.repository";
import { hashPassword } from "../../utils";

export function useUserService() {
  const repo = useUserRepo();

  async function createUser(email: string, password: string) {
    const hashedPassword = await hashPassword(password);
    return repo.add({ email, password: hashedPassword });
  }

  async function ensureDefaultAdmin(email: string, password: string) {
    const count = await repo.count();
    if (count === 0) {
      return createUser(email, password);
    }
    return null;
  }

  async function updateProfile(
    userId: string,
    updates: { email?: string; newPassword?: string }
  ) {
    if (updates.email) {
      await repo.updateEmail(userId, updates.email);
    }
    if (updates.newPassword) {
      const hashed = await hashPassword(updates.newPassword);
      await repo.updatePassword(userId, hashed);
    }
  }

  return {
    createUser,
    ensureDefaultAdmin,
    updateProfile,
    getByEmail: repo.getByEmail,
    getById: repo.getById,
  };
}
