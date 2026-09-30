// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice The policy boundary for a single ParanoiaAccount.
/// @dev Policy updates can only be made by the associated account, which in
/// turn requires its owner or configured ERC-4337 EntryPoint.
contract PolicyManager {
    error Unauthorized();
    error InvalidTarget();
    error SpendingLimitExceeded(uint256 requested, uint256 maximum);
    error UnlimitedApprovalBlocked(address spender);
    error BlockedTarget(address target);
    error Untrusted7702Delegate(address delegate);

    address public immutable account;
    uint256 public maxNativeTransfer;

    mapping(address => bool) public trustedTargets;
    mapping(address => bool) public blockedTargets;
    mapping(address => bool) public trusted7702Delegates;

    event MaxNativeTransferUpdated(uint256 oldLimit, uint256 newLimit);
    event TrustedTargetUpdated(address indexed target, bool trusted);
    event TargetBlockedUpdated(address indexed target, bool blocked);
    event Trusted7702DelegateUpdated(address indexed delegate, bool trusted);

    constructor(address account_, uint256 maxNativeTransfer_) {
        if (account_ == address(0)) revert InvalidTarget();
        account = account_;
        maxNativeTransfer = maxNativeTransfer_;
    }

    modifier onlyAccount() {
        if (msg.sender != account) revert Unauthorized();
        _;
    }

    function setMaxNativeTransfer(uint256 newLimit) external onlyAccount {
        uint256 oldLimit = maxNativeTransfer;
        maxNativeTransfer = newLimit;
        emit MaxNativeTransferUpdated(oldLimit, newLimit);
    }

    function setTrustedTarget(address target, bool trusted) external onlyAccount {
        if (target == address(0)) revert InvalidTarget();
        trustedTargets[target] = trusted;
        emit TrustedTargetUpdated(target, trusted);
    }

    /// @notice Explicit blocks are mandatory; unknown targets remain warning-only in this MVP.
    function setTargetBlocked(address target, bool blocked) external onlyAccount {
        if (target == address(0)) revert InvalidTarget();
        blockedTargets[target] = blocked;
        emit TargetBlockedUpdated(target, blocked);
    }

    function setTrusted7702Delegate(address delegate, bool trusted) external onlyAccount {
        if (delegate == address(0)) revert InvalidTarget();
        trusted7702Delegates[delegate] = trusted;
        emit Trusted7702DelegateUpdated(delegate, trusted);
    }

    function is7702DelegateWhitelisted(address delegate) external view returns (bool) {
        return trusted7702Delegates[delegate];
    }

    /// @notice Reverts when an account call violates a mandatory transaction policy.
    function validate(address target, uint256 value, bytes calldata data) external view {
        if (target == address(0)) revert InvalidTarget();
        if (blockedTargets[target]) revert BlockedTarget(target);
        if (value > maxNativeTransfer) revert SpendingLimitExceeded(value, maxNativeTransfer);

        // approve(address,uint256) is 4 selector bytes plus two ABI words.
        if (data.length >= 68 && bytes4(data[:4]) == IERC20.approve.selector) {
            (address spender, uint256 amount) = abi.decode(data[4:], (address, uint256));
            if (amount == type(uint256).max) revert UnlimitedApprovalBlocked(spender);
        }
    }

    /// @notice Used by Paranoia's EIP-7702 signing/submission flow before it authorizes a delegate.
    function validate7702Delegate(address delegate) external view {
        if (!trusted7702Delegates[delegate]) revert Untrusted7702Delegate(delegate);
    }
}
