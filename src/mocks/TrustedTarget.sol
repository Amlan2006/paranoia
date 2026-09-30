// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract TrustedTarget {
    uint256 public callCount;

    function ping() external {
        ++callCount;
    }
}
