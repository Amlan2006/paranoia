# Paranoia Wallet extension (Celo Sepolia)

This is an independent, testnet-only Chrome Manifest V3 wallet. It creates or imports a 12-word recovery phrase, encrypts that phrase locally with a password, and signs in the extension background worker. It does not use MetaMask's keys or balances.

## Build and load

```bash
cd extension
npm install
npm test
npm run build
```

Open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the absolute `extension/dist` folder. After changing code, rebuild and reload the extension from that page.

## First use

1. Create a wallet and write down its recovery phrase offline. The password alone cannot recover an erased extension installation. Never paste the phrase into a website or share it.
2. Send a small amount of **Celo Sepolia testnet CELO** to the displayed **owner address** to pay the factory deployment transaction.
3. Deploy the smart account. Then send the CELO you want protected to the **smart-account receive address**, not the owner address or PolicyManager.
4. Set a per-transfer limit in Security. Sends from the smart account go through the deployed ERC-4337 account and on-chain policies.

The owner and smart-account addresses are different. The owner pays direct policy-update gas. The smart account needs enough CELO for transfers and UserOperation gas. If you import the recovery phrase into a new installation, use **Link existing account** with your prior smart-account address.

The extension locks after ten minutes of inactivity or when its background worker restarts. The recovery phrase is stored encrypted with PBKDF2-SHA256 (600,000 iterations) and AES-256-GCM. If the creation popup closes before you write down the phrase, unlock and use **Security → Reveal for 30 seconds** with your password. If you lose both the phrase and extension data, the wallet cannot be recovered.

## Connect a website

Reload the unpacked extension after building, then refresh the website tab. Paranoia injects on HTTPS websites and localhost development pages. It announces an EIP-6963 provider and exposes `window.paranoia`. If no other wallet has claimed `window.ethereum`, it also fills that legacy slot; when MetaMask is installed, the website must deliberately select Paranoia through EIP-6963 or `window.paranoia`.

```js
const provider = window.paranoia;
const [smartAccount] = await provider.request({ method: "eth_requestAccounts" });
const txHash = await provider.request({
  method: "eth_sendTransaction",
  params: [{ from: smartAccount, to: "0xRECIPIENT", value: "0x38d7ea4c68000" }], // 0.001 CELO
});
```

Each new site connection opens a Paranoia approval window. Every transaction opens another approval window showing the origin, recipient, value and raw calldata. The extension returns a transaction hash only after the bundler reports an on-chain receipt. Connections can be revoked in **Security → Connected websites**. To exercise the flow with the [test page](examples/dapp.html):

```bash
cd extension/examples
python3 -m http.server 8080
```

Open `http://127.0.0.1:8080/dapp.html` in Chrome. The test page never sends until you enter a recipient and approve the request.

This MVP supports `eth_accounts`, `eth_requestAccounts`, `eth_chainId`, `net_version`, `wallet_switchEthereumChain` for Celo Sepolia, selected read-only RPC methods, and `eth_sendTransaction`. It does not support `personal_sign`, typed-data signing, token swaps, or transactions sent from MetaMask. The existing Paranoia web dashboard is still pinned to the earlier smart account; connecting that dashboard to a newly created extension account needs a separate dashboard migration. Do not rely on this testnet extension for mainnet assets or production use without an independent security review.
