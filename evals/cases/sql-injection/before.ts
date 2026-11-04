import type { Pool } from "pg";

export interface UserRow {
  id: number;
  name: string;
  email: string;
}

export class UsersRepo {
  constructor(private readonly pool: Pool) {}

  async byId(id: number): Promise<UserRow | null> {
    const result = await this.pool.query<UserRow>("SELECT id, name, email FROM users WHERE id = $1", [id]);
    return result.rows[0] ?? null;
  }
}
