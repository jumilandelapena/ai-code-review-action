import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

export interface WebhookEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

export interface EventQueue {
  enqueue(event: WebhookEvent): Promise<void>;
}

export function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function webhookHandler(queue: EventQueue, secret: string) {
  return async (req: Request, res: Response): Promise<void> => {
    const rawBody = typeof req.body === "string" ? req.body : String(req.body ?? "");
    const signature = req.header("x-signature") ?? "";
    if (!verifySignature(rawBody, signature, secret)) {
      res.status(401).json({ error: "bad signature" });
      return;
    }
    const event = JSON.parse(rawBody) as WebhookEvent;
    await queue.enqueue(event);
    res.status(202).json({ received: event.id });
  };
}
