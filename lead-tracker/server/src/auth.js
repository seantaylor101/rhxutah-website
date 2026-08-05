import jwt from "jsonwebtoken";

const SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  throw new Error("SESSION_SECRET env var is required");
}

export const COOKIE_NAME = "rhx_session";

export function signSession(role) {
  return jwt.sign({ role }, SECRET, { expiresIn: "30d" });
}

export function verifySession(token) {
  try {
    const payload = jwt.verify(token, SECRET);
    if (payload.role !== "owner" && payload.role !== "viewer") return null;
    return payload;
  } catch {
    return null;
  }
}
