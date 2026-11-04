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
}
