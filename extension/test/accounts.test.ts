import assert from "node:assert/strict";
import { test } from "node:test";
import { activeAccount, appendAccount, deriveOwner, migrateAccount } from "../src/accounts";
import { ownerFromMnemonic } from "../src/vault";

// Public BIP-39 test vector, never a funded wallet.
const phrase = "test test test test test test test test test test test junk";
test("account zero remains compatible; later addresses are distinct and recoverable", () => {
  assert.equal(deriveOwner(phrase, 0).address, ownerFromMnemonic(phrase));
  assert.equal(deriveOwner(phrase, 0).address, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
  assert.equal(deriveOwner(phrase, 1).address, "0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
  assert.notEqual(deriveOwner(phrase, 1).address, deriveOwner(phrase, 2).address);
  for (const index of [-1, 0.1, NaN, 0x80000000]) assert.throws(() => deriveOwner(phrase, index));
});
test("migration preserves existing smart account and permissions; new account is isolated", () => {
  const smart = "0x1111111111111111111111111111111111111111";
  const original = migrateAccount(ownerFromMnemonic(phrase), smart, ["https://example.com"]);
  const next = appendAccount(original, phrase, " Savings ");
  assert.equal(original.active, 0);
  assert.equal(next.accounts[0].smartAccount, smart);
  assert.deepEqual(next.accounts[0].origins, ["https://example.com"]);
  assert.equal(activeAccount(next).name, "Savings");
  assert.equal(activeAccount(next).smartAccount, undefined);
  assert.deepEqual(activeAccount(next).origins, []);
  const restored = JSON.parse(JSON.stringify(next));
  assert.equal(activeAccount(restored).owner, deriveOwner(phrase, 1).address);
  assert.equal(activeAccount(appendAccount(next, phrase, "")).name, "Account 3");
});
