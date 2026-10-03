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
    new Promise((resolve) => listener({ expectedChainId: 11142220, ...request }, website
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

  // Migration must never reinterpret the old Celo address as a deployment on another chain.
  assert.equal((await call({ type: "SWITCH_NETWORK", expectedIndex: 0, chainId: 11155111 })).ok, true);
  assert.equal(local.paranoiaNetwork, 11155111);
  assert.equal((await call({ type: "DAPP_REQUEST", method: "eth_chainId" }, true)).value, "0xaa36a7");
  assert.deepEqual((await call({ type: "DAPP_REQUEST", method: "eth_accounts" }, true)).value, []);
  assert.equal((await call({ type: "SEND", expectedIndex: 0 })).ok, false, "stale Celo popup rejected");
  assert.match((await call({ type: "DEPLOY", expectedIndex: 0, expectedChainId: 11155111 })).error, /configure.*factory/);
  assert.equal((await call({ type: "SWITCH_NETWORK", expectedIndex: 0, expectedChainId: 11155111, chainId: 1 })).ok, false);
  assert.equal(local.paranoiaNetwork, 11155111);

  const fetchOriginal = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (url, options) => {
    urls.push(String(url));
    const body = JSON.parse(options!.body as string);
    const result = body.method === "eth_getUserOperationReceipt"
      ? { success: true, receipt: { transactionHash: "0x" + "ab".repeat(32) } }
      : "0x61";
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { headers: { "content-type": "application/json" } });
  };
  try {
    session["paranoiaPending:" + pendingId] = {
      id: pendingId, origin: "https://example.com", tabId: 1, method: "eth_sendTransaction",
      status: "submitted", createdAt: Date.now(), operationHash: "0x" + "cd".repeat(32), chainId: 11142220,
    };
    await call({ type: "DAPP_POLL", pendingId }, true);
    assert.equal(urls.at(-1), "https://public.pimlico.io/v2/11142220/rpc", "old operation polled on original network");
    for (const [from, to, hex, rpc] of [
      [11155111, 97, "0x61", "https://bsc-testnet-dataseed.bnbchain.org"],
      [97, 80002, "0x13882", "https://polygon-amoy-bor-rpc.publicnode.com"],
    ] as const) {
      session["paranoiaPending:" + pendingId] = {
        id: pendingId, origin: "https://example.com", tabId: 1, method: "eth_requestAccounts",
        status: "waiting", createdAt: Date.now(), chainId: from, accountIndex: 0,
      };
      assert.equal((await call({ type: "SWITCH_NETWORK", expectedIndex: 0, expectedChainId: from, chainId: to })).ok, true);
      assert.equal((session["paranoiaPending:" + pendingId] as any).status, "error");
      assert.equal((await call({ type: "DAPP_REQUEST", method: "eth_chainId" }, true)).value, hex);
      assert.deepEqual((await call({ type: "DAPP_REQUEST", method: "eth_accounts" }, true)).value, []);
      await call({ type: "DAPP_REQUEST", method: "eth_blockNumber" }, true);
      assert.equal(urls.at(-1), rpc);
      assert.ok(notices.some((n: any) => n.type === "CHAIN_CHANGED" && n.chainId === hex));
    }
  } finally { globalThis.fetch = fetchOriginal; }
  await call({ type: "LOCK" });
  await call({ type: "UNLOCK", password });
  assert.equal((await call({ type: "DAPP_REQUEST", method: "eth_chainId" }, true)).value, "0x13882", "network survives lock");
  assert.equal((await call({ type: "SWITCH_NETWORK", expectedIndex: 0, expectedChainId: 80002, chainId: 11142220 })).ok, true);
  assert.deepEqual((await call({ type: "DAPP_REQUEST", method: "eth_accounts" }, true)).value, [smart]);
});
