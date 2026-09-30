# Paranoia

## Hackathon MVP Build Specification

**Paranoia** is an ERC-4337 programmable smart wallet that protects users from dangerous transactions before they execute.

The wallet applies security policies on-chain and blocks actions such as:

- Unlimited ERC-20 approvals
- Transfers above configured spending limits
- Calls to untrusted contracts
- Suspicious or untrusted EIP-7702 delegations

The goal of this MVP is to prove one idea:

> A valid signature should not automatically mean a dangerous transaction is allowed.

---

# 1. MVP Goal

Build a working ERC-4337 smart account with a security policy layer.

The user controls the account using an owner EOA.

Transactions are submitted through ERC-4337, but before execution the smart account verifies that the requested action satisfies the user's security policies.

The MVP must demonstrate:

1. A normal transaction being allowed.
2. An unlimited ERC-20 approval being blocked.
3. A transfer above the configured spending limit being blocked.
4. An EIP-7702 delegation being detected and classified as trusted or untrusted.
5. A simple security dashboard explaining why an action is safe or blocked.

---

# 2. Product Description

Paranoia is a smart crypto wallet built using ERC-4337.

It protects users from dangerous transactions before they happen.

The wallet checks transactions against security rules such as:

- Spending limits
- Trusted contracts
- Token approval limits
- EIP-7702 delegation status

Even if a user accidentally attempts to execute a dangerous transaction, the wallet can reject it.

Paranoia should feel like a firewall for a crypto wallet.

---

# 3. Core Architecture

```text
                    User
                     |
                     v
                 Frontend
                     |
                     v
              Build UserOperation
                     |
                     v
             ERC-4337 EntryPoint
                     |
                     v
             ParanoiaAccount
                     |
                     v
               PolicyManager
                     |
          +----------+----------+
          |          |          |
          v          v          v
      Spending    Approval    Target
       Policy      Policy    Allowlist
          |          |          |
          +----------+----------+
                     |
               SAFE / BLOCK
                     |
                     v
                  execute()
                     |
                     v
                 Blockchain
```

EIP-7702 monitoring is an additional layer:

```text
Owner EOA
   |
   v
EIP-7702 Scanner
   |
   +--> No delegation --> SAFE
   |
   +--> Delegation found
             |
             v
       Extract delegate
             |
             v
       Trusted delegate?
          YES / NO
```

---

# 4. Tech Stack

## Smart Contracts

- Solidity
- Foundry
- OpenZeppelin
- ERC-4337 reference / compatible account abstraction contracts
- Existing ERC-4337 EntryPoint deployment where possible

## Frontend

Preferred:

- Next.js
- TypeScript
- Tailwind CSS
- viem
- wagmi

Alternative if faster:

- React + Vite
- viem

## Network

Use an EVM testnet supported by the hackathon.

Do not hardcode mainnet-only assumptions.

---

# 5. Repository Structure

```text
paranoia/
|
|-- contracts/
|   |-- src/
|   |   |-- ParanoiaAccount.sol
|   |   |-- ParanoiaAccountFactory.sol
|   |   |-- PolicyManager.sol
|   |   |-- interfaces/
|   |   |   |-- IPolicyManager.sol
|   |   |
|   |   |-- mocks/
|   |       |-- MockERC20.sol
|   |       |-- MaliciousSpender.sol
|   |       |-- TrustedTarget.sol
|   |
|   |-- test/
|   |   |-- ParanoiaAccount.t.sol
|   |   |-- PolicyManager.t.sol
|   |   |-- AttackDemo.t.sol
|   |
|   |-- script/
|       |-- Deploy.s.sol
|
|-- frontend/
|   |-- app/
|   |-- components/
|   |-- lib/
|   |   |-- account.ts
|   |   |-- policy.ts
|   |   |-- eip7702.ts
|   |   |-- transactionDecoder.ts
|   |
|   |-- hooks/
|
|-- README.md
|-- BUILD_SPEC.md
```

Keep the architecture small.

Do not add unnecessary abstraction layers.

---

# 6. Smart Account

Create:

```text
ParanoiaAccount.sol
```

The account should be an ERC-4337-compatible smart account.

It must:

