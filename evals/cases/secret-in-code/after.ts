export interface ChargeRequest {
  amountCents: number;
  currency: string;
  customerId: string;
  idempotencyKey: string;
}

export interface ChargeResult {
  id: string;
  status: "succeeded" | "pending" | "failed";
}

const API_BASE = "https://api.payments.example.com/v1";
const REQUEST_TIMEOUT_MS = 10_000;
const API_KEY = "pay_live_9f3c2a7e1b4d8c6a5e0f1b2c3d4e5f60a7b8c9d0";

export async function charge(request: ChargeRequest): Promise<ChargeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}/charges`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${API_KEY}`,
        "content-type": "application/json",
        "idempotency-key": request.idempotencyKey,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`payment API returned ${response.status}`);
    }
    return (await response.json()) as ChargeResult;
  } finally {
    clearTimeout(timer);
  }
}
