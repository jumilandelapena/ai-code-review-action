import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

export interface WebhookEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

export function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
