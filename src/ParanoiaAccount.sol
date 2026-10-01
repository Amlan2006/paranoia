// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPolicyManager} from "./interfaces/IPolicyManager.sol";
import {PolicyManager} from "./PolicyManager.sol";
import {Account} from "@openzeppelin/contracts/account/Account.sol";
import {IEntryPoint, PackedUserOperation} from "@openzeppelin/contracts/interfaces/IERC4337.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {SignerECDSA} from "@openzeppelin/contracts/utils/cryptography/signers/SignerECDSA.sol";

/// @notice Single-owner account whose calls must clear PolicyManager before execution.
/// @dev The configured EntryPoint will call execute after it has validated a UserOperation.
contract ParanoiaAccount is Account, SignerECDSA {
    using MessageHashUtils for bytes32;

    error Unauthorized();
    error InvalidAddress();
    error DirectOwnerCallWithCode(address owner);
    error ExecutionFailed(bytes returnData);

    IEntryPoint private immutable _entryPoint;
    IPolicyManager public immutable policyManager;

    event TransactionExecuted(address indexed target, uint256 value, bytes data);

    constructor(address owner_, address entryPoint_, uint256 maxNativeTransfer_) SignerECDSA(owner_) {
        if (owner_ == address(0) || entryPoint_ == address(0)) revert InvalidAddress();
        _entryPoint = IEntryPoint(entryPoint_);
        policyManager = IPolicyManager(address(new PolicyManager(address(this), maxNativeTransfer_)));
    }

    /// @notice The EOA that authorizes this MVP account's UserOperations.
    function owner() public view returns (address) {
        return signer();
    }

    /// @notice ERC-4337 v0.7 EntryPoint deployed on Celo Sepolia.
    function entryPoint() public view virtual override returns (IEntryPoint) {
        return _entryPoint;
    }

    modifier onlyAuthorizedExecutor() {
        if (msg.sender == owner()) _checkDirectOwner();
        else if (msg.sender != address(entryPoint())) revert Unauthorized();
        _;
    }

    /// @dev `address(this)` permits a validated UserOperation to call a policy
    /// update through execute(address(this), 0, calldata).
    modifier onlyOwnerOrSelf() {
        if (msg.sender == owner()) _checkDirectOwner();
        else if (msg.sender != address(this)) revert Unauthorized();
        _;
    }

    /// @dev Delegated code executes as the owner EOA, so sender identity alone
    /// is insufficient. Reject ALL owner code, including allowlisted delegates.
    /// Key-signed UserOperations remain available through the trusted EntryPoint.
    function _checkDirectOwner() internal view {
        if (msg.sender.code.length != 0) revert DirectOwnerCallWithCode(msg.sender);
    }

    /// @dev EntryPoint v0.7 UserOperation hashes are signed with EIP-191.
    function _signableUserOpHash(PackedUserOperation calldata, bytes32 userOpHash)
        internal
        view
        virtual
        override
        returns (bytes32)
    {
        return userOpHash.toEthSignedMessageHash();
    }

    /// @notice Executes a call only after all mandatory policies accept it.
    function execute(address target, uint256 value, bytes calldata data) external onlyAuthorizedExecutor {
        policyManager.validate(target, value, data);

        (bool success, bytes memory returnData) = target.call{value: value}(data);
        if (!success) revert ExecutionFailed(returnData);

        emit TransactionExecuted(target, value, data);
    }

    function setMaxNativeTransfer(uint256 newLimit) external onlyOwnerOrSelf {
        policyManager.setMaxNativeTransfer(newLimit);
    }

    function setTrustedTarget(address target, bool trusted) external onlyOwnerOrSelf {
        policyManager.setTrustedTarget(target, trusted);
    }

    function setTargetBlocked(address target, bool blocked) external onlyOwnerOrSelf {
        policyManager.setTargetBlocked(target, blocked);
    }

    function whitelist7702Delegate(address delegate) external onlyOwnerOrSelf {
        policyManager.setTrusted7702Delegate(delegate, true);
    }

    function removeWhitelisted7702Delegate(address delegate) external onlyOwnerOrSelf {
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
