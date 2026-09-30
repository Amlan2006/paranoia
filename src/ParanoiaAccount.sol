// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPolicyManager} from "./interfaces/IPolicyManager.sol";
import {PolicyManager} from "./PolicyManager.sol";

/// @notice Single-owner account whose calls must clear PolicyManager before execution.
/// @dev The configured EntryPoint will call execute after it has validated a UserOperation.
contract ParanoiaAccount {
    error Unauthorized();
    error InvalidAddress();
    error ExecutionFailed(bytes returnData);

    address public immutable owner;
    address public immutable entryPoint;
    IPolicyManager public immutable policyManager;

    event TransactionExecuted(address indexed target, uint256 value, bytes data);

    constructor(address owner_, address entryPoint_, uint256 maxNativeTransfer_) {
        if (owner_ == address(0) || entryPoint_ == address(0)) revert InvalidAddress();
        owner = owner_;
        entryPoint = entryPoint_;
        policyManager = IPolicyManager(address(new PolicyManager(address(this), maxNativeTransfer_)));
    }

    modifier onlyAuthorizedExecutor() {
        if (msg.sender != owner && msg.sender != entryPoint) revert Unauthorized();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    receive() external payable {}

    /// @notice Executes a call only after all mandatory policies accept it.
    function execute(address target, uint256 value, bytes calldata data) external onlyAuthorizedExecutor {
        policyManager.validate(target, value, data);

        (bool success, bytes memory returnData) = target.call{value: value}(data);
        if (!success) revert ExecutionFailed(returnData);

        emit TransactionExecuted(target, value, data);
    }

    function setMaxNativeTransfer(uint256 newLimit) external onlyOwner {
        policyManager.setMaxNativeTransfer(newLimit);
    }

    function setTrustedTarget(address target, bool trusted) external onlyOwner {
        policyManager.setTrustedTarget(target, trusted);
    }

    function setTargetBlocked(address target, bool blocked) external onlyOwner {
        policyManager.setTargetBlocked(target, blocked);
    }

    function whitelist7702Delegate(address delegate) external onlyOwner {
        policyManager.setTrusted7702Delegate(delegate, true);
    }

    function removeWhitelisted7702Delegate(address delegate) external onlyOwner {
        policyManager.setTrusted7702Delegate(delegate, false);
    }

    function is7702DelegateWhitelisted(address delegate) external view returns (bool) {
        return policyManager.is7702DelegateWhitelisted(delegate);
    }

    /// @notice Signing/UI code must call this before Paranoia authorizes a proposed EIP-7702 delegation.
    function validateProposed7702Delegate(address delegate) external view {
        PolicyManager(address(policyManager)).validate7702Delegate(delegate);
    }
}
