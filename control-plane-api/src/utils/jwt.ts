import jwt, { SignOptions } from "jsonwebtoken";

export function signJwt<T extends object>(
  payload: T,
  secret: string,
  expiresIn: string | number
): string {
  const options: SignOptions = {
    expiresIn: expiresIn as jwt.SignOptions["expiresIn"],
  };
  return jwt.sign(payload, secret, options);
}

export function verifyJwt<T = unknown>(token: string, secret: string): T {
  return jwt.verify(token, secret) as T;
}
