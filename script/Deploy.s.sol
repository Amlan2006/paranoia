// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ParanoiaAccount} from "../src/ParanoiaAccount.sol";
import {ParanoiaAccountFactory} from "../src/ParanoiaAccountFactory.sol";

/// @notice Deploys the Paranoia factory and a first owner-controlled account.
/// @dev Required environment variables: OWNER, ENTRY_POINT, MAX_NATIVE_TRANSFER.
/// The broadcaster is supplied by Forge, for example with --private-key.
contract Deploy is Script {
    function run() external returns (ParanoiaAccountFactory factory, ParanoiaAccount account) {
        address owner = vm.envAddress("OWNER");
        address entryPoint = vm.envAddress("ENTRY_POINT");
        uint256 maxNativeTransfer = vm.envUint("MAX_NATIVE_TRANSFER");

        vm.startBroadcast();
        factory = new ParanoiaAccountFactory();
        account = factory.createAccount(owner, entryPoint, maxNativeTransfer);
        vm.stopBroadcast();

        console2.log("ParanoiaAccountFactory:", address(factory));
        console2.log("ParanoiaAccount:", address(account));
        console2.log("PolicyManager:", address(account.policyManager()));
        console2.log("Owner:", owner);
        console2.log("EntryPoint:", entryPoint);
        console2.log("Max native transfer (wei):", maxNativeTransfer);
    }
}