- Have one owner EOA for the MVP
- Validate owner signatures
- Accept execution through the ERC-4337 EntryPoint
- Check transaction policies before execution
- Hold ETH and ERC-20 tokens
- Execute calls only when policy validation succeeds

Conceptual interface:

```solidity
function execute(
    address target,
    uint256 value,
    bytes calldata data
) external;
```

Before executing:

```solidity
policyManager.validate(
    target,
    value,
    data
);
```

If the transaction violates a mandatory policy, revert.

---

# 7. Policy Manager

Create:

```text
PolicyManager.sol
```

This contract stores and validates wallet security policies.

Minimum state:

```solidity
address public account;

uint256 public maxNativeTransfer;

mapping(address => bool) public trustedTargets;

mapping(address => bool) public trusted7702Delegates;
```

The account owner must be able to configure policies.

Example functions:

```solidity
function setMaxNativeTransfer(uint256 amount) external;

function setTrustedTarget(
    address target,
    bool trusted
) external;

function setTrusted7702Delegate(
    address delegate,
    bool trusted
) external;
```

Only the correct account owner / authorized account flow should modify policy state.

---

# 8. Policy 1 — Native Token Spending Limit

A user can configure the maximum amount of ETH/native token that can leave the account in one transaction.

Example:

```text
Maximum transfer = 1 ETH

0.5 ETH -> ALLOWED
1 ETH   -> ALLOWED
5 ETH   -> BLOCKED
```

MVP behavior:

```solidity
if (value > maxNativeTransfer) {
    revert SpendingLimitExceeded();
}
```

Do not build daily accounting in the MVP.

Per-transaction limit is enough.

---

# 9. Policy 2 — Unlimited ERC-20 Approval Protection

Detect ERC-20:

```solidity
approve(address,uint256)
```

Function selector:

```solidity
IERC20.approve.selector
```

Decode:

```text
spender
amount
```

If:

```solidity
amount == type(uint256).max
```

block the transaction.

Example:

```text
approve(0xSpender, 100 USDC)
-> ALLOWED

approve(0xSpender, MAX_UINT256)
-> BLOCKED
```

Return or emit a clear reason:

```text
UNLIMITED_APPROVAL
```

For the MVP, only `approve()` needs to be checked.

Permit, Permit2, increaseAllowance, etc. are stretch goals.

---

# 10. Policy 3 — Trusted Target Allowlist

Allow the user to mark contracts as trusted.

Example:

```text
Trusted:

Uniswap Router
Aave Pool
Morpho
```

For the MVP, this policy may be configured as either:

- warning only, or
- mandatory blocking mode

Preferred implementation:

```text
Unknown target
-> WARNING

Explicitly blocked target
-> BLOCK
```

Do not accidentally block normal ERC-20 interactions needed by the demo.

---

# 11. EIP-7702 Protection

EIP-7702 protection is a core feature.

There are two different cases.

---

## 11.1 Detect Existing Delegation

When an EOA connects, fetch its runtime code using:

```text
eth_getCode
```

Check whether the bytecode represents an EIP-7702 delegation designator.

The delegation designator begins with:

```text
0xef0100
```

followed by the delegated implementation address.

Frontend helper:

```text
frontend/lib/eip7702.ts
```

Responsibilities:

1. Fetch code for connected owner EOA.
2. Check whether code starts with `0xef0100`.
3. Extract the implementation address.
4. Compare it against the trusted delegate list.
5. Show security status.

Expected result:

```ts
type DelegationStatus = {
  delegated: boolean;
  implementation?: `0x${string}`;
  trusted?: boolean;
};
```

UI example:

```text
EIP-7702 Delegation

Status:
DETECTED

Implementation:
0x98a6...2d00

Trusted:
NO

Risk:
CRITICAL
```

If no delegation exists:

```text
EIP-7702 Delegation
None detected
SAFE
```

---

## 11.2 Proposed EIP-7702 Delegation

EIP-7702 delegation must use a strict user-controlled allowlist.

The user must be able to:

- Add an implementation address to the EIP-7702 delegation whitelist.
- Remove an implementation address from the whitelist.
- View the current list of whitelisted delegation addresses.

The wallet must only allow a proposed EIP-7702 delegation when the implementation address is currently whitelisted.

Conceptual policy:

```text
Proposed delegate
      |
      v
Is delegate whitelisted?
   |              |
  YES            NO
   |              |
ALLOWED         BLOCKED
```

