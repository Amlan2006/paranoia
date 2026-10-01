// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ParanoiaAccount} from "../src/ParanoiaAccount.sol";
import {PolicyManager} from "../src/PolicyManager.sol";
import {PackedUserOperation} from "@openzeppelin/contracts/interfaces/IERC4337.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

// Deliberately unsafe implementation, used only with disposable local test keys.
contract Unsafe7702Delegate {
    function forward(address target, bytes calldata data) external {
        (bool ok, bytes memory result) = target.call(data);
        if (!ok) assembly ("memory-safe") { revert(add(result, 32), mload(result)) }
    }

    function takeOver(ParanoiaAccount account, address recipient) external {
        account.setMaxNativeTransfer(address(account).balance);
        account.execute(recipient, address(account).balance, "");
    }

    function identity() external view returns (address) {
        return address(this);
    }
}

contract Delegation7702Test is Test {
    using MessageHashUtils for bytes32;
    uint256 constant OWNER_KEY = 0xA11CE;
    uint256 constant TARGET_KEY = 0xB0B;
    address owner;
    address attacker;
    ParanoiaAccount account;
    PolicyManager policy;
    Unsafe7702Delegate delegate;

    function setUp() public {
        owner = vm.addr(OWNER_KEY);
        attacker = makeAddr("attacker");
        account = new ParanoiaAccount(owner, makeAddr("entryPoint"), 0.05 ether);
        policy = PolicyManager(address(account.policyManager()));
        delegate = new Unsafe7702Delegate();
        vm.deal(address(account), 10 ether);
    }

    function testUntrustedDelegateValidationReverts() public {
        vm.expectRevert(abi.encodeWithSelector(PolicyManager.Untrusted7702Delegate.selector, address(delegate)));
        account.validateProposed7702Delegate(address(delegate));
    }

    function testAllowThenRemoveDelegateChangesValidation() public {
        vm.prank(owner);
        account.whitelist7702Delegate(address(delegate));
        account.validateProposed7702Delegate(address(delegate));
        vm.prank(owner);
        account.removeWhitelisted7702Delegate(address(delegate));
        vm.expectRevert(abi.encodeWithSelector(PolicyManager.Untrusted7702Delegate.selector, address(delegate)));
        account.validateProposed7702Delegate(address(delegate));
    }

    function testStrangerCannotWhitelistDelegate() public {
        vm.expectRevert(ParanoiaAccount.Unauthorized.selector);
        vm.prank(attacker);
        account.whitelist7702Delegate(address(delegate));
    }

    function testUndelegatedImplementationCannotTakeOverAccount() public {
        vm.expectRevert(ParanoiaAccount.Unauthorized.selector);
        vm.prank(attacker);
        delegate.takeOver(account, attacker);
        assertEq(address(account).balance, 10 ether);
    }

    // EIP-7702 authorization can be signed elsewhere with the same owner key.
    // The separate policy validator is not consulted by protocol delegation.
    function testMaliciousOwnerDelegationCannotChangePolicyOrDrain() public {
        assertFalse(policy.trusted7702Delegates(address(delegate)));
        vm.signAndAttachDelegation(address(delegate), OWNER_KEY);
        assertEq(owner.code, abi.encodePacked(hex"ef0100", address(delegate)));
        assertEq(Unsafe7702Delegate(owner).identity(), owner);

        vm.expectRevert(abi.encodeWithSelector(ParanoiaAccount.DirectOwnerCallWithCode.selector, owner));
        vm.prank(attacker);
        Unsafe7702Delegate(owner).takeOver(account, attacker);
        assertEq(policy.maxNativeTransfer(), 0.05 ether);
        assertEq(address(account).balance, 10 ether);
        assertEq(attacker.balance, 0);
    }

    function testKnownGapCallsToUntrustedDelegatedTargetAreAllowed() public {
        address delegatedTarget = vm.addr(TARGET_KEY);
        vm.signAndAttachDelegation(address(delegate), TARGET_KEY);
        assertFalse(policy.trusted7702Delegates(address(delegate)));
        vm.prank(owner);
        account.execute(delegatedTarget, 0, abi.encodeCall(delegate.identity, ()));
    }

    function testKnownGapRemovingAllowlistEntryDoesNotClearOwnerDelegation() public {
        vm.prank(owner);
        account.whitelist7702Delegate(address(delegate));
        vm.signAndAttachDelegation(address(delegate), OWNER_KEY);
        _signedExecution(
            abi.encodeCall(
                account.execute,
                (address(account), 0, abi.encodeCall(account.removeWhitelisted7702Delegate, (address(delegate))))
            ),
            OWNER_KEY
        );
        assertFalse(policy.trusted7702Delegates(address(delegate)));
        assertEq(owner.code, abi.encodePacked(hex"ef0100", address(delegate)));
        assertEq(Unsafe7702Delegate(owner).identity(), owner);
    }

    function testDelegatedOwnerCannotCallAnyPolicySetter() public {
        vm.signAndAttachDelegation(address(delegate), OWNER_KEY);
        bytes[] memory calls = new bytes[](5);
        calls[0] = abi.encodeCall(account.setMaxNativeTransfer, (10 ether));
        calls[1] = abi.encodeCall(account.setTrustedTarget, (attacker, true));
        calls[2] = abi.encodeCall(account.setTargetBlocked, (attacker, false));
        calls[3] = abi.encodeCall(account.whitelist7702Delegate, (address(delegate)));
        calls[4] = abi.encodeCall(account.removeWhitelisted7702Delegate, (address(delegate)));
        for (uint256 i; i < calls.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(ParanoiaAccount.DirectOwnerCallWithCode.selector, owner));
            vm.prank(attacker);
            Unsafe7702Delegate(owner).forward(address(account), calls[i]);
        }
    }

    function testDelegatedOwnerCannotExecuteEvenWithinSpendingLimit() public {
        vm.signAndAttachDelegation(address(delegate), OWNER_KEY);
        vm.expectRevert(abi.encodeWithSelector(ParanoiaAccount.DirectOwnerCallWithCode.selector, owner));
        vm.prank(attacker);
        Unsafe7702Delegate(owner)
            .forward(address(account), abi.encodeCall(account.execute, (attacker, 0.01 ether, bytes(""))));
        assertEq(attacker.balance, 0);
    }

    function testAllowlistedDelegateDoesNotBypassOwnerCodeGuard() public {
        vm.prank(owner);
        account.whitelist7702Delegate(address(delegate));
        vm.signAndAttachDelegation(address(delegate), OWNER_KEY);
        vm.expectRevert(abi.encodeWithSelector(ParanoiaAccount.DirectOwnerCallWithCode.selector, owner));
        Unsafe7702Delegate(owner).takeOver(account, attacker);
    }

    function testAnyOwnerCodeIsRejected() public {
        vm.etch(owner, hex"00");
        vm.expectRevert(abi.encodeWithSelector(ParanoiaAccount.DirectOwnerCallWithCode.selector, owner));
        vm.prank(owner);
        account.execute(attacker, 0.01 ether, "");
    }

    function testSignedUserOperationWorksWithDelegatedOwner() public {
        vm.signAndAttachDelegation(address(delegate), OWNER_KEY);
        _signedExecution(abi.encodeCall(account.execute, (attacker, 0.01 ether, bytes(""))), OWNER_KEY);
        assertEq(attacker.balance, 0.01 ether);
    }

    function testAttackerSignatureRejectedWithDelegatedOwner() public {
        vm.signAndAttachDelegation(address(delegate), OWNER_KEY);
        vm.expectRevert("Invalid signature");
        this.signedExecutionForTest(abi.encodeCall(account.execute, (attacker, 0.01 ether, bytes(""))), TARGET_KEY);
        assertEq(attacker.balance, 0);
    }

    function testSignedUserOperationStillEnforcesLimit() public {
        vm.signAndAttachDelegation(address(delegate), OWNER_KEY);
        vm.expectRevert(abi.encodeWithSelector(PolicyManager.SpendingLimitExceeded.selector, 0.06 ether, 0.05 ether));
        this.signedExecutionForTest(abi.encodeCall(account.execute, (attacker, 0.06 ether, bytes(""))), OWNER_KEY);
    }

    function testRevokingActualDelegationRestoresDirectOwnerCalls() public {
        vm.signAndAttachDelegation(address(delegate), OWNER_KEY);
        vm.signAndAttachDelegation(address(0), OWNER_KEY);
        assertEq(owner.code.length, 0);
        vm.prank(owner);
        account.execute(attacker, 0.01 ether, "");
        assertEq(attacker.balance, 0.01 ether);
    }

    function signedExecutionForTest(bytes memory callData, uint256 signingKey) external {
        require(msg.sender == address(this));
        _signedExecution(callData, signingKey);
    }

    // Unit-level EntryPoint boundary: validate the signature before forwarding
    // the same calldata. This is not a full bundler/handleOps integration test.
    function _signedExecution(bytes memory callData, uint256 signingKey) internal {
        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = callData;
        bytes32 opHash = keccak256(abi.encode(block.chainid, address(account.entryPoint()), op));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signingKey, opHash.toEthSignedMessageHash());
        op.signature = abi.encodePacked(r, s, v);
        vm.prank(address(account.entryPoint()));
        require(account.validateUserOp(op, opHash, 0) == 0, "Invalid signature");
        vm.prank(address(account.entryPoint()));
        (bool ok, bytes memory result) = address(account).call(callData);
        if (!ok) assembly ("memory-safe") { revert(add(result, 32), mload(result)) }
    }
}
