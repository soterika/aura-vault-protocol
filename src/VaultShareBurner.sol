// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title VaultShareBurner
 * @dev Allows users to burn their vault shares, reducing total supply and increasing share price
 * 
 * This implements a share buyback and burn mechanism where:
 * - Any address can burn their own shares
 * - Burning proportionally reduces total_shares (increasing share price)
 * - Burned event emitted for tracking
 * - Cannot burn more than caller holds
 * - Burning blocked while vault is paused
 */
contract VaultShareBurner is Ownable, Pausable, ReentrancyGuard {
    // ============================================
    # Events
    // ============================================

    /**
     * @dev Emitted when shares are burned
     * @param account Address that burned shares
     * @param shares Amount of shares burned
     * @param totalShares New total shares after burn
     * @param timestamp Time of burn
     */
    event Burned(
        address indexed account,
        uint256 shares,
        uint256 totalShares,
        uint256 timestamp
    );

    /**
     * @dev Emitted when burning is paused/unpaused
     * @param paused New paused state
     */
    event BurningPaused(bool paused);

    // ============================================
    # State Variables
    // ============================================

    /**
     * @dev Mapping of account to share balance
     */
    mapping(address => uint256) private _balances;

    /**
     * @dev Total supply of vault shares
     */
    uint256 private _totalShares;

    /**
     * @dev Maximum shares that can be burned per transaction
     */
    uint256 public constant MAX_BURN_PER_TX = 10_000_000 * 10**18; // 10 million shares

    /**
     * @dev Whether burning is paused
     */
    bool public burningPaused;

    /**
     * @dev Minimum shares that must remain after burn
     */
    uint256 public constant MIN_SHARES_AFTER_BURN = 1 * 10**18; // 1 share minimum

    // ============================================
    # Modifiers
    // ============================================

    /**
     * @dev Modifier to check if burning is enabled
     */
    modifier whenBurningNotPaused() {
        require(!burningPaused, "VaultShareBurner: burning paused");
        _;
    }

    /**
     * @dev Modifier to check if burning is not paused by the global pause
     */
    modifier whenNotPaused() {
        require(!paused(), "VaultShareBurner: vault paused");
        _;
    }

    // ============================================
    # Constructor
    // ============================================

    /**
     * @dev Constructor initializes the contract
     * @param initialTotalShares Initial total supply of shares
     */
    constructor(uint256 initialTotalShares) {
        _totalShares = initialTotalShares;
    }

    // ============================================
    # Core Functions
    // ============================================

    /**
     * @dev Burn shares from caller's balance
     * @param shares Amount of shares to burn
     * 
     * Requirements:
     * - Caller must have sufficient shares
     * - Burning must not be paused
     * - Vault must not be paused
     * - Cannot burn more than MAX_BURN_PER_TX
     * - Must leave at least MIN_SHARES_AFTER_BURN shares
     */
    function burn(uint256 shares) external 
        nonReentrant 
        whenNotPaused 
        whenBurningNotPaused 
    {
        require(shares > 0, "VaultShareBurner: cannot burn zero shares");
        require(shares <= MAX_BURN_PER_TX, "VaultShareBurner: exceeds max burn per tx");
        require(shares <= _balances[msg.sender], "VaultShareBurner: insufficient shares");
        require(
            _totalShares - shares >= MIN_SHARES_AFTER_BURN,
            "VaultShareBurner: would leave too few shares"
        );

        // Reduce caller's balance
        _balances[msg.sender] -= shares;

        // Reduce total supply
        _totalShares -= shares;

        // Emit event
        emit Burned(
            msg.sender,
            shares,
            _totalShares,
            block.timestamp
        );
    }

    /**
     * @dev Batch burn multiple addresses' shares (admin only)
     * @param accounts Array of addresses to burn from
     * @param shares Array of shares to burn
     * 
     * Requirements:
     * - Only callable by owner
     * - Arrays must have same length
     * - Each account must have sufficient shares
     */
    function batchBurn(address[] calldata accounts, uint256[] calldata shares) 
        external 
        onlyOwner 
        nonReentrant 
        whenNotPaused 
    {
        require(accounts.length == shares.length, "VaultShareBurner: arrays length mismatch");
        require(accounts.length > 0, "VaultShareBurner: empty arrays");
        require(accounts.length <= 100, "VaultShareBurner: too many accounts");

        uint256 totalBurned = 0;

        for (uint256 i = 0; i < accounts.length; i++) {
            address account = accounts[i];
            uint256 amount = shares[i];

            require(amount > 0, "VaultShareBurner: cannot burn zero shares");
            require(amount <= _balances[account], "VaultShareBurner: insufficient shares");

            // Reduce account balance
            _balances[account] -= amount;
            totalBurned += amount;

            emit Burned(
                account,
                amount,
                _totalShares - totalBurned,
                block.timestamp
            );
        }

        // Reduce total supply
        require(
            _totalShares - totalBurned >= MIN_SHARES_AFTER_BURN,
            "VaultShareBurner: would leave too few shares"
        );
        _totalShares -= totalBurned;
    }

    // ============================================
    # View Functions
    // ============================================

    /**
     * @dev Get the share balance of an account
     * @param account Address to check
     * @return Share balance
     */
    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    /**
     * @dev Get the total supply of shares
     * @return Total shares
     */
    function totalShares() external view returns (uint256) {
        return _totalShares;
    }

    /**
     * @dev Get the share price (in wei per share)
     * @param totalValue Total value of assets in vault
     * @return Share price
     */
    function getSharePrice(uint256 totalValue) external view returns (uint256) {
        if (_totalShares == 0) {
            return 0;
        }
        return totalValue * 10**18 / _totalShares;
    }

    /**
     * @dev Check if an address can burn shares
     * @param account Address to check
     * @return Whether the address can burn
     */
    function canBurn(address account) external view returns (bool) {
        return !burningPaused && !paused() && _balances[account] > 0;
    }

    /**
     * @dev Get the remaining shares after burning
     * @param account Address to check
     * @param shares Amount to burn
     * @return Remaining shares
     */
    function getRemainingAfterBurn(address account, uint256 shares) external view returns (uint256) {
        if (shares > _balances[account]) {
            return 0;
        }
        return _balances[account] - shares;
    }

    // ============================================
    # Admin Functions
    // ============================================

    /**
     * @dev Pause or unpause burning
     * @param paused New paused state
     * 
     * Requirements:
     * - Only callable by owner
     */
    function setBurningPaused(bool paused) external onlyOwner {
        burningPaused = paused;
        emit BurningPaused(paused);
    }

    /**
     * @dev Mint shares (for initial distribution)
     * @param to Address to mint to
     * @param amount Amount to mint
     * 
     * Requirements:
     * - Only callable by owner
     * - Amount must be > 0
     */
    function mint(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "VaultShareBurner: mint to zero address");
        require(amount > 0, "VaultShareBurner: mint zero amount");

        _balances[to] += amount;
        _totalShares += amount;
    }

    // ============================================
    # Internal Functions
    // ============================================

    /**
     * @dev Internal function to burn shares (called by other contracts)
     * @param account Address to burn from
     * @param shares Amount to burn
     */
    function _burn(address account, uint256 shares) internal {
        require(shares > 0, "VaultShareBurner: cannot burn zero shares");
        require(shares <= _balances[account], "VaultShareBurner: insufficient shares");

        _balances[account] -= shares;
        _totalShares -= shares;

        emit Burned(
            account,
            shares,
            _totalShares,
            block.timestamp
        );
    }
}
