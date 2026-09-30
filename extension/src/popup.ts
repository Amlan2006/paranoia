import { formatEther, isAddress, parseEther, type Address } from "viem";
import "./popup.css";
import "./popup-wide.css";
import "./popup-phantom.css";

type Status = {
  exists: boolean;
  unlocked: boolean;
  owner?: Address;
  smartAccount?: Address | null;
  ownerBalance?: string;
  smartBalance?: string;
  limit?: string | null;
  policyManager?: Address | null;
};
type Reply<T> = { ok: true; value: T } | { ok: false; error: string };
type PendingApproval = {
  id: string; origin: string; method: "eth_requestAccounts" | "eth_sendTransaction";
  status: string; transaction?: { from: Address; to: Address; value: string; data: string }; operationHash?: string;
};
let current: Status = { exists: false, unlocked: false };
const approvalId = new URLSearchParams(location.search).get("approval");
let setupMode: "create" | "import" = "create";
let pendingPhrase: string | null = null;
let reviewedTransfer: { recipient: Address; amount: string } | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let phraseTimer: ReturnType<typeof setTimeout> | undefined;

function el<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error("Missing interface element: " + id);
  return element as T;
}
function input(id: string): string { return el<HTMLInputElement>(id).value.trim(); }
function text(id: string, value: string) { el(id).textContent = value; }
function show(id: string, visible: boolean) { el(id).hidden = !visible; }
function notify(message: string) {
  text("toast", message); show("toast", true);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => show("toast", false), 6000);
}
async function message<T>(type: string, fields: Record<string, unknown> = {}): Promise<T> {
  const reply = await chrome.runtime.sendMessage({ type, ...fields }) as Reply<T>;
  if (!reply?.ok) throw new Error(reply?.error ?? "Wallet request failed.");
  return reply.value;
}
async function action<T>(type: string, fields: Record<string, unknown> = {}, success?: (result: T) => string) {
  try {
    document.querySelectorAll<HTMLButtonElement>("button").forEach((button) => button.disabled = true);
    const result = await message<T>(type, fields);
    if (success) notify(success(result));
    await refresh();
    return result;
  } catch (error) {
    notify(error instanceof Error ? error.message : "Wallet action failed.");
    return null;
  } finally {
    document.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      if (button.id !== "finish-backup") button.disabled = false;
    });
    if (approvalId) void loadApproval().catch(() => {});
  }
}
async function refresh() {
  try {
    current = await message<Status>("STATUS");
    show("welcome", !current.exists);
    show("unlock", !!current.exists && !current.unlocked);
    show("wallet", !!current.exists && current.unlocked);
    if (current.exists && !current.unlocked) text("locked-owner", current.owner ?? "");
    if (current.unlocked) {
      show("deploy-card", !current.smartAccount);
      show("active-wallet", !!current.smartAccount);
      text("owner-deploy-address", current.owner ?? "");
      text("owner-balance", current.ownerBalance === null ? "Unavailable" : (current.ownerBalance ?? "—") + " CELO");
      if (current.smartAccount) {
        const visibleBalance = current.smartBalance === null ? "—" : displayBalance(current.smartBalance ?? "0");
        text("smart-balance", visibleBalance);
        text("smart-balance-asset", visibleBalance + " CELO");
        text("copy-smart", current.smartAccount.slice(0, 6) + "…" + current.smartAccount.slice(-4));
        text("receive-address", current.smartAccount);
        text("current-limit", current.limit === null ? "Unavailable" : (current.limit ?? "—") + " CELO");
        updateRisk();
      }
    }
    await loadApproval();
    if (current.unlocked) await loadConnections();
  } catch (error) {
    notify(error instanceof Error ? error.message : "Could not load wallet.");
  }
}
async function loadApproval() {
  if (!approvalId) return;
  const pending = await message<PendingApproval | null>("GET_PENDING", { id: approvalId });
  if (!pending) { show("dapp-approval", false); return; }
  show("dapp-approval", true);
  text("dapp-origin", pending.origin);
  text("dapp-title", pending.method === "eth_requestAccounts" ? "Connect website" : "Approve transaction");
  const tx = pending.transaction;
  show("dapp-transaction", !!tx);
  show("dapp-connect-note", !tx);
  if (tx) {
    text("dapp-from", tx.from);
    text("dapp-to", tx.to);
    text("dapp-value", formatEther(BigInt(tx.value)) + " CELO");
    text("dapp-data", tx.data);
    show("dapp-call-warning", tx.data !== "0x");
  }
  const waiting = pending.status === "waiting";
  el<HTMLButtonElement>("dapp-approve").disabled = !waiting;
  el<HTMLButtonElement>("dapp-reject").disabled = !waiting;
  text("dapp-approval-status", waiting
    ? current.unlocked && current.smartAccount ? "Review carefully before approving." : "Unlock and deploy or link your smart account below first."
    : pending.status === "submitted" ? "Submitted to the bundler. Waiting for on-chain confirmation."
      : pending.status === "result" ? "Approved." : pending.status === "error" ? "Rejected or failed." : "Processing…");
}
async function loadConnections() {
  const origins = await message<string[]>("GET_CONNECTIONS");
  const container = el("connected-sites");
  container.replaceChildren();
  if (!origins.length) { const note = document.createElement("p"); note.className = "fineprint"; note.textContent = "No websites connected."; container.append(note); return; }
  for (const origin of origins) {
    const row = document.createElement("div"); row.className = "connected-site";
    const name = document.createElement("span"); name.textContent = origin;
    const button = document.createElement("button"); button.textContent = "Disconnect";
    button.addEventListener("click", async () => { await action("REVOKE_CONNECTION", { origin }, () => "Website disconnected."); });
    row.append(name, button); container.append(row);
  }
}
function displayBalance(raw: string) {
  const value = Number(raw);
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 6 }) : raw;
}
function updateRisk() {
  const element = el("send-risk");
  if (!current.limit || current.smartBalance === null || current.smartBalance === undefined) {
    element.className = "risk neutral";
    element.textContent = "Policy and balance unavailable. Check your connection.";
    return false;
  }
  let amount: bigint;
  try {
    amount = parseEther(input("send-amount"));
    if (amount <= 0n) throw new Error();
  } catch {
    element.className = "risk neutral";
    element.textContent = "Enter an amount to check the spending policy.";
    return false;
  }
  const limit = parseEther(current.limit ?? "0");
  if (amount > limit) {
    element.className = "risk blocked";
    element.textContent = "BLOCKED · Transfer exceeds your " + current.limit + " CELO limit.";
    return false;
  }
  const balance = parseEther(current.smartBalance ?? "0");
  if (amount > balance) {
    element.className = "risk blocked";
    element.textContent = "The smart account needs more CELO for this transfer.";
    return false;
  }
  element.className = "risk safe";
  element.textContent = "SAFE · Within your on-chain spending limit.";
  return true;
}
async function copy(value: string, buttonId: string) {
  try {
    await navigator.clipboard.writeText(value);
    const button = el<HTMLButtonElement>(buttonId);
    const original = button.textContent;
    button.textContent = "✓ Copied";
    setTimeout(() => { button.textContent = original; }, 1800);
  } catch { notify("Could not copy address."); }
}
function tab(name: string) {
  if (name !== "security") clearRevealedPhrase();
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
  for (const pane of ["home", "send", "security", "receive"]) show(pane + "-pane", pane === name);
}
function clearRevealedPhrase() {
  clearTimeout(phraseTimer);
  text("revealed-phrase", "");
  show("revealed-phrase", false);
}

