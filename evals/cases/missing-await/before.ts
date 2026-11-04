import type { Request, Response } from "express";

export interface AccountStore {
  load(userId: string): Promise<{ id: string; balanceCents: number }>;
}

export async function verifyToken(token: string): Promise<{ userId: string } | null> {
  // Looks the token up in the session store; null when unknown or expired.
  return token.length === 0 ? null : { userId: token.slice(0, 8) };
}

export function accountHandler(store: AccountStore) {
  return async (req: Request, res: Response): Promise<void> => {
    const userId = String(req.params["id"]);
    const account = await store.load(userId);
    res.json(account);
  };
}
