import { join } from "node:path";
import type { Request, Response } from "express";

export const UPLOAD_DIR = process.env["UPLOAD_DIR"] ?? "/var/app/uploads";

export function healthHandler(_req: Request, res: Response): void {
  res.json({ ok: true, uploadDir: UPLOAD_DIR });
}
