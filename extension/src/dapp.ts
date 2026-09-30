import { isAddress, isHex, type Address, type Hex } from "viem";

export type DappTransaction = { to: Address; value: bigint; data: Hex };

export function parseDappTransaction(value: unknown, smartAccount: Address): DappTransaction {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid transaction request.");
  const tx = value as Record<string, unknown>;
  if (tx.from !== undefined && (typeof tx.from !== "string" || tx.from.toLowerCase() !== smartAccount.toLowerCase())) {
    throw new Error("Transaction sender must be your Paranoia smart account.");
  }
  if (typeof tx.to !== "string" || !isAddress(tx.to)) throw new Error("Contract creation and invalid recipients are not supported.");
  const valueInput = tx.value ?? "0x0";
  if (typeof valueInput !== "string" || !/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(valueInput)) throw new Error("Invalid transaction value.");
  const amount = BigInt(valueInput);
  const data = tx.data ?? tx.input ?? "0x";
  if (typeof data !== "string" || !isHex(data) || data.length % 2 !== 0 || data.length > 20_002) throw new Error("Invalid or oversized transaction data.");
  return { to: tx.to, value: amount, data: data as Hex };
}

export function transactionSummary(tx: DappTransaction, from: Address) {
  return { from, to: tx.to, value: "0x" + tx.value.toString(16), data: tx.data };
}
