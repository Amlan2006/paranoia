type RpcRequest = { method: string; params?: unknown[] | Record<string, unknown> };
type Listener = (...args: unknown[]) => void;
type RpcError = Error & { code?: number };
export {};

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

class ParanoiaProvider {
  readonly isParanoia = true;
  readonly isConnected = () => true;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: RpcError) => void; timer: ReturnType<typeof setTimeout> }>();

  constructor() {
    window.addEventListener("message", (event) => {
      if (event.source !== window || event.origin !== location.origin || event.data?.source !== "paranoia-bridge") return;
      if (event.data.event === "accountsChanged" && Array.isArray(event.data.accounts)) {
        this.emit("accountsChanged", event.data.accounts);
        return;
      }
      const reply = event.data as { id?: string; result?: unknown; error?: { code?: number; message: string } };
      if (typeof reply.id !== "string") return;
      const pending = this.pending.get(reply.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(reply.id);
      if (reply.error) {
        const error = new Error(reply.error.message) as RpcError;
        error.code = reply.error.code;
        pending.reject(error);
      } else {
        if (event.data.method === "eth_requestAccounts") this.emit("accountsChanged", reply.result);
        pending.resolve(reply.result);
      }
    });
  }

  request({ method, params }: RpcRequest): Promise<unknown> {
    if (typeof method !== "string") return Promise.reject(new Error("Invalid RPC method."));
    const id = randomId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Paranoia request timed out."));
      }, 10 * 60 * 1000);
      this.pending.set(id, { resolve, reject, timer });
      window.postMessage({ source: "paranoia-page", id, method, params: params ?? [] }, location.origin);
    });
  }

  on(event: string, listener: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)?.add(listener);
    return this;
  }
  removeListener(event: string, listener: Listener) { this.listeners.get(event)?.delete(listener); return this; }
  private emit(event: string, ...args: unknown[]) { this.listeners.get(event)?.forEach((listener) => listener(...args)); }
}

declare global { interface Window { paranoia?: ParanoiaProvider; ethereum?: unknown } }

const provider = new ParanoiaProvider();
window.paranoia = provider;
if (!window.ethereum) window.ethereum = provider;
const detail = Object.freeze({
  info: { uuid: randomId(), name: "Paranoia Wallet", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%23e73835'/><path d='M16 5 26 9v8c0 6-4 9-10 12C10 26 6 23 6 17V9z' fill='none' stroke='white' stroke-width='3'/></svg>", rdns: "app.paranoia.wallet" },
  provider,
});
window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
window.addEventListener("eip6963:requestProvider", () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail })));