el("start-create").addEventListener("click", () => {
  setupMode = "create"; text("setup-title", "Create wallet"); show("phrase-wrap", false);
  show("welcome", false); show("setup", true);
});
el("start-import").addEventListener("click", () => {
  setupMode = "import"; text("setup-title", "Import wallet"); show("phrase-wrap", true);
  show("welcome", false); show("setup", true);
});
el("setup-back").addEventListener("click", () => { show("setup", false); show("welcome", true); });
el("finish-setup").addEventListener("click", async () => {
  const password = input("setup-password");
  if (password !== input("setup-confirm")) { notify("Passwords do not match."); return; }
  const result = await action<{ owner: Address; recoveryPhrase?: string }>(
    setupMode === "create" ? "CREATE" : "IMPORT",
    { password, recoveryPhrase: setupMode === "import" ? input("phrase") : undefined },
  );
  el<HTMLInputElement>("setup-password").value = "";
  el<HTMLInputElement>("setup-confirm").value = "";
  el<HTMLTextAreaElement>("phrase").value = "";
  if (!result) return;
  show("setup", false);
  if (result.recoveryPhrase) {
    pendingPhrase = result.recoveryPhrase;
    text("recovery-phrase", pendingPhrase);
    show("wallet", false); show("backup", true);
  }
});
el<HTMLInputElement>("backup-confirm").addEventListener("change", (event) => {
  el<HTMLButtonElement>("finish-backup").disabled = !(event.target as HTMLInputElement).checked;
});
el("finish-backup").addEventListener("click", async () => {
  pendingPhrase = null; text("recovery-phrase", "");
  show("backup", false);
  await refresh();
});
el("unlock-button").addEventListener("click", async () => {
  const password = input("unlock-password");
  el<HTMLInputElement>("unlock-password").value = "";
  await action("UNLOCK", { password });
});
el("lock-button").addEventListener("click", async () => { clearRevealedPhrase(); await action("LOCK"); tab("home"); });
el("deploy-button").addEventListener("click", async () => {
  await action<{ smartAccount: Address }>("DEPLOY", {}, (result) => "Smart account deployed: " + result.smartAccount);
});
el("link-button").addEventListener("click", async () => {
  await action("LINK", { address: input("link-address") }, () => "Smart account linked.");
});
el("copy-owner").addEventListener("click", () => { if (current.owner) void copy(current.owner, "copy-owner"); });
el("copy-smart").addEventListener("click", () => { if (current.smartAccount) void copy(current.smartAccount, "copy-smart"); });
el("copy-receive").addEventListener("click", () => { if (current.smartAccount) void copy(current.smartAccount, "copy-receive"); });
document.querySelectorAll<HTMLButtonElement>(".tab").forEach((button) => button.addEventListener("click", () => tab(button.dataset.tab ?? "send")));
document.querySelectorAll<HTMLButtonElement>(".quick-action").forEach((button) => button.addEventListener("click", () => tab(button.dataset.tab ?? "home")));
for (const id of ["send-amount", "recipient"]) {
  el(id).addEventListener("input", () => {
    reviewedTransfer = null;
    show("send-review", false);
    updateRisk();
  });
}
el("review-send").addEventListener("click", () => {
  if (!isAddress(input("recipient"))) { notify("Enter a valid recipient address."); return; }
  if (!updateRisk()) { notify("This transfer cannot be submitted."); return; }
  reviewedTransfer = { recipient: input("recipient") as Address, amount: input("send-amount") };
  text("send-summary", "Send " + reviewedTransfer.amount + " CELO to " + reviewedTransfer.recipient + " from your protected account?");
  show("send-review", true);
});
el("cancel-send").addEventListener("click", () => { reviewedTransfer = null; show("send-review", false); });
el("confirm-send").addEventListener("click", async () => {
  if (!reviewedTransfer || !updateRisk()) { reviewedTransfer = null; show("send-review", false); return; }
  const result = await action<{ userOperationHash: string }>("SEND", reviewedTransfer, (value) => "UserOperation submitted: " + value.userOperationHash);
  if (result) { reviewedTransfer = null; show("send-review", false); }
});
el("approve-button").addEventListener("click", async () => {
  if (!confirm("Approve " + input("token-amount") + " tokens for spender " + input("spender-address") + "?")) return;
  await action<{ userOperationHash: string }>("APPROVE", { token: input("token-address"), spender: input("spender-address"), amount: input("token-amount") }, (value) => "Approval submitted: " + value.userOperationHash);
});
el("update-limit").addEventListener("click", async () => {
  await action("SET_LIMIT", { amount: input("new-limit") }, () => "Spending limit updated on-chain.");
});
el("reveal-phrase").addEventListener("click", async () => {
  const password = input("reveal-password");
  el<HTMLInputElement>("reveal-password").value = "";
  const result = await action<{ recoveryPhrase: string }>("REVEAL_PHRASE", { password });
  if (!result) return;
  text("revealed-phrase", result.recoveryPhrase);
  show("revealed-phrase", true);
  clearTimeout(phraseTimer);
  phraseTimer = setTimeout(clearRevealedPhrase, 30_000);
});
el("add-delegate").addEventListener("click", async () => {
  await action("ADD_DELEGATE", { delegate: input("delegate-address") }, () => "Delegate added to allowlist.");
});
el("remove-delegate").addEventListener("click", async () => {
  await action("REMOVE_DELEGATE", { delegate: input("delegate-address") }, () => "Delegate removed from allowlist.");
});
el("scan-7702").addEventListener("click", async () => {
  const result = await action<{ delegated: boolean; delegate?: Address; trusted?: boolean }>("SCAN_7702");
  if (result) text("delegation-status", !result.delegated ? "No delegation detected." : (result.trusted ? "Trusted: " : "Untrusted: ") + result.delegate);
});
el("dapp-approve").addEventListener("click", async () => {
  if (!approvalId) return;
  await action("RESOLVE_PENDING", { id: approvalId, approved: true }, () => "Website request approved.");
  await loadApproval();
});
el("dapp-reject").addEventListener("click", async () => {
  if (!approvalId) return;
  await action("RESOLVE_PENDING", { id: approvalId, approved: false }, () => "Website request rejected.");
  await loadApproval();
});
void refresh();
