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

## Owner delegation protection and deployment

The current Solidity source rejects direct owner calls whenever the owner has
nonempty code, including EIP-7702 delegation indicators. This applies to
`execute` and every policy setter, even for allowlisted delegates. It prevents
delegated code from acting as the owner to raise limits or drain the account.
The revert is `DirectOwnerCallWithCode(owner)`.

Owner-key-signed ERC-4337 UserOperations remain supported through the trusted
EntryPoint, including policy updates executed as account self-calls. This does
not protect against a stolen owner key or an owner signing a harmful operation.
The extension's policy-update buttons currently use direct owner transactions;
they require the owner's actual delegation to be revoked first if this guard is
triggered. Removing an address from the delegate allowlist does not revoke an
EIP-7702 delegation. The Scan button reports delegation and allowlist status;
it is not itself an on-chain enforcement mechanism.

The hardened factory deployed on Celo Sepolia (chain 11142220) is
`0xcD0c78baa1d16F22a7FCfd0A043651F3DDd9f4d9`, now configured in
`src/config.ts`. Its initial account is
`0x214a78a58D316d2D286E8d7e150a8a4DB677Ec3a`, owned by
`0x47ADF21c50D82fDC77Fc6C518659690797f6E6f2`, with PolicyManager
`0x67E19e8b852b9f9c315749d4b162FF9a2F2a0FD4` and a 0.05 CELO per-transfer
limit. The extension's create-account flow uses the new factory and keeps its
existing initial limit of 1 CELO for independently created accounts.

Previously deployed accounts are not upgraded. Reload the rebuilt extension
to use the new factory for future account creation. Existing linked accounts
and wallet storage remain unchanged. Link the initial account only if your
extension's owner matches its owner; creating an account for a different
extension owner requires a separate deployment through the new factory.
Rebuilding or linking an old account does not add the guard.

Run the delegation regression suite from the repository root:

```bash
forge test --match-contract Delegation7702Test -vv
```

These tests use disposable local keys and real EIP-7702 delegation semantics.
Signed-operation tests exercise the account's validation/execution boundary;
they are not full bundler or deployed EntryPoint integration tests. Calls to
untrusted delegated targets remain permitted unless separately blocked, and
policy updates do not yet have a guardian or timelock.

For a read-only simulation against deployed accounts, serve `extension/examples`
and open `http://127.0.0.1:8080/delegation-attack.html`. Keep
`delegation-simulation.mjs` and `delegation-fixture.json` alongside the HTML.
The fixture contains the compiled runtime of the deliberately unsafe delegate
in `test/Delegation7702.t.sol`; it is only injected through `eth_call` state
overrides. The page verifies delegation execution, tests a limit-change/drain
and a direct call, and accepts only the exact owner-code guard revert as a
blocked result. It never signs or broadcasts a delegation. The old account can
be selected as a vulnerable comparison. This checks these specific contract
paths, not the full extension or all possible attacks.

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
