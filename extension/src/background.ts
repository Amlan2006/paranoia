import {
  concatHex, createPublicClient, createWalletClient, encodeFunctionData, formatEther,
  http, isAddress, maxUint256, parseEther, parseEventLogs, parseUnits, toHex,
  type Address, type Hex,
} from "viem";
import { mnemonicToAccount, type HDAccount } from "viem/accounts";
import { accountAbi, BUNDLER, chain, ENTRY_POINT, FACTORY, factoryAbi, policyAbi } from "./config";
import { parseDappTransaction, transactionSummary } from "./dapp";
import { decryptMnemonic, encryptMnemonic, newMnemonic, normalizeMnemonic, type EncryptedVault } from "./vault";
import { activeAccount, appendAccount, deriveOwner, migrateAccount, type AccountBook } from "./accounts";

const VAULT_KEY = "paranoiaVault";
const BOOK_KEY = "paranoiaAccounts";
const ACCOUNT_KEY = "paranoiaSmartAccount";
const CONNECTIONS_KEY = "paranoiaConnectedOrigins";
const PENDING_PREFIX = "paranoiaPending:";
const PENDING_MS = 10 * 60 * 1000;
const UNLOCK_MS = 10 * 60 * 1000;
const publicClient = createPublicClient({ chain, transport: http() });
let signer: HDAccount | null = null;
let unlockedAt = 0;
const openingApprovalTabs = new Set<number>();

type Request = { type: string; [key: string]: unknown };
type Saved = { [VAULT_KEY]?: EncryptedVault; [ACCOUNT_KEY]?: Address; [BOOK_KEY]?: AccountBook };
type Pending = {
  id: string; origin: string; tabId: number; method: "eth_requestAccounts" | "eth_sendTransaction";
  createdAt: number; status: "waiting" | "processing" | "submitted" | "result" | "error";
  transaction?: { from: Address; to: Address; value: string; data: Hex };
  operationHash?: Hex; result?: unknown; error?: string; windowId?: number;
};

const entryPointAbi = [
  { type: "function", name: "getNonce", stateMutability: "view",
    inputs: [{ name: "sender", type: "address" }, { name: "key", type: "uint192" }],
    outputs: [{ name: "nonce", type: "uint256" }] },
  { type: "function", name: "getUserOpHash", stateMutability: "view",
    inputs: [{ name: "userOp", type: "tuple", components: [
      { name: "sender", type: "address" }, { name: "nonce", type: "uint256" },
      { name: "initCode", type: "bytes" }, { name: "callData", type: "bytes" },
      { name: "accountGasLimits", type: "bytes32" }, { name: "preVerificationGas", type: "uint256" },
      { name: "gasFees", type: "bytes32" }, { name: "paymasterAndData", type: "bytes" }, { name: "signature", type: "bytes" },
    ] }], outputs: [{ name: "hash", type: "bytes32" }] },
] as const;

