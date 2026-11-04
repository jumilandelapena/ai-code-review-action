import type { Pool } from "pg";

export interface ImportedOrder {
  externalId: string;
  customerId: number;
  totalCents: number;
}

export class OrdersImport {
  constructor(private readonly pool: Pool) {}

  async count(): Promise<number> {
    const result = await this.pool.query<{ n: string }>("SELECT count(*) AS n FROM orders");
    return Number(result.rows[0]?.n ?? 0);
  }
}
