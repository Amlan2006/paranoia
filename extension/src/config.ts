import { defineChain, parseAbi, type Address, type Chain } from "viem";

export const chain = defineChain({
  id: 11_142_220,
  name: "Celo Sepolia",
  nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
  rpcUrls: { default: { http: ["https://forno.celo-sepolia.celo-testnet.org"] } },
  blockExplorers: { default: { name: "Celo Sepolia Explorer", url: "https://celo-sepolia.blockscout.com" } },
});

export const FACTORY = "0xcD0c78baa1d16F22a7FCfd0A043651F3DDd9f4d9" as const;
export const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as const;
export const BUNDLER = "https://public.pimlico.io/v2/11142220/rpc";

export type Network = { chain: Chain; bundler: string; factory?: Address };
function testnet(id: number, name: string, symbol: string, rpc: string, explorer: string): Network {
  return { chain: defineChain({ id, name, testnet: true,
    nativeCurrency: { name: symbol, symbol, decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
    blockExplorers: { default: { name: "Explorer", url: explorer } },
  }), bundler: `https://public.pimlico.io/v2/${id}/rpc` };
}
export const NETWORKS: Network[] = [
  { chain, bundler: BUNDLER, factory: FACTORY },
  testnet(11155111, "Ethereum Sepolia", "ETH", "https://ethereum-sepolia-rpc.publicnode.com", "https://sepolia.etherscan.io"),
  testnet(97, "BNB Smart Chain Testnet", "tBNB", "https://bsc-testnet-dataseed.bnbchain.org", "https://testnet.bscscan.com"),
  testnet(80002, "Polygon Amoy", "POL", "https://polygon-amoy-bor-rpc.publicnode.com", "https://amoy.polygonscan.com"),
];
export function networkById(id: number): Network {
  const network = NETWORKS.find((item) => item.chain.id === id);
  if (!network) throw new Error("Unsupported testnet.");
  return network;
}

export const factoryAbi = parseAbi([
  "function createAccount(address owner,address entryPoint,uint256 maxNativeTransfer) returns (address)",
  "event AccountCreated(address indexed owner,address indexed account,address indexed policyManager)",
]);
export const accountAbi = parseAbi([
  "function entryPoint() view returns (address)",
  "function owner() view returns (address)",
  "function policyManager() view returns (address)",
  "function execute(address target,uint256 value,bytes data)",
  "function setMaxNativeTransfer(uint256 newLimit)",
  "function whitelist7702Delegate(address delegate)",
  "function removeWhitelisted7702Delegate(address delegate)",
]);
export const policyAbi = parseAbi([
  "function maxNativeTransfer() view returns (uint256)",
  "function trusted7702Delegates(address delegate) view returns (bool)",
]);
