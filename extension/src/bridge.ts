type BackgroundReply = { ok: true; value: unknown } | { ok: false; error: string; code?: number };

chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== chrome.runtime.id || message.type !== "REFRESH_ACCOUNTS") return;
  void extensionMessage({ type: "DAPP_REQUEST", method: "eth_accounts" }).then((reply) => {
    if (reply.ok) window.postMessage({ source: "paranoia-bridge", event: "accountsChanged", accounts: reply.value }, location.origin);
  });
});

async function extensionMessage(payload: Record<string, unknown>): Promise<BackgroundReply> {
  try {
    const reply = await chrome.runtime.sendMessage(payload) as BackgroundReply | undefined;
    return reply ?? { ok: false, error: "Paranoia did not respond.", code: 4900 };
  }
  catch { return { ok: false, error: "Paranoia extension is unavailable.", code: 4900 }; }
}

window.addEventListener("message", async (event) => {
  if (event.source !== window || event.origin !== location.origin || event.data?.source !== "paranoia-page") return;
  const { id, method, params } = event.data as { id?: unknown; method?: unknown; params?: unknown };
  if (typeof id !== "string" || typeof method !== "string" || id.length > 100 || method.length > 100) return;
  let reply = await extensionMessage({ type: "DAPP_REQUEST", method, params });
  if (reply.ok && typeof reply.value === "object" && reply.value !== null && "pendingId" in reply.value) {
    const pendingId = (reply.value as { pendingId: string }).pendingId;
    for (let attempts = 0; attempts < 600; attempts++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      reply = await extensionMessage({ type: "DAPP_POLL", pendingId });
      if (!reply.ok || !reply.value || typeof reply.value !== "object" || !("waiting" in reply.value)) break;
    }
  }
  window.postMessage({ source: "paranoia-bridge", id, method, ...(reply.ok ? { result: reply.value } : { error: { code: reply.code ?? 4001, message: reply.error } }) }, location.origin);
});
