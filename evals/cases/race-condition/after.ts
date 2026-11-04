export interface BalanceStore {
  getBalance(accountId: string): Promise<number>;
  setBalance(accountId: string, balanceCents: number): Promise<void>;
  /** Atomically adds `delta` and returns the new balance; rejects if it would go below zero. */
  adjustBalance(accountId: string, deltaCents: number): Promise<number>;
}

export class InsufficientFunds extends Error {
  constructor(accountId: string) {
    super(`insufficient funds in ${accountId}`);
  }
}

export class WalletService {
  constructor(private readonly store: BalanceStore) {}

  async balance(accountId: string): Promise<number> {
    return this.store.getBalance(accountId);
  }

  async withdraw(accountId: string, amountCents: number): Promise<number> {
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new RangeError("amountCents must be a positive integer");
    }
    const balance = await this.store.getBalance(accountId);
    if (balance < amountCents) {
      throw new InsufficientFunds(accountId);
    }
    await this.store.setBalance(accountId, balance - amountCents);
    return balance - amountCents;
  }
}
