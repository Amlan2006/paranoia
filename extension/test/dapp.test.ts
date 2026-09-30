import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDappTransaction, transactionSummary } from "../src/dapp";

const account = "0x479aa953B3d730588734bacc0dfD9D2Cb7e1C2db";
const recipient = "0x47ADF21c50D82fDC77Fc6C518659690797f6E6f2";

test("valid website transaction is normalized without changing its details", () => {
  const tx = parseDappTransaction({ from: account, to: recipient, value: "0xde0b6b3a7640000", data: "0x" }, account);
  assert.equal(tx.value, 1_000_000_000_000_000_000n);
  assert.deepEqual(transactionSummary(tx, account), { from: account, to: recipient, value: "0xde0b6b3a7640000", data: "0x" });
});

test("website cannot substitute another sender or malformed calldata", () => {
  assert.throws(() => parseDappTransaction({ from: recipient, to: recipient }, account), /sender must be/);
  assert.throws(() => parseDappTransaction({ to: recipient, data: "0x123" }, account), /transaction data/);
  assert.throws(() => parseDappTransaction({ to: recipient, value: "-1" }, account), /transaction value/);
  assert.throws(() => parseDappTransaction({ value: "0x1" }, account), /Contract creation/);
});
