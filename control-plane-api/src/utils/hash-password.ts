import bcrypt from "bcryptjs";
import { BCRYPT_ROUNDS } from "../config";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}
