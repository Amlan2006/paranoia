// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ParanoiaAccount} from "../src/ParanoiaAccount.sol";
import {PolicyManager} from "../src/PolicyManager.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MaliciousSpender} from "../src/mocks/MaliciousSpender.sol";
import {TrustedTarget} from "../src/mocks/TrustedTarget.sol";

contract ParanoiaAccountTest is Test {
    address internal owner = makeAddr("owner");
    address internal stranger = makeAddr("stranger");
    address internal entryPoint = makeAddr("entryPoint");
    address internal recipient = makeAddr("recipient");

    ParanoiaAccount internal account;
    PolicyManager internal policyManager;
    MockERC20 internal token;
    MaliciousSpender internal maliciousSpender;
    TrustedTarget internal target;

    function setUp() public {
        account = new ParanoiaAccount(owner, entryPoint, 1 ether);
        policyManager = PolicyManager(address(account.policyManager()));
        token = new MockERC20();
        maliciousSpender = new MaliciousSpender();
        target = new TrustedTarget();
        vm.deal(address(account), 10 ether);
        token.mint(address(account), 100e18);
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
    }
}