function requireSigner(): HDAccount {
  if (!signer || Date.now() - unlockedAt > UNLOCK_MS) {
    signer = null;
    throw new Error("Wallet locked. Enter your password again.");
  }
  unlockedAt = Date.now();
  return signer;
}
function requireAddress(value: unknown): Address {
  if (typeof value !== "string" || !isAddress(value)) throw new Error("Enter a valid address.");
  return value;
}
function requireAmount(value: unknown): bigint {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,18})?$/.test(value)) throw new Error("Enter a valid CELO amount.");
  const amount = parseEther(value);
  if (amount <= 0n) throw new Error("Amount must be greater than zero.");
  return amount;
}
async function saved(): Promise<Saved> {
  const state = await chrome.storage.local.get([VAULT_KEY, ACCOUNT_KEY, BOOK_KEY, CONNECTIONS_KEY]) as Saved & { [CONNECTIONS_KEY]?: string[] };
  if (state[VAULT_KEY] && !state[BOOK_KEY]) {
    state[BOOK_KEY] = migrateAccount(state[VAULT_KEY].owner, state[ACCOUNT_KEY],
      Array.isArray(state[CONNECTIONS_KEY]) ? state[CONNECTIONS_KEY] : []);
    await chrome.storage.local.set({ [BOOK_KEY]: state[BOOK_KEY] });
  }
  if (state[BOOK_KEY]) state[ACCOUNT_KEY] = activeAccount(state[BOOK_KEY]).smartAccount;
  return state as Saved;
}
async function updateActive(values: Partial<Pick<ReturnType<typeof activeAccount>, "smartAccount" | "origins">>) {
  const state = await saved();
  const book = state[BOOK_KEY];
  if (!book) throw new Error("Wallet not found.");
  Object.assign(activeAccount(book), values);
  await chrome.storage.local.set({ [BOOK_KEY]: book });
}
async function notifyAccountsChanged() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(async (tab) => {
    if (tab.id === undefined) return;
    try {
      // No tabs/history permission needed; each bridge reads its own permitted accounts.
      await chrome.tabs.sendMessage(tab.id, { type: "REFRESH_ACCOUNTS" });
    } catch { /* No Paranoia bridge in this tab. */ }
  }));
}
async function changeAccount(request: Request) {
  requireSigner();
  if (typeof request.password !== "string") throw new Error("Enter your wallet password.");
  const state = await saved();
  if (!state[VAULT_KEY] || !state[BOOK_KEY]) throw new Error("Wallet not found.");
  const mnemonic = await decryptMnemonic(state[VAULT_KEY], request.password);
  let book = state[BOOK_KEY];
  if (request.type === "ADD_ACCOUNT") {
    book = appendAccount(book, mnemonic, typeof request.name === "string" ? request.name : "");
  } else {
    if (!book.accounts.some((item) => item.index === request.index)) throw new Error("Account not found.");
    book.active = request.index as number;
  }
  const selected = activeAccount(book);
  const nextSigner = deriveOwner(mnemonic, selected.index);
  if (nextSigner.address.toLowerCase() !== selected.owner.toLowerCase()) throw new Error("Account owner mismatch.");
  const entries = await chrome.storage.session.get(null);
  for (const [key, value] of Object.entries(entries)) {
    const pending = value as Pending;
    if (key.startsWith(PENDING_PREFIX) && pending.status === "waiting") {
      pending.status = "error"; pending.error = "Active account changed. Request again.";
      await putPending(pending);
    }
  }
  await chrome.storage.local.set({ [BOOK_KEY]: book });
  signer = nextSigner;
  unlockedAt = Date.now();
  await notifyAccountsChanged();
  return { owner: selected.owner };
}
async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(BUNDLER, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error("Bundler HTTP error: " + response.status);
  const payload = await response.json() as { result?: T; error?: { message?: string } };
  if (payload.error) throw new Error(payload.error.message ?? "Bundler rejected the request.");
  if (payload.result === undefined) throw new Error("Bundler returned no result.");
  return payload.result;
}
async function publicRpc(method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(chain.rpcUrls.default.http[0], {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error("Celo RPC is unavailable.");
  const payload = await response.json() as { result?: unknown; error?: { message?: string } };
  if (payload.error) throw new Error(payload.error.message ?? "Celo RPC rejected the request.");
  return payload.result ?? null;
}
function pendingKey(id: string) { return PENDING_PREFIX + id; }
async function getPending(id: unknown): Promise<Pending | null> {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const key = pendingKey(id);
  const value = (await chrome.storage.session.get(key))[key] as Pending | undefined;
  if (!value) return null;
  if (Date.now() - value.createdAt > PENDING_MS) {
    await chrome.storage.session.remove(key);
    return null;
  }
  return value;
}
async function putPending(value: Pending) { await chrome.storage.session.set({ [pendingKey(value.id)]: value }); }
async function connections(): Promise<string[]> {
  const state = await saved();
  return state[BOOK_KEY] ? activeAccount(state[BOOK_KEY]).origins : [];
}
function dappOrigin(sender: chrome.runtime.MessageSender): string {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || sender.tab?.id === undefined || !sender.url) {
    throw new Error("Unauthorized website request.");
  }
  const url = new URL(sender.url);
  if (!(["http:", "https:"].includes(url.protocol))) throw new Error("Unsupported website origin.");
  return url.origin;
}
async function makePending(origin: string, tabId: number, method: Pending["method"], transaction?: Pending["transaction"]) {
  if (openingApprovalTabs.has(tabId)) throw new Error("Another Paranoia request is already opening for this tab.");
  openingApprovalTabs.add(tabId);
  try {
    const entries = await chrome.storage.session.get(null);
    const active = Object.entries(entries).filter(([key, value]) => {
      if (!key.startsWith(PENDING_PREFIX)) return false;
      const previous = value as Pending;
      return Date.now() - previous.createdAt < PENDING_MS && ["waiting", "processing", "submitted"].includes(previous.status);
    }).map(([, value]) => value as Pending);
    if (active.some((previous) => previous.tabId === tabId)) throw new Error("Another Paranoia request is already pending for this tab.");
    if (active.length >= 10) throw new Error("Too many wallet requests are pending. Resolve or close an approval window.");
    const id = crypto.randomUUID();
    const pending: Pending = { id, origin, tabId, method, transaction, createdAt: Date.now(), status: "waiting" };
    await putPending(pending);
    try {
      const window = await chrome.windows.create({ url: chrome.runtime.getURL("popup.html?approval=" + id), type: "popup", width: 430, height: 760, focused: true });
      if (window?.id !== undefined) { pending.windowId = window.id; await putPending(pending); }
    } catch (error) {
      await chrome.storage.session.remove(pendingKey(id));
      throw error;
    }
    return { pendingId: id };
  } finally {
    openingApprovalTabs.delete(tabId);
  }
}
const READ_METHODS = new Set([
  "eth_blockNumber", "eth_getBalance", "eth_getCode", "eth_call", "eth_estimateGas", "eth_gasPrice",
  "eth_feeHistory", "eth_getTransactionCount", "eth_getTransactionReceipt", "eth_getTransactionByHash",
  "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getLogs", "eth_getStorageAt", "eth_getProof",
]);
async function dappRequest(request: Request, sender: chrome.runtime.MessageSender) {
  const origin = dappOrigin(sender);
  if (signer && Date.now() - unlockedAt > UNLOCK_MS) signer = null;
  const method = request.method;
  const params = request.params === undefined ? [] : request.params;
  if (typeof method !== "string" || !Array.isArray(params) || JSON.stringify(params).length > 20_000) {
    throw new Error("Invalid website RPC request.");
  }
  if (method === "eth_chainId") return "0x" + chain.id.toString(16);
  if (method === "net_version") return String(chain.id);
  if (method === "wallet_switchEthereumChain") {
    if ((params[0] as { chainId?: unknown } | undefined)?.chainId === "0x" + chain.id.toString(16)) return null;
    throw new Error("Paranoia only supports Celo Sepolia.");
  }
  if (READ_METHODS.has(method)) return publicRpc(method, params);
  const state = await saved();
  const connected = (await connections()).includes(origin);
  if (method === "eth_accounts") return connected && signer && state[ACCOUNT_KEY] ? [state[ACCOUNT_KEY]] : [];
  if (method === "eth_requestAccounts") {
    if (connected && signer && state[ACCOUNT_KEY]) return [state[ACCOUNT_KEY]];
    return makePending(origin, sender.tab!.id!, method);
  }
  if (method === "eth_sendTransaction") {
    if (!connected || !signer || !state[ACCOUNT_KEY]) throw new Error("Connect and unlock Paranoia before sending.");
    const tx = parseDappTransaction(params[0], state[ACCOUNT_KEY]);
    return makePending(origin, sender.tab!.id!, method, transactionSummary(tx, state[ACCOUNT_KEY]));
  }
  throw new Error("Unsupported wallet method: " + method);
}
async function dappPoll(request: Request, sender: chrome.runtime.MessageSender) {
  const origin = dappOrigin(sender);
  const pending = await getPending(request.pendingId);
  if (!pending || pending.origin !== origin || pending.tabId !== sender.tab!.id) throw new Error("Request expired or does not belong to this tab.");
  if (pending.status === "submitted" && pending.operationHash) {
    let result: { success: boolean; receipt?: { transactionHash?: Hex } } | null = null;
    try { result = await rpc("eth_getUserOperationReceipt", [pending.operationHash]); }
    catch { return { waiting: true }; }
    if (result) {
      if (!result.success || !result.receipt?.transactionHash) {
        pending.status = "error"; pending.error = "Smart-account transaction failed on-chain.";
      } else {
        pending.status = "result"; pending.result = result.receipt.transactionHash;
      }
      await putPending(pending);
    }
  }
  if (pending.status === "error") {
    await chrome.storage.session.remove(pendingKey(pending.id));
    throw new Error(pending.error ?? "Wallet request rejected.");
  }
  if (pending.status === "result") {
    await chrome.storage.session.remove(pendingKey(pending.id));
    return pending.result;
  }
  return { waiting: true };
}
async function pendingForPopup(id: unknown) {
  const pending = await getPending(id);
  if (!pending) return null;
  return { id: pending.id, origin: pending.origin, method: pending.method, status: pending.status, transaction: pending.transaction, operationHash: pending.operationHash };
}
async function resolvePending(id: unknown, approved: unknown) {
  const pending = await getPending(id);
  if (!pending || pending.status !== "waiting") throw new Error("This request is no longer pending.");
  if (approved !== true) {
    pending.status = "error"; pending.error = "Request rejected by user.";
    await putPending(pending);
    return { rejected: true };
  }
  const state = await saved();
  requireSigner();
  if (!state[ACCOUNT_KEY]) throw new Error("Deploy or link your smart account before approving.");
  if (pending.method === "eth_requestAccounts") {
    const allowed = await connections();
    if (!allowed.includes(pending.origin)) await updateActive({ origins: [...allowed, pending.origin] });
    pending.status = "result"; pending.result = [state[ACCOUNT_KEY]];
    await putPending(pending);
    return { connected: true };
  }
  if (!pending.transaction) throw new Error("Transaction details are missing.");
  if (!(await connections()).includes(pending.origin)) throw new Error("Website connection was revoked.");
  pending.status = "processing";
  await putPending(pending);
  try {
    const tx = parseDappTransaction(pending.transaction, state[ACCOUNT_KEY]);
    const { userOperationHash } = await submitCall(tx.to, tx.value, tx.data);
    pending.status = "submitted"; pending.operationHash = userOperationHash;
    await putPending(pending);
    return { userOperationHash };
  } catch (error) {
    pending.status = "error"; pending.error = error instanceof Error ? error.message : "Transaction failed.";
    await putPending(pending);
    throw error;
  }
}
async function walletStatus() {
  const state = await saved();
  if (!state[VAULT_KEY]) return { exists: false, unlocked: false };
  const selected = activeAccount(state[BOOK_KEY]!);
  const owner = selected.owner;
  const smartAccount = state[ACCOUNT_KEY] ?? null;
  let ownerBalance: bigint | null = null;
  let smartBalance: bigint | null = null;
  let limit: string | null = null;
  let policyManager: Address | null = null;
  try {
    [ownerBalance, smartBalance] = await Promise.all([
      publicClient.getBalance({ address: owner }),
      smartAccount ? publicClient.getBalance({ address: smartAccount }) : Promise.resolve(0n),
    ]);
    if (smartAccount) {
      policyManager = await publicClient.readContract({ address: smartAccount, abi: accountAbi, functionName: "policyManager" });
      const rawLimit = await publicClient.readContract({ address: policyManager, abi: policyAbi, functionName: "maxNativeTransfer" });
      limit = formatEther(rawLimit);
    }
  } catch {
    // The vault remains usable while the public RPC is temporarily unavailable.
  }
  if (signer && Date.now() - unlockedAt > UNLOCK_MS) signer = null;
  return { exists: true, unlocked: !!signer, owner, smartAccount, activeIndex: selected.index,
    accounts: state[BOOK_KEY]!.accounts.map(({ index, name, owner, smartAccount }) => ({ index, name, owner, smartAccount })),
    ownerBalance: ownerBalance === null ? null : formatEther(ownerBalance), smartBalance: smartBalance === null ? null : formatEther(smartBalance), limit, policyManager };
}
async function createWallet(password: unknown, phrase?: unknown) {
  const state = await saved();
  if (state[VAULT_KEY]) throw new Error("A wallet already exists in this extension.");
  if (typeof password !== "string") throw new Error("Enter a password.");
  const mnemonic = phrase === undefined ? newMnemonic() : normalizeMnemonic(String(phrase));
  const encrypted = await encryptMnemonic(mnemonic, password);
  await chrome.storage.local.set({ [VAULT_KEY]: encrypted, [BOOK_KEY]: migrateAccount(encrypted.owner) });
  signer = mnemonicToAccount(mnemonic);
  unlockedAt = Date.now();
  return { owner: encrypted.owner, recoveryPhrase: phrase === undefined ? mnemonic : undefined };
}
async function unlock(password: unknown) {
  if (typeof password !== "string") throw new Error("Enter your password.");
  const state = await saved();
  if (!state[VAULT_KEY]) throw new Error("Create or import a wallet first.");
  const mnemonic = await decryptMnemonic(state[VAULT_KEY], password);
  const selected = activeAccount(state[BOOK_KEY]!);
  signer = deriveOwner(mnemonic, selected.index);
  if (signer.address.toLowerCase() !== selected.owner.toLowerCase()) { signer = null; throw new Error("Account owner mismatch."); }
  unlockedAt = Date.now();
  await notifyAccountsChanged();
  return { owner: signer.address };
}
async function revealPhrase(password: unknown) {
  requireSigner();
  if (typeof password !== "string") throw new Error("Enter your wallet password.");
  const state = await saved();
  if (!state[VAULT_KEY]) throw new Error("Wallet vault not found.");
  return { recoveryPhrase: await decryptMnemonic(state[VAULT_KEY], password) };
}
async function deployAccount() {
  const account = requireSigner();
  const state = await saved();
  if (state[ACCOUNT_KEY]) throw new Error("A smart account is already linked.");
  const client = createWalletClient({ account, chain, transport: http() });
  const hash = await client.writeContract({
    address: FACTORY, abi: factoryAbi, functionName: "createAccount",
    args: [account.address, ENTRY_POINT, parseEther("1")],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Smart-account deployment failed.");
  const events = parseEventLogs({ abi: factoryAbi, logs: receipt.logs, eventName: "AccountCreated" });
  const smartAccount = events.find((event) => event.address.toLowerCase() === FACTORY.toLowerCase())?.args.account;
  if (!smartAccount) throw new Error("Deployment confirmed, but account address was not found. Check the factory transaction on the explorer.");
  await updateActive({ smartAccount });
  return { smartAccount, transactionHash: hash };
}
async function linkAccount(value: unknown) {
  const owner = requireSigner().address;
  const smartAccount = requireAddress(value);
  const contractOwner = await publicClient.readContract({ address: smartAccount, abi: accountAbi, functionName: "owner" });
  if (contractOwner.toLowerCase() !== owner.toLowerCase()) throw new Error("That smart account belongs to a different owner.");
  await updateActive({ smartAccount, origins: [] });
  await notifyAccountsChanged();
  return { smartAccount };
}
async function policyUpdate(method: "setMaxNativeTransfer" | "whitelist7702Delegate" | "removeWhitelisted7702Delegate", argument: unknown) {
  const account = requireSigner();
  const state = await saved();
  const smartAccount = state[ACCOUNT_KEY];
  if (!smartAccount) throw new Error("Deploy or link your smart account first.");
  const args = method === "setMaxNativeTransfer" ? [requireAmount(argument)] : [requireAddress(argument)];
  const client = createWalletClient({ account, chain, transport: http() });
  const hash = await client.writeContract({ address: smartAccount, abi: accountAbi, functionName: method, args: args as never });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Policy transaction reverted.");
  return { transactionHash: hash };
}
async function submitCall(target: Address, value: bigint, data: Hex) {
  const account = requireSigner();
  const state = await saved();
  const smartAccount = state[ACCOUNT_KEY];
  if (!smartAccount) throw new Error("Deploy or link your smart account first.");
  const policyManager = await publicClient.readContract({ address: smartAccount, abi: accountAbi, functionName: "policyManager" });
  const limit = await publicClient.readContract({ address: policyManager, abi: policyAbi, functionName: "maxNativeTransfer" });
  if (value > limit) throw new Error("SPENDING_LIMIT_EXCEEDED: transaction exceeds " + formatEther(limit) + " CELO.");
  const balance = await publicClient.getBalance({ address: smartAccount });
  if (value > balance) throw new Error("The smart account does not have enough CELO.");
  const callData = encodeFunctionData({ abi: accountAbi, functionName: "execute", args: [target, value, data] });
  const nonce = await publicClient.readContract({ address: ENTRY_POINT, abi: entryPointAbi, functionName: "getNonce", args: [smartAccount, 0n] });
  const fees = await publicClient.estimateFeesPerGas();
  const maxFeePerGas = fees.maxFeePerGas ?? 1_000_000_000n;
  const maxPriorityFeePerGas = fees.maxPriorityFeePerGas ?? 1_000_000_000n;
  const signaturePlaceholder = ("0x" + "00".repeat(65)) as Hex;
  const draft = {
    sender: smartAccount, nonce: toHex(nonce), callData,
    callGasLimit: toHex(500_000n), verificationGasLimit: toHex(500_000n),
    preVerificationGas: toHex(100_000n), maxFeePerGas: toHex(maxFeePerGas),
    maxPriorityFeePerGas: toHex(maxPriorityFeePerGas), signature: signaturePlaceholder,
  };
  const estimate = await rpc<{ callGasLimit: Hex; verificationGasLimit: Hex; preVerificationGas: Hex }>(
    "eth_estimateUserOperationGas", [draft, ENTRY_POINT],
  );
  const packed = {
    sender: smartAccount, nonce, initCode: "0x" as Hex, callData,
    accountGasLimits: concatHex([toHex(BigInt(estimate.verificationGasLimit), { size: 16 }), toHex(BigInt(estimate.callGasLimit), { size: 16 })]),
    preVerificationGas: BigInt(estimate.preVerificationGas),
    gasFees: concatHex([toHex(maxPriorityFeePerGas, { size: 16 }), toHex(maxFeePerGas, { size: 16 })]),
    paymasterAndData: "0x" as Hex, signature: signaturePlaceholder,
  };
  const hash = await publicClient.readContract({ address: ENTRY_POINT, abi: entryPointAbi, functionName: "getUserOpHash", args: [packed] });
  const signature = await account.signMessage({ message: { raw: hash } });
  const userOperationHash = await rpc<Hex>("eth_sendUserOperation", [{
    ...draft, callGasLimit: estimate.callGasLimit,
    verificationGasLimit: estimate.verificationGasLimit,
    preVerificationGas: estimate.preVerificationGas, signature,
  }, ENTRY_POINT]);
  return { userOperationHash };
}
async function approveToken(tokenInput: unknown, spenderInput: unknown, amountInput: unknown) {
  const token = requireAddress(tokenInput);
  const spender = requireAddress(spenderInput);
  if (typeof amountInput !== "string" || !/^\d+(?:\.\d+)?$/.test(amountInput)) throw new Error("Enter a valid token amount.");
  const decimals = await publicClient.readContract({ address: token, abi: [
    { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  ], functionName: "decimals" });
  const amount = parseUnits(amountInput, decimals);
  if (amount === maxUint256) throw new Error("UNLIMITED_APPROVAL: blocked by Paranoia.");
  const data = encodeFunctionData({ abi: [
    { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  ], functionName: "approve", args: [spender, amount] });
  return submitCall(token, 0n, data);
}
async function scan7702() {
  const owner = requireSigner().address;
  const code = await publicClient.getCode({ address: owner });
  if (!code || !/^0xef0100[0-9a-fA-F]{40}$/i.test(code)) return { delegated: false };
  const delegate = ("0x" + code.slice(8)) as Address;
  const state = await saved();
  if (!state[ACCOUNT_KEY]) return { delegated: true, delegate, trusted: false };
  const policyManager = await publicClient.readContract({ address: state[ACCOUNT_KEY], abi: accountAbi, functionName: "policyManager" });
  const trusted = await publicClient.readContract({ address: policyManager, abi: policyAbi, functionName: "trusted7702Delegates", args: [delegate] });
  return { delegated: true, delegate, trusted };
}
async function handle(request: Request) {
  const accountActions = ["DEPLOY", "LINK", "SEND", "APPROVE", "SET_LIMIT", "ADD_DELEGATE",
    "REMOVE_DELEGATE", "SCAN_7702", "RESOLVE_PENDING", "REVOKE_CONNECTION", "ADD_ACCOUNT", "SWITCH_ACCOUNT"];
  if (accountActions.includes(request.type)) {
    const state = await saved();
    if (request.expectedIndex !== state[BOOK_KEY]?.active) {
      throw new Error("Active account changed. Refresh the wallet and review again.");
    }
  }
  switch (request.type) {
    case "STATUS": return walletStatus();
    case "CREATE": return createWallet(request.password);
    case "IMPORT": return createWallet(request.password, request.recoveryPhrase);
    case "UNLOCK": return unlock(request.password);
    case "ADD_ACCOUNT":
    case "SWITCH_ACCOUNT": return changeAccount(request);
    case "REVEAL_PHRASE": return revealPhrase(request.password);
    case "LOCK": signer = null; await notifyAccountsChanged(); return { locked: true };
    case "DEPLOY": return deployAccount();
    case "LINK": return linkAccount(request.address);
    case "SEND": return submitCall(requireAddress(request.recipient), requireAmount(request.amount), "0x");
    case "APPROVE": return approveToken(request.token, request.spender, request.amount);
    case "SET_LIMIT": return policyUpdate("setMaxNativeTransfer", request.amount);
    case "ADD_DELEGATE": return policyUpdate("whitelist7702Delegate", request.delegate);
    case "REMOVE_DELEGATE": return policyUpdate("removeWhitelisted7702Delegate", request.delegate);
    case "SCAN_7702": return scan7702();
    case "GET_PENDING": return pendingForPopup(request.id);
    case "RESOLVE_PENDING": return resolvePending(request.id, request.approved);
    case "GET_CONNECTIONS": return connections();
    case "REVOKE_CONNECTION": {
      if (typeof request.origin !== "string") throw new Error("Invalid website origin.");
      const allowed = await connections();
      await updateActive({ origins: allowed.filter((origin) => origin !== request.origin) });
      await notifyAccountsChanged();
      return { revoked: true };
    }
    default: throw new Error("Unknown wallet action.");
  }
}

chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
// Serialize actions so an account switch cannot race a signature or deployment.
let workQueue: Promise<unknown> = Promise.resolve();
chrome.runtime.onMessage.addListener((request: Request, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: "Unauthorized caller." });
    return false;
  }
  const isPopup = sender.url?.startsWith(chrome.runtime.getURL("popup.html"));
  const isDapp = request.type === "DAPP_REQUEST" || request.type === "DAPP_POLL";
  if (!isPopup && !isDapp) {
    sendResponse({ ok: false, error: "Unauthorized caller." });
    return false;
  }
  const work = workQueue.then(() => isPopup ? handle(request) : request.type === "DAPP_REQUEST" ? dappRequest(request, sender) : dappPoll(request, sender));
  workQueue = work.catch(() => {});
  work.then(
    (value) => sendResponse({ ok: true, value }),
    (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Wallet action failed.", code: 4001 }),
  );
  return true;
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const entries = await chrome.storage.session.get(null);
  for (const [key, value] of Object.entries(entries)) {
    if (!key.startsWith(PENDING_PREFIX)) continue;
    const pending = value as Pending;
    if (pending.windowId === windowId && pending.status === "waiting") {
      pending.status = "error"; pending.error = "Approval window closed.";
      await putPending(pending);
    }
  }
});
