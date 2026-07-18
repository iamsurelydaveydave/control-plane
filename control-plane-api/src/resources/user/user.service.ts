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

  return {
    createUser,
    ensureDefaultAdmin,
    getByEmail: repo.getByEmail,
    getById: repo.getById,
  };
}