Compare against:

```text
trusted7702Delegates
```

If the implementation is not whitelisted:

```text
UNTRUSTED_7702_DELEGATE
```

and the request must be rejected before signing or submission through Paranoia.

This is a hard MVP requirement, not a warning-only feature.

The required product rule is:

> Paranoia must never approve or initiate an EIP-7702 delegation to an implementation address that is not currently whitelisted by the user.

Suggested functions:

```solidity
function whitelist7702Delegate(address delegate) external;

function removeWhitelisted7702Delegate(address delegate) external;

function is7702DelegateWhitelisted(
    address delegate
) external view returns (bool);
```

Conceptual enforcement:

```solidity
if (!trusted7702Delegates[delegate]) {
    revert Untrusted7702Delegate(delegate);
}
```

The frontend must expose simple controls for adding and removing whitelist entries.

UI example:

```text
EIP-7702 Delegate Allowlist

Whitelisted
0x1234...abcd
0x5678...ef01

[ Add Delegate ]

Each existing entry:
[ Remove ]
```

Important technical limitation:

For the hackathon MVP, enforcement of EIP-7702 authorization happens inside the Paranoia wallet / signing flow.

Do not claim that ERC-4337 itself can stop the owner EOA from signing an EIP-7702 authorization using an entirely different wallet or external tool.

The ERC-4337 smart account protects assets held by the Paranoia smart account.

The EIP-7702 module controls what Paranoia itself will approve, sign, or submit for the owner EOA.

---

# 12. Risk Engine

Create a small transaction analysis layer.

Possible result:

```ts
type RiskLevel =
  | "SAFE"
  | "WARNING"
  | "CRITICAL"
  | "BLOCKED";
```

Possible reason codes:

```ts
type RiskReason =
  | "NONE"
  | "UNLIMITED_APPROVAL"
  | "SPENDING_LIMIT_EXCEEDED"
  | "UNTRUSTED_TARGET"
  | "EIP7702_DELEGATION_DETECTED"
  | "UNTRUSTED_7702_DELEGATE";
```

The security engine should return structured data.

Example:

```ts
{
  level: "BLOCKED",
  reasons: [
    {
      code: "UNLIMITED_APPROVAL",
      message: "This transaction grants unlimited token spending permission."
    }
  ]
}
```

Do not use AI for risk classification.

Use deterministic rules.

---

# 13. Frontend Screens

The frontend only needs a few screens / states.

---

## 13.1 Dashboard

Display:

```text
Paranoia

Account
0x1234...5678

Security Status

ERC-4337 Account       ACTIVE
Spending Limit         1 ETH
Approval Protection    ACTIVE
Trusted Targets        3
EIP-7702 Delegation    NONE

Overall
PROTECTED
```

---

## 13.2 Policy Settings

Allow the user to configure:

```text
Maximum native transfer:
[ 1 ETH ]

Unlimited Approval Protection:
[ ON ]

Trusted Contracts:
[ address ] [ Add ]

Whitelisted EIP-7702 Delegates:
[ address ] [ Add ]

Existing delegates:
[ 0x... ] [ Remove ]
```

Keep settings minimal.

---

## 13.3 Transaction Review

Before execution show:

```text
TRANSACTION REQUEST

Action
Approve USDC

Target
0x...

Spender
0x...

Amount
Unlimited

SECURITY CHECKS

ERC-20 approval         detected
Unlimited approval      detected
Spending policy         safe
Target                   unknown

RISK
CRITICAL

TRANSACTION BLOCKED
```

For a safe transaction:

```text
TRANSFER

Amount
0.2 ETH

Spending Limit
1 ETH

Risk
SAFE

[ Execute ]
```

---

## 13.4 EIP-7702 Security Card

Display:

```text
EIP-7702 SECURITY

Delegation:
Detected / None

Implementation:
0x...

Trusted:
Yes / No

Risk:
SAFE / CRITICAL
```

This should be visible from the dashboard.

---

# 14. Attack Demo

Create:

```text
MaliciousSpender.sol
```

Its purpose is to demonstrate why unlimited approvals are dangerous.

Example:

```solidity
function drain(
    IERC20 token,
    address victim,
    address recipient
) external {
    token.transferFrom(
        victim,
        recipient,
        token.balanceOf(victim)
    );
}
```

