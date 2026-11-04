import type { Pool } from "pg";

export interface ImportedOrder {
  externalId: string;
  customerId: number;
  totalCents: number;
}

const INSERT = "INSERT INTO orders (external_id, customer_id, total_cents) VALUES ($1, $2, $3) ON CONFLICT (external_id) DO NOTHING";

export class OrdersImport {
  constructor(private readonly pool: Pool) {}

  async count(): Promise<number> {
    const result = await this.pool.query<{ n: string }>("SELECT count(*) AS n FROM orders");
    return Number(result.rows[0]?.n ?? 0);
  }

  async insertMany(orders: ImportedOrder[]): Promise<number> {
    if (orders.length === 0) {
      return 0;
    }
    const client = await this.pool.connect();
    await client.query("BEGIN");
    let inserted = 0;
    for (const order of orders) {
      const result = await client.query(INSERT, [order.externalId, order.customerId, order.totalCents]);
      inserted += result.rowCount ?? 0;
    }
    await client.query("COMMIT");
    client.release();
    return inserted;
  }
}
