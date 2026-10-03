import { mnemonicToAccount } from "viem/accounts";
import type { Address } from "viem";

export type WalletAccount = {
  index: number;
  name: string;
  owner: Address;
  smartAccount?: Address;
  origins: string[];
};
export type AccountBook = { active: number; accounts: WalletAccount[] };

export function deriveOwner(mnemonic: string, index: number) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= 0x80000000) {
    throw new Error("Invalid account index.");
  }
  // Standard Ethereum account sequence: m/44'/60'/0'/0/index.
  return mnemonicToAccount(mnemonic, { addressIndex: index });
}
export function activeAccount(book: AccountBook): WalletAccount {
  const account = book.accounts.find((item) => item.index === book.active);
  if (!account) throw new Error("Active account is missing.");
  return account;
}
export function migrateAccount(owner: Address, smartAccount?: Address, origins: string[] = []): AccountBook {
  return { active: 0, accounts: [{ index: 0, name: "Account 1", owner, smartAccount, origins }] };
}
export function appendAccount(book: AccountBook, mnemonic: string, name: string): AccountBook {
  const index = Math.max(...book.accounts.map((item) => item.index)) + 1;
  const owner = deriveOwner(mnemonic, index).address;
  return {
    active: index,
    accounts: [...book.accounts, { index, name: name.trim().slice(0, 40) || "Account " + (index + 1), owner, origins: [] }],
  };
}
