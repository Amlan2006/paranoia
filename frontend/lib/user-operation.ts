import {
  concatHex,
  encodeFunctionData,
  toHex,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";
import { accountAbi, entryPoint, publicClient } from "./celo";

const entryPointAbi = [
  {
    type: "function",
    name: "getNonce",
    stateMutability: "view",
    inputs: [{ name: "sender", type: "address" }, { name: "key", type: "uint192" }],
    outputs: [{ name: "nonce", type: "uint256" }],
  },
  {
    type: "function",
    name: "getUserOpHash",
    stateMutability: "view",
    inputs: [{ name: "userOp", type: "tuple", components: [
      { name: "sender", type: "address" }, { name: "nonce", type: "uint256" },
      { name: "initCode", type: "bytes" }, { name: "callData", type: "bytes" },
      { name: "accountGasLimits", type: "bytes32" }, { name: "preVerificationGas", type: "uint256" },
      { name: "gasFees", type: "bytes32" }, { name: "paymasterAndData", type: "bytes" }, { name: "signature", type: "bytes" },
    ] }],
    outputs: [{ name: "hash", type: "bytes32" }],
  },
] as const;

type BundlerEstimate = { callGasLimit: string; verificationGasLimit: string; preVerificationGas: string };
type PackedUserOperation = {
  sender: Address; nonce: Hex; initCode: Hex; callData: Hex; accountGasLimits: Hex;
  preVerificationGas: Hex; gasFees: Hex; paymasterAndData: Hex; signature: Hex;
};

async function bundlerRpc<T>(url: string, method: string, params: unknown[]) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const json = await response.json() as { result?: T; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? "Bundler request failed");
  if (!json.result) throw new Error("Bundler returned no result");
  return json.result;
}

export async function submitTransferUserOperation({
  walletClient, owner, smartAccount, recipient, value, bundlerUrl,
}: { walletClient: WalletClient; owner: Address; smartAccount: Address; recipient: Address; value: bigint; bundlerUrl: string }) {
  const callData = encodeFunctionData({ abi: accountAbi, functionName: "execute", args: [recipient, value, "0x"] });
  const nonce = await publicClient.readContract({ address: entryPoint, abi: entryPointAbi, functionName: "getNonce", args: [smartAccount, 0n] });
  const fees = await publicClient.estimateFeesPerGas();
  const maxFeePerGas = fees.maxFeePerGas ?? 1_000_000_000n;
  const maxPriorityFeePerGas = fees.maxPriorityFeePerGas ?? 1_000_000_000n;
  const dummySignature = ("0x" + "00".repeat(65)) as Hex;
  // Bundler JSON-RPC v0.7 uses unpacked gas fields. EntryPoint hashing below
  // uses the packed on-chain struct required by validateUserOp.
  const rpcUserOp = {
    sender: smartAccount, nonce: toHex(nonce), callData,
    callGasLimit: toHex(500_000n), verificationGasLimit: toHex(500_000n),
    preVerificationGas: toHex(100_000n), maxFeePerGas: toHex(maxFeePerGas),
    maxPriorityFeePerGas: toHex(maxPriorityFeePerGas), signature: dummySignature,
  };
  const estimate = await bundlerRpc<BundlerEstimate>(bundlerUrl, "eth_estimateUserOperationGas", [rpcUserOp, entryPoint]);
  const callGasLimit = BigInt(estimate.callGasLimit);
  const verificationGasLimit = BigInt(estimate.verificationGasLimit);
  const preVerificationGas = BigInt(estimate.preVerificationGas);
  const userOp = {
    sender: smartAccount, nonce: toHex(nonce), initCode: "0x", callData,
    accountGasLimits: concatHex([toHex(verificationGasLimit, { size: 16 }), toHex(callGasLimit, { size: 16 })]),
    preVerificationGas: toHex(preVerificationGas),
    gasFees: concatHex([toHex(maxPriorityFeePerGas, { size: 16 }), toHex(maxFeePerGas, { size: 16 })]),
    paymasterAndData: "0x", signature: dummySignature,
  } satisfies PackedUserOperation;
  const hash = await publicClient.readContract({ address: entryPoint, abi: entryPointAbi, functionName: "getUserOpHash", args: [userOp] });
  const signature = await walletClient.signMessage({ account: owner, message: { raw: hash } });
  return bundlerRpc<Hex>(bundlerUrl, "eth_sendUserOperation", [{ ...rpcUserOp, callGasLimit: toHex(callGasLimit), verificationGasLimit: toHex(verificationGasLimit), preVerificationGas: toHex(preVerificationGas), signature }, entryPoint]);
}