Demo:

### Without Protection

```text
User
 |
 v
approve(attacker, MAX_UINT)
 |
 v
MaliciousSpender
 |
 v
transferFrom()
 |
 v
Tokens drained
```

### With Paranoia

```text
User
 |
 v
approve(attacker, MAX_UINT)
 |
 v
PolicyManager
 |
 v
UNLIMITED_APPROVAL
 |
 v
BLOCKED
```

---

# 15. Required Demo Scenarios

The finished MVP must demonstrate four flows.

---

## Demo 1 — Safe Transfer

```text
Spending limit:
1 ETH

Transaction:
Send 0.1 ETH

Expected:
ALLOWED
```

---

## Demo 2 — Spending Limit Attack

```text
Spending limit:
1 ETH

Transaction:
Send 5 ETH

Expected:
BLOCKED

Reason:
SPENDING_LIMIT_EXCEEDED
```

---

## Demo 3 — Unlimited Approval Attack

```text
Transaction:

approve(
    maliciousSpender,
    type(uint256).max
)

Expected:
BLOCKED

Reason:
UNLIMITED_APPROVAL
```

---

## Demo 4 — EIP-7702 Delegation

Scenario A:

```text
Delegate:
trusted implementation

Expected:
SAFE / TRUSTED
```

Scenario B:

```text
Delegate:
unknown implementation

Expected:
CRITICAL / BLOCKED
```

If possible, also demonstrate scanning an already delegated EOA.

---

# 16. Smart Contract Events

Emit useful events.

Examples:

```solidity
event TransactionExecuted(
    address indexed target,
    uint256 value
);

event TransactionBlocked(
    address indexed target,
    bytes32 reason
);

event MaxNativeTransferUpdated(
    uint256 oldLimit,
    uint256 newLimit
);

event TrustedTargetUpdated(
    address indexed target,
    bool trusted
);

event Trusted7702DelegateUpdated(
    address indexed delegate,
    bool trusted
);
```

Do not emit sensitive private information.

---

# 17. Custom Errors

Use custom errors.

Examples:

```solidity
error Unauthorized();

error SpendingLimitExceeded(
    uint256 requested,
    uint256 maximum
);

error UnlimitedApprovalBlocked();

error InvalidTarget();

error ExecutionFailed();
```

---

# 18. Tests

All core policies must have Foundry tests.

Minimum test suite:

```text
testOwnerCanExecuteSafeTransfer

testNonOwnerCannotExecute

testTransferWithinLimitPasses

testTransferAboveLimitReverts

testNormalApprovalPasses

testUnlimitedApprovalReverts

testTrustedTargetCanBeAdded

testTrustedTargetCanBeRemoved

testOnlyAuthorizedUserCanModifyPolicies

testOwnerCanWhitelist7702Delegate

testOwnerCanRemoveWhitelisted7702Delegate

testNonOwnerCannotModify7702Whitelist

testWhitelisted7702DelegateIsAllowed

testUnwhitelisted7702DelegateIsBlocked

testMaliciousDrainWorksWithoutProtection

testMaliciousDrainBlockedByParanoia
```

If ERC-4337 integration testing is available within time:

```text
testValidUserOperation

testInvalidSignatureRejected

testPolicyViolationRejectsExecution
```

---

# 19. Security Requirements

Even for a hackathon MVP:

- Follow checks-effects-interactions where relevant.
- Restrict policy configuration.
- Prevent arbitrary callers from executing transactions.
- Do not use `tx.origin`.
- Handle failed external calls.
- Avoid dangerous delegatecall usage.
- Avoid storing private keys.
- Never expose the user's signer secret in frontend code.
- Validate decoded calldata length before decoding.
- Use established ERC-4337 libraries rather than reimplementing EntryPoint behavior from scratch.

---

# 20. 7-Hour Build Priority

Work in this exact order.

---

## Hour 0–1.5

Build:

```text
ParanoiaAccount
PolicyManager
```

Get basic owner-controlled execution working.

---

## Hour 1.5–2.5

Implement:

```text
native spending limit
unlimited approve protection
```

Write tests immediately.

---

## Hour 2.5–3.5

Integrate ERC-4337.

Use an existing implementation / reference architecture.

