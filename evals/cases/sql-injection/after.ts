import type { Pool } from "pg";

export interface UserRow {
  id: number;
  name: string;
  email: string;
}

const MAX_RESULTS = 50;

export class UsersRepo {
  constructor(private readonly pool: Pool) {}

  async byId(id: number): Promise<UserRow | null> {
    const result = await this.pool.query<UserRow>("SELECT id, name, email FROM users WHERE id = $1", [id]);
    return result.rows[0] ?? null;
  }

  async search(query: string, limit = MAX_RESULTS): Promise<UserRow[]> {
    const capped = Math.min(Math.max(limit, 1), MAX_RESULTS);
    const result = await this.pool.query<UserRow>(
      `SELECT id, name, email FROM users WHERE name ILIKE '%${query}%' ORDER BY name LIMIT $1`,
      [capped],
    );
    return result.rows;
  }
}
