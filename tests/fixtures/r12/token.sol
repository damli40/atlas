// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Counter {
    uint256 public count;
    function increment() public returns (uint256) {
        count += 1;
        return count;
    }
}