Do not build EntryPoint yourself.

---

## Hour 3.5–4

Build:

```text
MockERC20
MaliciousSpender
attack demo
```

---

## Hour 4–5.5

Build frontend:

```text
dashboard
policy settings
transaction review
risk display
```

---

## Hour 5.5–6

Build EIP-7702 scanner.

Detect:

```text
0xef0100
```

Extract delegate implementation.

Display trusted / untrusted state.

---

## Hour 6–6.5

Deploy contracts and connect frontend.

Verify all four demo flows.

---

## Hour 6.5–7

Polish:

```text
README
demo script
screenshots
submission description
```

Do not add new architecture during this period.

---

# 21. Explicit Non-Goals

Do NOT build these for the MVP:

```text
AI risk engine
database
Go backend
multi-chain support
Chrome extension
Aave integration
Morpho integration
social recovery
gas sponsorship system
full portfolio tracker
price oracle
daily spending accounting
ZK proofs
cross-chain recovery
mobile app
full MetaMask replacement
full Permit2 protection
production-grade EIP-7702 authorization framework
```

These may be mentioned as future features.

---

# 22. Stretch Goals

Only start these after every MVP flow works.

Priority order:

1. Session keys
2. Daily spending limit
3. ERC-20 per-token spending limits
4. Permit / Permit2 inspection
5. Recovery guardian
6. DeFi protocol allowlists
7. Transaction simulation
8. Gas sponsorship / Paymaster
9. Browser extension
10. Multi-chain support

---

# 23. README Pitch

Use this wording as the base:

> Paranoia is an ERC-4337 programmable smart wallet that acts like an on-chain firewall. It checks transactions against user-defined security policies before execution. The MVP blocks unlimited token approvals, prevents transfers above configured spending limits, and detects suspicious EIP-7702 delegations. Paranoia is built around one principle: a valid signature should not automatically mean a dangerous transaction is allowed.

---

# 24. Hackathon Tagline

> **Paranoia — your wallet should be paranoid, so you don't have to be.**

---

# 25. Definition of Done

The MVP is complete when all of the following work:

- [ ] ERC-4337-compatible Paranoia smart account exists.
- [ ] Owner can submit a valid account-abstraction transaction.
- [ ] Normal transactions execute.
- [ ] Native transfer above configured limit is rejected.
- [ ] Unlimited ERC-20 approval is rejected.
- [ ] Policy settings can be updated by the authorized owner.
- [ ] Connected EOA can be scanned for EIP-7702 delegation.
- [ ] Delegated implementation can be extracted.
- [ ] User can whitelist EIP-7702 delegation addresses.
- [ ] User can remove / blacklist previously whitelisted delegation addresses.
- [ ] Paranoia only permits EIP-7702 delegation to currently whitelisted addresses.
- [ ] Every non-whitelisted EIP-7702 delegation request is blocked before signing/submission through Paranoia.
- [ ] Trusted and untrusted delegates are shown differently.
- [ ] Malicious spender demo contract exists.
- [ ] Frontend clearly explains why a transaction is safe or blocked.
- [ ] Foundry tests pass.
- [ ] Deployment script works.
- [ ] README contains setup and demo instructions.

---

# 26. Instructions for Codex

When implementing this repository:

1. Build only the MVP described above.
2. Do not add features from the stretch-goal list unless all MVP items work.
3. Prefer simple, auditable Solidity over clever abstractions.
4. Reuse established ERC-4337 contracts/libraries where appropriate.
5. Write tests alongside each security feature.
6. Every policy failure must have a clear custom error or structured reason.
7. Keep frontend security analysis deterministic.
8. Clearly separate:
   - ERC-4337 smart-account protection
   - EIP-7702 owner-EOA monitoring and allowlist enforcement inside Paranoia
9. Treat the EIP-7702 delegate allowlist as a hard security boundary in the Paranoia signing flow.
10. Never allow Paranoia to approve, sign, or submit a 7702 delegation to a non-whitelisted implementation.
11. Do not claim ERC-4337 prevents arbitrary EIP-7702 authorizations on the owner EOA when the user uses an external wallet/tool outside Paranoia.
12. Optimize for a working hackathon demo over production completeness.

Start by implementing the contracts and Foundry tests before building the frontend.
