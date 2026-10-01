// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ParanoiaAccount} from "../src/ParanoiaAccount.sol";
import {PolicyManager} from "../src/PolicyManager.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MaliciousSpender} from "../src/mocks/MaliciousSpender.sol";
import {TrustedTarget} from "../src/mocks/TrustedTarget.sol";
import {PackedUserOperation} from "@openzeppelin/contracts/interfaces/IERC4337.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract ParanoiaAccountTest is Test {
    using MessageHashUtils for bytes32;

    uint256 internal ownerPrivateKey = 0xA11CE;
    address internal owner;
    address internal stranger = makeAddr("stranger");
    address internal entryPoint = makeAddr("entryPoint");
    address internal recipient = makeAddr("recipient");

    ParanoiaAccount internal account;
    PolicyManager internal policyManager;
    MockERC20 internal token;
    MaliciousSpender internal maliciousSpender;
    TrustedTarget internal target;

    function setUp() public {
        owner = vm.addr(ownerPrivateKey);
        account = new ParanoiaAccount(owner, entryPoint, 1 ether);
        policyManager = PolicyManager(address(account.policyManager()));
        token = new MockERC20();
        maliciousSpender = new MaliciousSpender();
        target = new TrustedTarget();
        vm.deal(address(account), 10 ether);
        token.mint(address(account), 100e18);
    }

    function _userOp(bytes memory signature) internal view returns (PackedUserOperation memory) {
        return PackedUserOperation({
            sender: address(account),
            nonce: 0,
            initCode: "",
            callData: "",
            accountGasLimits: bytes32(0),
            preVerificationGas: 0,
            gasFees: bytes32(0),
            paymasterAndData: "",
            signature: signature
        });
    }

    function testValidUserOperationSignatureIsAccepted() public {
        bytes32 userOpHash = keccak256("valid user operation");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPrivateKey, userOpHash.toEthSignedMessageHash());
        PackedUserOperation memory userOp = _userOp(abi.encodePacked(r, s, v));

        vm.prank(entryPoint);
        assertEq(account.validateUserOp(userOp, userOpHash, 0), 0);
    }

    function testInvalidUserOperationSignatureIsRejected() public {
        PackedUserOperation memory userOp = _userOp(hex"1234");

        vm.prank(entryPoint);
        assertEq(account.validateUserOp(userOp, keccak256("invalid user operation"), 0), 1);
    }

    function testUserOperationPaysMissingPrefundToEntryPoint() public {
        bytes32 userOpHash = keccak256("prefund user operation");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPrivateKey, userOpHash.toEthSignedMessageHash());
        PackedUserOperation memory userOp = _userOp(abi.encodePacked(r, s, v));

        vm.deal(entryPoint, 0);
        vm.prank(entryPoint);
        account.validateUserOp(userOp, userOpHash, 0.25 ether);
        assertEq(entryPoint.balance, 0.25 ether);
    }

    function testOnlyEntryPointCanValidateUserOperation() public {
        PackedUserOperation memory userOp = _userOp("");

        vm.expectRevert();
        vm.prank(stranger);
        account.validateUserOp(userOp, keccak256("user operation"), 0);
    }

    function testOwnerCanExecuteSafeTransfer() public {
        vm.prank(owner);
        account.execute(recipient, 0.1 ether, "");
        assertEq(recipient.balance, 0.1 ether);
    }

    function testNonOwnerCannotExecute() public {
        vm.expectRevert(ParanoiaAccount.Unauthorized.selector);
        vm.prank(stranger);
        account.execute(recipient, 0.1 ether, "");
    }

    function testEntryPointCanExecuteAfterValidation() public {
        vm.prank(entryPoint);
        account.execute(recipient, 0.1 ether, "");
        assertEq(recipient.balance, 0.1 ether);
    }

    function testTransferWithinLimitPasses() public {
        vm.prank(owner);
        account.execute(recipient, 1 ether, "");
        assertEq(recipient.balance, 1 ether);
    }

    function testTransferAboveLimitReverts() public {
        vm.expectRevert(abi.encodeWithSelector(PolicyManager.SpendingLimitExceeded.selector, 2 ether, 1 ether));
        vm.prank(owner);
        account.execute(recipient, 2 ether, "");
    }

    function testNormalApprovalPasses() public {
        bytes memory approval = abi.encodeWithSelector(token.approve.selector, address(maliciousSpender), 25e18);
        vm.prank(owner);
        account.execute(address(token), 0, approval);
        assertEq(token.allowance(address(account), address(maliciousSpender)), 25e18);
    }

    function testUnlimitedApprovalReverts() public {
        bytes memory approval =
            abi.encodeWithSelector(token.approve.selector, address(maliciousSpender), type(uint256).max);
        vm.expectRevert(
            abi.encodeWithSelector(PolicyManager.UnlimitedApprovalBlocked.selector, address(maliciousSpender))
        );
        vm.prank(owner);
        account.execute(address(token), 0, approval);
    }

    function testMalformedApprovalCalldataReverts() public {
        bytes memory malformedApproval = abi.encodePacked(token.approve.selector, address(maliciousSpender));
        vm.expectRevert(PolicyManager.MalformedApprovalCalldata.selector);
        vm.prank(owner);
        account.execute(address(token), 0, malformedApproval);
    }

    function testTrustedTargetCanBeAddedAndRemoved() public {
        vm.startPrank(owner);
        account.setTrustedTarget(address(target), true);
        assertTrue(policyManager.trustedTargets(address(target)));
        account.setTrustedTarget(address(target), false);
        vm.stopPrank();
        assertFalse(policyManager.trustedTargets(address(target)));
    }

    function testOnlyOwnerCanModifyPolicies() public {
        vm.expectRevert(ParanoiaAccount.Unauthorized.selector);
        vm.prank(stranger);
        account.setMaxNativeTransfer(2 ether);
    }

    function testEntryPointCanUpdatePolicyThroughAccount() public {
        bytes memory updateLimit = abi.encodeCall(account.setMaxNativeTransfer, (2 ether));
        vm.prank(entryPoint);
        account.execute(address(account), 0, updateLimit);
        assertEq(policyManager.maxNativeTransfer(), 2 ether);
    }

    function testOwnerCanWhitelistAndRemove7702Delegate() public {
        address delegate = makeAddr("trustedDelegate");
        vm.startPrank(owner);
        account.whitelist7702Delegate(delegate);
        assertTrue(account.is7702DelegateWhitelisted(delegate));
        account.removeWhitelisted7702Delegate(delegate);
        vm.stopPrank();
        assertFalse(account.is7702DelegateWhitelisted(delegate));
    }

    function testUnwhitelisted7702DelegateIsBlocked() public {
        address delegate = makeAddr("unknownDelegate");
        vm.expectRevert(abi.encodeWithSelector(PolicyManager.Untrusted7702Delegate.selector, delegate));
        account.validateProposed7702Delegate(delegate);
    }

    function testWhitelisted7702DelegateIsAllowed() public {
        address delegate = makeAddr("trustedDelegate");
        vm.prank(owner);
        account.whitelist7702Delegate(delegate);
        account.validateProposed7702Delegate(delegate);
    }

    function testExplicitlyBlockedTargetReverts() public {
        vm.prank(owner);
        account.setTargetBlocked(address(target), true);
        vm.expectRevert(abi.encodeWithSelector(PolicyManager.BlockedTarget.selector, address(target)));
        vm.prank(owner);
        account.execute(address(target), 0, abi.encodeCall(target.ping, ()));
    }

    function testMaliciousDrainWorksWithoutProtection() public {
        vm.prank(address(account));
        token.approve(address(maliciousSpender), type(uint256).max);
        maliciousSpender.drain(token, address(account), recipient);
        assertEq(token.balanceOf(address(account)), 0);
        assertEq(token.balanceOf(recipient), 100e18);
    }

    function testMaliciousDrainBlockedByParanoia() public {
        bytes memory approval =
            abi.encodeWithSelector(token.approve.selector, address(maliciousSpender), type(uint256).max);
        vm.expectRevert(
            abi.encodeWithSelector(PolicyManager.UnlimitedApprovalBlocked.selector, address(maliciousSpender))
        );
        vm.prank(owner);
        account.execute(address(token), 0, approval);
        assertEq(token.allowance(address(account), address(maliciousSpender)), 0);

        vm.expectRevert();
        maliciousSpender.drain(token, address(account), recipient);
        assertEq(token.balanceOf(address(account)), 100e18);
        assertEq(token.balanceOf(recipient), 0);
    }

    function testDemoSixHundredthsBlockedByFiveHundredthsLimit() public {
        vm.prank(owner);
        account.setMaxNativeTransfer(0.05 ether);
        vm.expectRevert(
            abi.encodeWithSelector(PolicyManager.SpendingLimitExceeded.selector, 0.06 ether, 0.05 ether)
        );
        vm.prank(owner);
        account.execute(recipient, 0.06 ether, "");
        assertEq(recipient.balance, 0);
        assertEq(address(account).balance, 10 ether);
    }

    // These tests document current protection gaps. Passing means the attack
    // or risky action is possible, not that the wallet blocked it.
    function testKnownGapFiniteApprovalCanDrainEntireTokenBalance() public {
        vm.prank(owner);
        account.execute(
            address(token), 0, abi.encodeCall(token.approve, (address(maliciousSpender), 100e18))
        );
        maliciousSpender.drain(token, address(account), recipient);
        assertEq(token.balanceOf(address(account)), 0);
        assertEq(token.balanceOf(recipient), 100e18);
    }

    function testKnownGapBlockedSpenderCanStillReceiveApprovalViaToken() public {
        vm.startPrank(owner);
        account.setTargetBlocked(address(maliciousSpender), true);
        account.execute(
            address(token), 0, abi.encodeCall(token.approve, (address(maliciousSpender), 100e18))
        );
        vm.stopPrank();
        maliciousSpender.drain(token, address(account), recipient);
        assertEq(token.balanceOf(address(account)), 0);
        assertEq(token.balanceOf(recipient), 100e18);
    }

    function testKnownGapUnknownContractCallIsAllowed() public {
        assertFalse(policyManager.trustedTargets(address(target)));
        assertFalse(policyManager.blockedTargets(address(target)));
        vm.prank(owner);
        account.execute(address(target), 0, abi.encodeCall(target.ping, ()));
    }

    function testKnownGapNativeLimitIsPerCallNotCumulative() public {
        vm.startPrank(owner);
        account.setMaxNativeTransfer(0.05 ether);
        account.execute(recipient, 0.04 ether, "");
        account.execute(recipient, 0.04 ether, "");
        vm.stopPrank();
        assertEq(recipient.balance, 0.08 ether);
    }
}
