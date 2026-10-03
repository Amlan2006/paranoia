import assert from "node:assert/strict";
import { test } from "node:test";
import { accountNetwork, migrateAccount, migrateNetworks } from "../src/accounts";
import { networkById, NETWORKS } from "../src/config";
import { parseDappTransaction } from "../src/dapp";
const address = "0x1111111111111111111111111111111111111111";

test("four testnets have separate endpoints, correct currencies and no invented factories", () => {
  assert.deepEqual(NETWORKS.map((n) => [n.chain.id, n.chain.nativeCurrency.symbol]), [
    [11142220, "CELO"], [11155111, "ETH"], [97, "tBNB"], [80002, "POL"],
  ]);
  for (const id of [11155111, 97, 80002]) {
    const n = networkById(id);
    assert.equal(n.factory, undefined);
    assert.ok(n.bundler.includes("/" + id + "/"));
  }
  assert.throws(() => networkById(1), /Unsupported/);
});
test("network migration preserves Celo without leaking contracts or permissions", () => {
  const book = migrateAccount(address, address, ["https://example.com"]);
  assert.equal(migrateNetworks(book), true);
  assert.equal(migrateNetworks(book), false);
  assert.equal(accountNetwork(book, 11142220).smartAccount, address);
  for (const id of [11155111, 97, 80002]) {
    assert.deepEqual(accountNetwork(book, id), { origins: [] });
  }
  book.accounts[0].networks![97] = { smartAccount: address, origins: ["https://bnb.example"] };
  assert.deepEqual(accountNetwork(book, 11142220).origins, ["https://example.com"]);
  assert.deepEqual(accountNetwork(book, 97).origins, ["https://bnb.example"]);
});
test("website transactions cannot specify a different network", () => {
  assert.throws(() => parseDappTransaction({ to: address, chainId: "0x61" }, address, 11155111), /chain ID/);
  assert.throws(() => parseDappTransaction({ to: address, chainId: {} }, address, 97), /chain ID/);
  assert.equal(parseDappTransaction({ to: address, chainId: "0x61" }, address, 97).to, address);
});
