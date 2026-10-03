import assert from "node:assert/strict";
import { test } from "node:test";
import { encryptMnemonic, ownerFromMnemonic } from "../src/vault";
import { deriveOwner } from "../src/accounts";

test("background migrates, isolates accounts, rejects stale approvals, and restores selection", async () => {
  const phrase = "test test test test test test test test test test test junk";
  const password = "test-password-only";
  const smart = "0x1111111111111111111111111111111111111111";
  const local: Record<string, unknown> = {
    paranoiaVault: await encryptMnemonic(phrase, password),
    paranoiaSmartAccount: smart,
    paranoiaConnectedOrigins: ["https://example.com"],
  };
  const session: Record<string, unknown> = {};
  const storage = (data: Record<string, unknown>) => ({
    async get(keys: string | string[] | null) {
      return structuredClone(keys === null ? data : Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys]).map((key) => [key, data[key]])));
    },
    async set(value: Record<string, unknown>) { Object.assign(data, structuredClone(value)); },
    async remove(key: string) { delete data[key]; },
    setAccessLevel() {},
  });
  let listener: Function;
  const notices: unknown[] = [];
  (globalThis as any).chrome = {
    storage: { local: storage(local), session: storage(session) },
    runtime: { id: "test", getURL: (path: string) => "chrome-extension://test/" + path,
      onMessage: { addListener(fn: Function) { listener = fn; } } },
    tabs: { async query() { return [{ id: 1, url: "https://example.com" }]; },
      async sendMessage(_id: number, message: unknown) { notices.push(message); } },
    windows: { onRemoved: { addListener() {} } },
  };
  await import("../src/background");
  const call = (request: Record<string, unknown>, website = false): Promise<any> =>
    new Promise((resolve) => listener(request, website
      ? { id: "test", url: "https://example.com", frameId: 0, tab: { id: 1 } }
      : { id: "test", url: "chrome-extension://test/popup.html" }, resolve));
  const unlocked = await call({ type: "UNLOCK", password });
  assert.equal(unlocked.value.owner, ownerFromMnemonic(phrase));
  assert.deepEqual((await call({ type: "DAPP_REQUEST", method: "eth_accounts" }, true)).value, [smart]);
  const before = structuredClone(local.paranoiaAccounts);
  assert.equal((await call({ type: "ADD_ACCOUNT", password: "incorrect", expectedIndex: 0 })).ok, false);
  assert.deepEqual(local.paranoiaAccounts, before);
  const pendingId = "00000000-0000-4000-8000-000000000001";
  session["paranoiaPending:" + pendingId] = {
    id: pendingId, origin: "https://example.com", tabId: 1, method: "eth_sendTransaction",
    status: "waiting", createdAt: Date.now(),
  };
  assert.equal((await call({ type: "ADD_ACCOUNT", password, expectedIndex: 0, name: "Savings" })).value.owner,
    deriveOwner(phrase, 1).address);
  assert.deepEqual((await call({ type: "DAPP_REQUEST", method: "eth_accounts" }, true)).value, []);
  assert.equal((session["paranoiaPending:" + pendingId] as any).status, "error");
  assert.equal((await call({ type: "SEND", expectedIndex: 0 })).ok, false);
  assert.equal((await call({ type: "RESOLVE_PENDING", expectedIndex: 1, id: pendingId, approved: true })).ok, false);
  await call({ type: "LOCK" });
  assert.equal((await call({ type: "ADD_ACCOUNT", password, expectedIndex: 1 })).ok, false);
  assert.equal((await call({ type: "UNLOCK", password })).value.owner, deriveOwner(phrase, 1).address);
  assert.equal((await call({ type: "SWITCH_ACCOUNT", password, expectedIndex: 1, index: 0 })).ok, true);
  assert.deepEqual((await call({ type: "DAPP_REQUEST", method: "eth_accounts" }, true)).value, [smart]);
  assert.equal((local.paranoiaAccounts as any).accounts[0].smartAccount, smart);
  assert.equal((local.paranoiaAccounts as any).accounts[1].name, "Savings");
  assert.deepEqual(notices.at(-1), { type: "REFRESH_ACCOUNTS" });
  assert.equal(JSON.stringify(local).includes(phrase), false);
});
