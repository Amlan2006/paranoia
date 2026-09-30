import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptMnemonic, encryptMnemonic, newMnemonic, normalizeMnemonic, ownerFromMnemonic } from "../src/vault";

test("created mnemonic encrypts and decrypts without changing its owner", async () => {
  const mnemonic = newMnemonic();
  const vault = await encryptMnemonic(mnemonic, "a-strong-test-password");
  assert.equal(vault.version, 1);
  assert.equal(vault.iterations, 600_000);
  assert.equal(vault.owner, ownerFromMnemonic(mnemonic));
  assert.equal(await decryptMnemonic(vault, "a-strong-test-password"), mnemonic);
  assert.equal(JSON.stringify(vault).includes(mnemonic), false);
});

test("wrong password and modified ciphertext do not unlock", async () => {
  const vault = await encryptMnemonic(newMnemonic(), "a-strong-test-password");
  await assert.rejects(decryptMnemonic(vault, "wrong-password"), /Wrong password/);
  vault.ciphertext[0] ^= 1;
  await assert.rejects(decryptMnemonic(vault, "a-strong-test-password"), /Wrong password/);
});

test("recovery phrase and password validation", async () => {
  assert.throws(() => normalizeMnemonic("not a recovery phrase"), /Invalid recovery phrase/);
  await assert.rejects(encryptMnemonic(newMnemonic(), "short"), /at least 12/);
});
