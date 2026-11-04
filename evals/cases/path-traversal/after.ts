import { join } from "node:path";
import type { Request, Response } from "express";

export const UPLOAD_DIR = process.env["UPLOAD_DIR"] ?? "/var/app/uploads";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".pdf": "application/pdf",
};

export function healthHandler(_req: Request, res: Response): void {
  res.json({ ok: true, uploadDir: UPLOAD_DIR });
}

export function attachmentHandler(req: Request, res: Response): void {
  const name = String(req.params["name"] ?? "");
  if (name === "") {
    res.status(400).json({ error: "missing file name" });
    return;
  }
  const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
  const contentType = CONTENT_TYPES[extension] ?? "application/octet-stream";
  const filePath = join(UPLOAD_DIR, name);
  res.setHeader("content-type", contentType);
  res.sendFile(filePath, (error) => {
    if (error) {
      res.status(404).json({ error: "not found" });
    }
  });
}
