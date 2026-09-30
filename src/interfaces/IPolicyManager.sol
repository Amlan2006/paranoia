// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPolicyManager {
    function validate(address target, uint256 value, bytes calldata data) external view;

    function setMaxNativeTransfer(uint256 newLimit) external;
    function setTrustedTarget(address target, bool trusted) external;
    function setTargetBlocked(address target, bool blocked) external;
    function setTrusted7702Delegate(address delegate, bool trusted) external;

    function is7702DelegateWhitelisted(address delegate) external view returns (bool);
}
