import { createPublicClient, defineChain, http, parseAbi } from "viem";

export const celoSepolia = defineChain({
  id: 11_142_220,
  name: "Celo Sepolia",
  nativeCurrency: { name: "Celo", symbol: "CELO", decimals: 18 },
  rpcUrls: { default: { http: ["https://forno.celo-sepolia.celo-testnet.org"] } },
  blockExplorers: { default: { name: "CeloScan", url: "https://celo-sepolia.blockscout.com" } },
});

export const paranoiaAccount = "0x479aa953B3d730588734bacc0dfD9D2Cb7e1C2db" as const;
export const policyManager = "0x0a964BAacbaC37f788c898b2E2FB9680B68179c1" as const;
export const entryPoint = "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as const;

export const publicClient = createPublicClient({ chain: celoSepolia, transport: http() });

export const accountAbi = parseAbi([
  "function owner() view returns (address)",
  "function execute(address target,uint256 value,bytes data)",
  "function setMaxNativeTransfer(uint256 newLimit)",
  "function setTrustedTarget(address target,bool trusted)",
  "function whitelist7702Delegate(address delegate)",
  "function removeWhitelisted7702Delegate(address delegate)",
]);

export const policyAbi = parseAbi([
  "function maxNativeTransfer() view returns (uint256)",
  "function trusted7702Delegates(address delegate) view returns (bool)",
  "function trustedTargets(address target) view returns (bool)",
]);

export const erc20Abi = parseAbi([
  "function approve(address spender,uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);
