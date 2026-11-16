// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Minimal ERC-20 with a public mint for tests.
contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/**
 * @dev Simulates Aave v2/v3 LendingPool and the matching aToken.
 *
 * Architecture mirrors the real Aave system:
 *   1.  deposit()  → transfers underlying from caller into pool, mints 1:1 aTokens to onBehalfOf.
 *   2.  withdraw() → burns aTokens from msg.sender, sends underlying back.
 *   3.  accrueInterest(token, amount) → test helper that inflates the pool's
 *       aToken balance for `onBehalfOf` to simulate yield accrual.
 *
 * The pool also implements the IAToken interface so the strategy can call
 * aToken.balanceOf() on it (the pool IS the aToken registry in this mock).
 */
contract MockLendingPool {
    /// @dev underlying deposited per (token => onBehalfOf).
    mapping(address => mapping(address => uint256)) public deposited;

    // ── LendingPool interface ────────────────────────────────────────────────

    function deposit(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 /*referralCode*/
    ) external {
        IERC20(asset).transferFrom(msg.sender, address(this), amount);
        deposited[asset][onBehalfOf] += amount;
    }

    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256) {
        require(deposited[asset][msg.sender] >= amount, "MockPool: insufficient");
        deposited[asset][msg.sender] -= amount;
        IERC20(asset).transfer(to, amount);
        return amount;
    }

    // ── aToken-like balance interface (used by _protocolBalance in strategy) ─

    /// @dev Returns the aToken balance for `owner` (i.e. the deposited amount,
    ///      which may have been inflated by accrueInterest).
    function balanceOf(address /*token*/) external pure returns (uint256) {
        // This single-arg version is used when MockLendingPool itself is
        // passed as the aToken address. Not useful without a token parameter;
        // use the two-arg helper below in tests.
        return 0;
    }
}

/**
 * @dev Standalone mock aToken that tracks balances for one underlying token.
 *      Pass its address as the `aToken` parameter in addToken().
 *      The matching MockLendingPool calls mintAToken / burnAToken on it.
 */
contract MockAToken {
    address public underlying;
    mapping(address => uint256) private _balances;

    constructor(address _underlying) {
        underlying = _underlying;
    }

    /// @notice Returns the aToken balance for `owner` — grows via accrueInterest.
    function balanceOf(address owner) external view returns (uint256) {
        return _balances[owner];
    }

    /// @dev Called by MockLendingPoolV2.deposit() to mint aTokens.
    function mint(address to, uint256 amount) external {
        _balances[to] += amount;
    }

    /// @dev Called by MockLendingPoolV2.withdraw() to burn aTokens.
    function burn(address from, uint256 amount) external {
        require(_balances[from] >= amount, "MockAToken: insufficient");
        _balances[from] -= amount;
    }

    /**
     * @notice Test helper: simulate yield accrual by inflating the aToken balance
     *         of `account` without any underlying transfer.  This mimics how the
     *         real Aave aToken rebases its totalSupply over time.
     */
    function accrueInterest(address account, uint256 interestAmount) external {
        _balances[account] += interestAmount;
    }
}

/**
 * @dev Upgraded mock LendingPool that works in concert with MockAToken.
 *      Use this (MockLendingPoolV2 + MockAToken) when you need realistic
 *      aToken balance tracking in tests.
 */
contract MockLendingPoolV2 {
    /// @dev underlying held per token address.
    mapping(address => uint256) public poolBalance;

    // ── LendingPool interface ────────────────────────────────────────────────

    function deposit(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 /*referralCode*/
    ) external {
        IERC20(asset).transferFrom(msg.sender, address(this), amount);
        poolBalance[asset] += amount;

        // Mint matching aTokens.
        address aToken = _aTokenOf(asset);
        if (aToken != address(0)) {
            MockAToken(aToken).mint(onBehalfOf, amount);
        }
    }

    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256) {
        require(poolBalance[asset] >= amount, "MockPoolV2: insufficient liquidity");
        poolBalance[asset] -= amount;
        IERC20(asset).transfer(to, amount);

        // Burn aTokens from caller.
        address aToken = _aTokenOf(asset);
        if (aToken != address(0)) {
            MockAToken(aToken).burn(msg.sender, amount);
        }
        return amount;
    }

    // ── aToken registry ──────────────────────────────────────────────────────

    mapping(address => address) private _aTokens;

    /// @dev Register the aToken address for a given underlying asset.
    function registerAToken(address asset, address aToken) external {
        _aTokens[asset] = aToken;
    }

    function _aTokenOf(address asset) internal view returns (address) {
        return _aTokens[asset];
    }
}

/// @dev Simulates Compound cToken: 1:1 exchange rate, explicit mint/redeem.
contract MockCToken {
    address public underlying;
    mapping(address => uint256) public balanceOf;
    uint256 public exchangeRateStored = 1e18;

    constructor(address _underlying) {
        underlying = _underlying;
    }

    /// @dev Returns 0 on success (Compound convention).
    function mint(uint256 mintAmount) external returns (uint256) {
        IERC20(underlying).transferFrom(msg.sender, address(this), mintAmount);
        balanceOf[msg.sender] += mintAmount;
        return 0;
    }

    /// @dev Returns 0 on success.
    function redeem(uint256 redeemTokens) external returns (uint256) {
        require(balanceOf[msg.sender] >= redeemTokens, "MockCToken: insufficient");
        balanceOf[msg.sender] -= redeemTokens;
        IERC20(underlying).transfer(msg.sender, redeemTokens);
        return 0;
    }

    /// @dev Simulates interest accrual (no-op in mock).
    function exchangeRateCurrent() external returns (uint256) {
        return exchangeRateStored;
    }

    /**
     * @notice Test helper: simulate yield accrual by inflating balance and
     *         transferring extra underlying from the test to the cToken contract.
     *         Call token.mint(address(cToken), interestAmount) before this.
     */
    function accrueInterest(address account, uint256 interestAmount) external {
        balanceOf[account] += interestAmount;
    }
}
