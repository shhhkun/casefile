import { createHash } from "crypto";

export function hashKey(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
