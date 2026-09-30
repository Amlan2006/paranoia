// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ParanoiaAccount} from "./ParanoiaAccount.sol";

/// @notice Minimal deployment factory. Counterfactual deployment can be added with CREATE2 during ERC-4337 integration.
contract ParanoiaAccountFactory {
    error InvalidAddress();

    event AccountCreated(address indexed owner, address indexed account, address indexed policyManager);

    function createAccount(address owner, address entryPoint, uint256 maxNativeTransfer)
        external
        returns (ParanoiaAccount account)
    {
        if (owner == address(0) || entryPoint == address(0)) revert InvalidAddress();
        account = new ParanoiaAccount(owner, entryPoint, maxNativeTransfer);
        emit AccountCreated(owner, address(account), address(account.policyManager()));
    }
}
