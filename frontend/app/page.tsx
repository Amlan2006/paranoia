"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Check,
  ChevronRight,
  Copy,
  Eye,
  LockKeyhole,
  Send,
  Settings2,
  ShieldCheck,
  TriangleAlert,
  WalletCards,
} from "lucide-react";
import {
  createWalletClient,
  custom,
  encodeFunctionData,
  formatEther,
  isAddress,
  maxUint256,
  parseEther,
  parseUnits,
  type Address,
} from "viem";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  accountAbi,
  celoSepolia,
  erc20Abi,
  paranoiaAccount,
  policyAbi,
  policyManager,
  publicClient,
} from "@/lib/celo";
import { submitTransferUserOperation } from "@/lib/user-operation";

declare global {
  interface Window {
    ethereum?: {
      request: (args: {
        method: string;
        params?: unknown[];
      }) => Promise<string[]>;
    };
  }
}
const short = (v: string) =>
  v.length > 12 ? v.slice(0, 6) + "…" + v.slice(-4) : v;
const bundlerUrl = process.env.NEXT_PUBLIC_BUNDLER_RPC_URL;
function Pill({
  children,
  red = false,
}: {
  children: React.ReactNode;
  red?: boolean;
}) {
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold " +
        (red
          ? "border-[#f04b48]/30 bg-[#f04b48]/10 text-[#ff8987]"
          : "border-emerald-300/20 bg-emerald-300/10 text-emerald-300")
      }
    >
      {children}
    </span>
  );
}
function Card({
  icon,
  title,
  copy,
  value,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  copy: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <article className="rounded-[28px] border border-white/[.09] bg-[#181819] p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="grid size-10 place-items-center rounded-xl bg-white/[.06] text-[#ff7774]">
          {icon}
        </div>
        <Pill>
          <Check className="size-3" />
          {value}
        </Pill>
      </div>
      <h3 className="mt-7 text-xl font-medium tracking-[-.04em]">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-white/45">{copy}</p>
      {children}
    </article>
  );
}

export default function Home() {
  const [wallet, setWallet] = useState<Address | null>(null);
  const [balance, setBalance] = useState("—");
  const [balanceWei, setBalanceWei] = useState<bigint | null>(null);
  const [limit, setLimit] = useState("1");
  const [message, setMessage] = useState("");
  const [amount, setAmount] = useState("0.20");
  const [recipient, setRecipient] = useState("");
  const [review, setReview] = useState(false);
  const [delegate, setDelegate] = useState("");
  const [delegation, setDelegation] = useState(
    "Connect an owner wallet to scan.",
  );
  const [token, setToken] = useState("");
  const [spender, setSpender] = useState("");
  const [approval, setApproval] = useState("");
  const [unlimited, setUnlimited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const total = Number(amount) || 0;
  const blocked = total > Number(limit || 1);

  const refresh = useCallback(async (owner?: Address | null) => {
    try {
      const [native, nextLimit] = await Promise.all([
        publicClient.getBalance({ address: paranoiaAccount }),
        publicClient.readContract({
          address: policyManager,
          abi: policyAbi,
          functionName: "maxNativeTransfer",
        }),
      ]);
      setBalance(formatEther(native));
      setBalanceWei(native);
      setLimit(formatEther(nextLimit));
      if (owner) {
        const code = await publicClient.getCode({ address: owner });
        if (code && code.startsWith("0xef0100") && code.length >= 48) {
          const implementation = ("0x" + code.slice(8, 48)) as Address;
          const trusted = await publicClient.readContract({
            address: policyManager,
            abi: policyAbi,
            functionName: "trusted7702Delegates",
            args: [implementation],
          });
          setDelegation(
            "Detected " +
              short(implementation) +
              (trusted ? " — trusted" : " — untrusted"),
          );
        } else setDelegation("No EIP-7702 delegation detected.");
      }
    } catch {
      setMessage(
        "Could not read Celo Sepolia state. Check your connection and try again.",
      );
    }
  }, []);
  useEffect(() => {
    void refresh(wallet);
  }, [refresh, wallet]);

  function walletClient() {
    if (!window.ethereum || !wallet)
      throw new Error("Connect the owner wallet first.");
    return createWalletClient({
      chain: celoSepolia,
      transport: custom(window.ethereum),
    });
  }
  async function connect() {
    if (!window.ethereum) {
      setMessage("Install MetaMask to connect an owner wallet.");
      return;
    }
    try {
      const client = createWalletClient({
        chain: celoSepolia,
        transport: custom(window.ethereum),
      });
      await client.switchChain({ id: celoSepolia.id });
      const accounts = await client.getAddresses();
      const owner = accounts[0];
      if (!owner) throw new Error("No account returned.");
      const accountOwner = await publicClient.readContract({
        address: paranoiaAccount,
        abi: accountAbi,
        functionName: "owner",
      });
      if (owner.toLowerCase() !== accountOwner.toLowerCase())
        setMessage(
          "Connected wallet is not the configured Paranoia owner. Reads work; policy writes will be rejected.",
        );
      else setMessage("");
      setWallet(owner);
      await refresh(owner);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Wallet connection was cancelled.",
      );
    }
  }
  async function copySmartAccountAddress() {
    try {
      await navigator.clipboard.writeText(paranoiaAccount);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setMessage("Could not copy the smart-account address.");
    }
  }
  async function writePolicy(
    functionName:
      | "setMaxNativeTransfer"
      | "whitelist7702Delegate"
      | "removeWhitelisted7702Delegate",
    args: readonly unknown[],
  ) {
    try {
      setBusy(true);
      setMessage("");
      const hash = await walletClient().writeContract({
        address: paranoiaAccount,
        abi: accountAbi,
        functionName,
        args: args as never,
        account: wallet!,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await refresh(wallet);
      setMessage("Policy update confirmed: " + short(hash));
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Policy update failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function submitApproval() {
    if (!isAddress(token) || !isAddress(spender)) {
      setMessage("Enter valid token and spender addresses.");
      return;
    }
    try {
      setBusy(true);
      const decimals = await publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "decimals",
      });
      const value = unlimited
        ? maxUint256
        : parseUnits(approval || "0", decimals);
      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [spender, value],
      });
      if (value === maxUint256) {
        setMessage("UNLIMITED_APPROVAL — blocked before submission.");
        return;
      }
      const hash = await walletClient().writeContract({
        address: paranoiaAccount,
        abi: accountAbi,
        functionName: "execute",
        args: [token, 0n, data],
        account: wallet!,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setMessage("Limited approval submitted: " + short(hash));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Approval failed.");
    } finally {
      setBusy(false);
    }
  }
  async function submitUserOperation() {
    if (!wallet || !isAddress(recipient)) {
      setMessage("Connect the owner wallet and enter a valid recipient.");
      return;
    }
    if (blocked) {
      setMessage("SPENDING_LIMIT_EXCEEDED — blocked before submission.");
      return;
    }
    if (!bundlerUrl) {
      setMessage(
        "Set NEXT_PUBLIC_BUNDLER_RPC_URL to submit ERC-4337 UserOperations through your selected bundler.",
      );
      return;
    }
    try {
      setBusy(true);
      const hash = await submitTransferUserOperation({
        walletClient: walletClient(),
        owner: wallet,
        smartAccount: paranoiaAccount,
        recipient,
        value: parseEther(amount),
        bundlerUrl,
      });
      setMessage("UserOperation submitted: " + short(hash));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "UserOperation submission failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#0d0d0e] text-white selection:bg-[#e63735]">
      <div className="mx-auto flex min-h-screen max-w-[1500px]">
        <aside className="hidden w-[248px] shrink-0 flex-col border-r border-white/[.08] bg-[#111112] px-5 py-7 lg:flex">
          <div className="flex items-center gap-3 px-2">
            <div className="grid size-10 place-items-center rounded-2xl bg-[#e63735]">
              <ShieldCheck className="size-5" />
            </div>
            <span className="text-xl font-semibold tracking-[-.06em]">
              paranoia
            </span>
          </div>
          <nav className="mt-12 space-y-2">
            {[
              [WalletCards, "Wallet"],
              [Send, "Send"],
              [Activity, "Activity"],
              [Settings2, "Policies"],
            ].map(([Icon, label], i) => (
              <button
                key={String(label)}
                className={
                  "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm " +
                  (i === 0
                    ? "bg-white/[.09]"
                    : "text-white/45 hover:bg-white/[.05] hover:text-white")
                }
              >
                <Icon className="size-[18px]" />
                {String(label)}
              </button>
            ))}
          </nav>
          <div className="mt-auto rounded-2xl border border-white/[.08] bg-white/[.035] p-4">
            <LockKeyhole className="size-4 text-[#ff7774]" />
            <p className="mt-3 text-sm font-medium">Security is on-chain</p>
            <p className="mt-1 text-xs leading-5 text-white/45">
              Policies execute inside your smart account.
            </p>
          </div>
        </aside>
        <section className="min-w-0 flex-1 px-4 py-4 sm:px-7 sm:py-7 lg:px-10">
          <header className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 lg:hidden">
              <div className="grid size-10 place-items-center rounded-2xl bg-[#e63735]">
                <ShieldCheck className="size-5" />
              </div>
              <span className="text-xl font-semibold tracking-[-.06em]">
                paranoia
              </span>
            </div>
            <div className="hidden lg:block">
              <p className="text-sm text-white/45">
                Celo Sepolia · Chain 11142220
              </p>
              <h1 className="mt-1 text-2xl font-medium tracking-[-.05em]">
                Your protected wallet
              </h1>
            </div>
            {wallet ? (
              <div className="flex items-center gap-2 rounded-2xl border border-white/[.1] bg-white/[.05] px-3 py-2.5 text-sm">
                <span className="size-2 rounded-full bg-emerald-400" />
                {short(wallet)}
              </div>
            ) : (
              <Button
                onClick={connect}
                className="h-11 rounded-2xl bg-white px-5 font-semibold text-black hover:bg-white/85"
              >
                Connect wallet
              </Button>
            )}
          </header>
          {message && (
            <p className="mt-3 rounded-xl border border-white/[.08] bg-white/[.04] px-3 py-2 text-sm text-white/70">
              {message}
            </p>
          )}
          <Tabs defaultValue="wallet" className="mt-7 sm:mt-10">
            <TabsList className="h-auto gap-1 rounded-xl border border-white/[.08] bg-white/[.035] p-1">
              <TabsTrigger
                value="wallet"
                className="rounded-lg px-4 py-2 data-[state=active]:bg-white data-[state=active]:text-black"
              >
                Wallet
              </TabsTrigger>
              <TabsTrigger
                value="send"
                className="rounded-lg px-4 py-2 data-[state=active]:bg-white data-[state=active]:text-black"
              >
                Send
              </TabsTrigger>
              <TabsTrigger
                value="security"
                className="rounded-lg px-4 py-2 data-[state=active]:bg-white data-[state=active]:text-black"
              >
                Security
              </TabsTrigger>
            </TabsList>
            <TabsContent value="wallet" className="mt-7 outline-none">
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,.72fr)]">
                <article className="relative overflow-hidden rounded-[28px] border border-white/[.09] bg-[#181819] p-6 sm:p-9">
                  <div className="pointer-events-none absolute -right-24 -top-28 size-72 rounded-full bg-[#e63735]/20 blur-3xl" />
                  <div className="relative flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm text-white/50">
                        Live smart-account balance
                      </p>
                      <h2 className="mt-3 text-5xl font-medium tracking-[-.075em] sm:text-7xl">
                        {balance}{" "}
                        <span className="text-2xl text-white/40 sm:text-3xl">
                          CELO
                        </span>
                      </h2>
                      <p className="mt-3 text-sm text-white/42">
                        Fetched from Celo Sepolia.
                      </p>
                      {balanceWei === 0n && <div className="mt-6 rounded-2xl border border-[#e63735]/35 bg-[#e63735]/10 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[.12em] text-[#ff8a87]">
                          Fund this smart account
                        </p>
                        <p className="mt-2 break-all font-mono text-xs text-white/85 sm:text-sm">
                          {paranoiaAccount}
                        </p>
                        <p className="mt-2 text-xs leading-5 text-white/55">
                          Send CELO here — not to the PolicyManager.
                        </p>
                      </div>}
                    </div>
                    <Pill>
                      <Check className="size-3" />
                      PROTECTED
                    </Pill>
                  </div>
                  <div className="relative mt-10 flex flex-wrap gap-3">
                    <button
                      onClick={copySmartAccountAddress}
                      className="flex items-center gap-2 rounded-xl border border-white/[.1] bg-black/20 px-3 py-2.5 text-xs text-white/65"
                    >
                      {copied ? <Check className="size-3.5 text-emerald-300" /> : <Copy className="size-3.5" />}
                      {copied ? "Copied" : short(paranoiaAccount)}
                    </button>
                    <a
                      href={
                        "https://celo-sepolia.blockscout.com/address/" +
                        paranoiaAccount
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 rounded-xl border border-white/[.1] bg-black/20 px-3 py-2.5 text-xs text-white/65"
                    >
                      <Eye className="size-3.5" />
                      Explorer
                    </a>
                  </div>
                </article>
                <article className="rounded-[28px] border border-white/[.09] bg-[#181819] p-6">
                  <div className="flex justify-between">
                    <p className="text-sm font-medium">Live policy status</p>
                    <ShieldCheck className="size-5 text-[#ff6b68]" />
                  </div>
                  <div className="mt-7 space-y-5">
                    <div className="flex justify-between">
                      <span className="text-sm text-white/55">
                        ERC-4337 account
                      </span>
                      <Pill>ACTIVE</Pill>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-white/55">
                        Spending limit
                      </span>
                      <Pill>{limit} CELO</Pill>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-white/55">
                        Approval protection
                      </span>
                      <Pill>ACTIVE</Pill>
                    </div>
                    <p className="border-t border-white/[.08] pt-4 text-xs leading-5 text-white/45">
                      {delegation}
                    </p>
                  </div>
                </article>
              </div>
            </TabsContent>
            <TabsContent value="send" className="mt-7 outline-none">
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(350px,.9fr)]">
                <section className="rounded-[28px] border border-white/[.09] bg-[#181819] p-6 sm:p-8">
                  <p className="text-sm text-white/45">ERC-4337 transfer</p>
                  <h2 className="mt-2 text-3xl font-medium tracking-[-.055em]">
                    Send CELO securely
                  </h2>
                  <label className="mt-8 block text-sm text-white/55">
                    Recipient
                    <input
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                      placeholder="0x…"
                      className="mt-2 w-full rounded-2xl border border-white/[.1] bg-black/25 px-4 py-4 text-base text-white outline-none placeholder:text-white/25"
                    />
                  </label>
                  <label className="mt-5 block text-sm text-white/55">
                    Amount
                    <input
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="mt-2 w-full rounded-2xl border border-white/[.1] bg-black/25 px-4 py-4 text-2xl text-white outline-none"
                    />
                  </label>
                  <Button
                    onClick={() => setReview(true)}
                    className="mt-6 h-12 w-full rounded-2xl bg-[#e63735] text-base hover:bg-[#f04744]"
                  >
                    Review transaction
                  </Button>
                  <Button
                    onClick={submitUserOperation}
                    disabled={busy}
                    className="mt-3 h-12 w-full rounded-2xl bg-white text-black hover:bg-white/85"
                  >
                    Submit UserOperation
                  </Button>
                </section>
                <article
                  className={
                    "rounded-[28px] border p-6 sm:p-8 " +
                    (blocked
                      ? "border-[#f04b48]/30 bg-[#271617]"
                      : "border-white/[.09] bg-[#181819]")
                  }
                >
                  <div className="flex justify-between">
                    <p className="text-sm text-white/50">
                      Live policy simulation
                    </p>
                    {blocked ? (
                      <TriangleAlert className="size-5 text-[#ff8987]" />
                    ) : (
                      <ShieldCheck className="size-5 text-emerald-300" />
                    )}
                  </div>
                  <p className="mt-7 text-4xl font-medium tracking-[-.065em]">
                    {blocked ? "BLOCKED" : "SAFE"}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-white/52">
                    {blocked
                      ? total.toFixed(2) +
                        " CELO exceeds the current " +
                        limit +
                        " CELO limit."
                      : "This transfer is within the current on-chain spending limit."}
                  </p>
                  <p className="mt-7 border-t border-white/[.09] pt-5 text-xs text-white/40">
                    {bundlerUrl
                      ? "Bundler configured"
                      : "Set NEXT_PUBLIC_BUNDLER_RPC_URL before UserOperation submission."}
                  </p>
                </article>
              </div>
            </TabsContent>
            <TabsContent value="security" className="mt-7 outline-none">
              <div className="grid gap-5 lg:grid-cols-2">
                <Card
                  icon={<WalletCards className="size-5" />}
                  title="Native spending limit"
                  description="Live policy value from PolicyManager."
                  value={limit + " CELO"}
                >
                  <div className="mt-6 flex gap-2">
                    <input
                      value={limit}
                      onChange={(e) => setLimit(e.target.value)}
                      inputMode="decimal"
                      className="min-w-0 rounded-xl border border-white/[.1] bg-black/25 px-3 py-2 text-sm outline-none"
                    />
                    <Button
                      disabled={busy}
                      onClick={() =>
                        writePolicy("setMaxNativeTransfer", [parseEther(limit)])
                      }
                      className="rounded-xl bg-white text-black"
                    >
                      Update
                    </Button>
                  </div>
                </Card>
                <Card
                  icon={<LockKeyhole className="size-5" />}
                  title="Unlimited approvals"
                  description="Analyze and submit limited ERC-20 approvals. Unlimited values are blocked before signing."
                  value="ACTIVE"
                >
                  <div className="mt-6 space-y-2">
                    <input
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder="Token address"
                      className="w-full rounded-xl border border-white/[.1] bg-black/25 px-3 py-2 text-sm outline-none"
                    />
                    <input
                      value={spender}
                      onChange={(e) => setSpender(e.target.value)}
                      placeholder="Spender address"
                      className="w-full rounded-xl border border-white/[.1] bg-black/25 px-3 py-2 text-sm outline-none"
                    />
                    <div className="flex gap-2">
                      <input
                        value={approval}
                        onChange={(e) => setApproval(e.target.value)}
                        placeholder="Amount"
                        className="min-w-0 flex-1 rounded-xl border border-white/[.1] bg-black/25 px-3 py-2 text-sm outline-none"
                      />
                      <Button
                        onClick={submitApproval}
                        disabled={busy}
                        className="rounded-xl bg-white text-black"
                      >
                        Approve
                      </Button>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-white/50">
                      <input
                        type="checkbox"
                        checked={unlimited}
                        onChange={(e) => setUnlimited(e.target.checked)}
                      />
                      Unlimited (will block)
                    </label>
                  </div>
                </Card>
                <Card
                  icon={<ShieldCheck className="size-5" />}
                  title="EIP-7702 scan"
                  description={delegation}
                  value="LIVE"
                >
                  <Button
                    onClick={() => refresh(wallet)}
                    className="mt-6 rounded-xl bg-white text-black"
                  >
                    Scan owner
                  </Button>
                </Card>
                <Card
                  icon={<Settings2 className="size-5" />}
                  title="Delegate allowlist"
                  description="Only allowlisted delegates can be approved through Paranoia."
                  value="ON-CHAIN"
                >
                  <div className="mt-6 flex gap-2">
                    <input
                      value={delegate}
                      onChange={(e) => setDelegate(e.target.value)}
                      placeholder="Delegate address"
                      className="min-w-0 flex-1 rounded-xl border border-white/[.1] bg-black/25 px-3 py-2 text-sm outline-none"
                    />
                    <Button
                      disabled={!isAddress(delegate) || busy}
                      onClick={() =>
                        writePolicy("whitelist7702Delegate", [delegate])
                      }
                      className="rounded-xl bg-white text-black"
                    >
                      Add
                    </Button>
                    <Button
                      disabled={!isAddress(delegate) || busy}
                      onClick={() =>
                        writePolicy("removeWhitelisted7702Delegate", [delegate])
                      }
                      className="rounded-xl border border-white/[.15] bg-transparent"
                    >
                      Remove
                    </Button>
                  </div>
                </Card>
              </div>
              <div className="mt-5 rounded-[28px] border border-white/[.09] bg-[#181819] p-6">
                <p className="text-sm text-white/45">Policy manager — configuration only, do not fund</p>
                <p className="mt-2 font-mono text-sm text-white/75">
                  {policyManager}
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </section>
      </div>
      <Dialog open={review} onOpenChange={setReview}>
        <DialogContent className="border-white/[.12] bg-[#171718] p-6 text-white sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="text-2xl tracking-[-.045em]">
              Transaction review
            </DialogTitle>
            <DialogDescription className="text-white/45">
              Paranoia checks this request before it reaches the EntryPoint.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-2xl bg-black/25 p-4 text-sm">
            <div className="flex justify-between">
              <span className="text-white/45">Send</span>
              <span>{total.toFixed(2)} CELO</span>
            </div>
            <div className="mt-3 flex justify-between">
              <span className="text-white/45">To</span>
              <span>{recipient ? short(recipient) : "Recipient required"}</span>
            </div>
          </div>
          <div
            className={
              "rounded-2xl border p-4 " +
              (blocked
                ? "border-[#f04b48]/25 bg-[#f04b48]/10"
                : "border-emerald-300/20 bg-emerald-300/10")
            }
          >
            <p className="font-medium">
              {blocked ? "Transaction blocked" : "Safe to submit"}
            </p>
            <p className="mt-1 text-sm text-white/55">
              {blocked
                ? "SPENDING_LIMIT_EXCEEDED — this transfer is above the on-chain limit."
                : "The transfer is within the on-chain spending limit."}
            </p>
          </div>
          <DialogFooter>
            <Button
              onClick={() => setReview(false)}
              disabled={blocked || !recipient}
              className="h-11 rounded-xl bg-white text-black hover:bg-white/85"
            >
              {blocked ? "Blocked by policy" : "Ready for UserOperation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
