// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title YieldSmoother
 * @dev Smooths yield distribution over time to prevent share price volatility
 * 
 * Instead of applying all harvested yield immediately, this contract drips it
 * linearly over a configurable period, providing smooth share price appreciation.
 */
contract YieldSmoother is Ownable, Pausable, ReentrancyGuard {
    // ============================================
    # Errors
    // ============================================

    /**
     * @dev Thrown when trying to add yield with zero amount
     */
    error ZeroYieldAmount();

    /**
     * @dev Thrown when drip period is zero
     */
    error ZeroDripPeriod();

    /**
     * @dev Thrown when trying to set invalid drip period
     */
    error InvalidDripPeriod();

    // ============================================
    # Events
    // ============================================

    /**
     * @dev Emitted when yield is added to pending
     * @param amount Amount of yield added
     * @param totalPending Total pending yield
     * @param dripEndTimestamp When drip ends
     * @param dripRate Rate per second
     */
    event YieldAdded(
        uint256 amount,
        uint256 totalPending,
        uint256 dripEndTimestamp,
        uint256 dripRate
    );

    /**
     * @dev Emitted when yield is dripped
     * @param amount Amount dripped
     * @param timestamp When it was dripped
     */
    event YieldDripped(
        uint256 amount,
        uint256 timestamp
    );

    /**
     * @dev Emitted when drip period is updated
     * @param oldPeriod Old drip period
     * @param newPeriod New drip period
     */
    event DripPeriodUpdated(
        uint256 oldPeriod,
        uint256 newPeriod
    );

    /**
     * @dev Emitted when vault is paused
     * @param timestamp When paused
     */
    event YieldPaused(uint256 timestamp);

    /**
     * @dev Emitted when vault is unpaused
     * @param timestamp When unpaused
     */
    event YieldUnpaused(uint256 timestamp);

    // ============================================
    # State Variables
    // ============================================

    /**
     * @dev Pending yield amount
     */
    uint256 public pendingYield;

    /**
     * @dev When the drip ends
     */
    uint256 public dripEndTimestamp;

    /**
     * @dev Drip start timestamp
     */
    uint256 public dripStartTimestamp;

    /**
     * @dev Drip period in seconds (default: 6 hours)
     */
    uint256 public dripPeriod = 6 * 3600; // 6 hours

    /**
     * @dev Yield drip rate per second
     */
    uint256 public dripRate;

    /**
     * @dev Total yield dripped so far
     */
    uint256 public totalYieldDripped;

    /**
     * @dev Total yield added
     */
    uint256 public totalYieldAdded;

    /**
     * @dev Whether yield is paused
     */
    bool public yieldPaused;

    /**
     * @dev Minimum yield amount to add (dust threshold)
     */
    uint256 public constant MIN_YIELD_AMOUNT = 1e6; // 0.01 tokens

    /**
     * @dev Maximum drip period (7 days)
     */
    uint256 public constant MAX_DRIP_PERIOD = 7 * 24 * 3600; // 7 days

    /**
     * @dev Minimum drip period (1 minute)
     */
    uint256 public constant MIN_DRIP_PERIOD = 60; // 1 minute

    // ============================================
    # Modifiers
    // ============================================

    /**
     * @dev Modifier to check if vault is not paused
     */
    modifier whenNotYieldPaused() {
        require(!yieldPaused, "YieldSmoother: yield paused");
        _;
    }

    // ============================================
    # Core Functions
    // ============================================

    /**
     * @dev Add yield to pending for smoothing
     * @param amount Amount of yield to add
     * 
     * Requirements:
     * - Amount must be > 0
     * - Drip period must be configured
     * - Vault must not be paused
     */
    function addYield(uint256 amount) external 
        nonReentrant 
        whenNotPaused 
        whenNotYieldPaused 
    {
        if (amount == 0) revert ZeroYieldAmount();
        require(amount >= MIN_YIELD_AMOUNT, "YieldSmoother: amount too small");

        // Drip any existing yield first
        _dripYield();

        // Add to pending yield
        pendingYield += amount;
        totalYieldAdded += amount;

        // Calculate drip rate
        uint256 currentTimestamp = block.timestamp;
        
        // If there was no pending yield before, start new drip
        if (pendingYield == amount) {
            // Only if there was no existing drip
            dripStartTimestamp = currentTimestamp;
            dripEndTimestamp = currentTimestamp + dripPeriod;
        } else {
            // Extend drip period based on remaining duration
            uint256 remainingTime = dripEndTimestamp > currentTimestamp 
                ? dripEndTimestamp - currentTimestamp 
                : 0;
            uint256 newRemainingTime = remainingTime + dripPeriod;
            dripEndTimestamp = currentTimestamp + newRemainingTime;
        }

        // Update drip rate
        _updateDripRate();

        emit YieldAdded(
            amount,
            pendingYield,
            dripEndTimestamp,
            dripRate
        );
    }

    /**
     * @dev Drip accrued yield
     * 
     * @return amountDripped Amount of yield dripped
     */
    function dripYield() external 
        nonReentrant 
        returns (uint256 amountDripped) 
    {
        amountDripped = _dripYield();
        return amountDripped;
    }

    /**
     * @dev Internal function to drip accrued yield
     * @return amountDripped Amount of yield dripped
     */
    function _dripYield() internal returns (uint256 amountDripped) {
        if (pendingYield == 0 || block.timestamp <= dripStartTimestamp) {
            return 0;
        }

        // If vault is paused, apply full yield immediately
        if (paused()) {
            amountDripped = pendingYield;
            pendingYield = 0;
            dripRate = 0;
            
            emit YieldDripped(amountDripped, block.timestamp);
            return amountDripped;
        }

        // Calculate time elapsed since start
        uint256 currentTimestamp = block.timestamp;
        uint256 timeElapsed = currentTimestamp - dripStartTimestamp;
        
        // Calculate dripped amount based on time elapsed
        if (timeElapsed >= dripPeriod) {
            // All yield is dripped
            amountDripped = pendingYield;
            pendingYield = 0;
            dripRate = 0;
        } else {
            // Partially dripped
            uint256 drippedSoFar = (dripRate * timeElapsed);
            if (drippedSoFar > pendingYield) {
                drippedSoFar = pendingYield;
            }
            amountDripped = drippedSoFar;
            pendingYield -= amountDripped;
            
            // Update drip start for remaining yield
            if (pendingYield > 0) {
                dripStartTimestamp = currentTimestamp;
                dripEndTimestamp = currentTimestamp + dripPeriod;
                _updateDripRate();
            } else {
                dripRate = 0;
            }
        }

        totalYieldDripped += amountDripped;

        if (amountDripped > 0) {
            emit YieldDripped(amountDripped, block.timestamp);
        }

        return amountDripped;
    }

    /**
     * @dev Update drip rate based on current pending yield and remaining time
     */
    function _updateDripRate() internal {
        if (pendingYield == 0 || dripEndTimestamp <= block.timestamp) {
            dripRate = 0;
            return;
        }

        uint256 remainingTime = dripEndTimestamp - block.timestamp;
        if (remainingTime == 0) {
            dripRate = pendingYield;
        } else {
            dripRate = pendingYield / remainingTime;
        }
    }

    /**
     * @dev Get the current drip rate
     * @return Current drip rate per second
     */
    function getCurrentDripRate() public view returns (uint256) {
        if (pendingYield == 0 || dripEndTimestamp <= block.timestamp) {
            return 0;
        }

        uint256 remainingTime = dripEndTimestamp - block.timestamp;
        if (remainingTime == 0) {
            return pendingYield;
        }
        return pendingYield / remainingTime;
    }

    /**
     * @dev Get the amount of yield that would be dripped at a given timestamp
     * @param timestamp Timestamp to check
     * @return Amount that would be dripped
     */
    function getDrippedAmountAt(uint256 timestamp) external view returns (uint256) {
        if (pendingYield == 0 || timestamp <= dripStartTimestamp) {
            return 0;
        }

        uint256 timeElapsed = timestamp - dripStartTimestamp;
        if (timeElapsed >= dripPeriod) {
            return pendingYield;
        }

        uint256 drippedAmount = (dripRate * timeElapsed);
        if (drippedAmount > pendingYield) {
            drippedAmount = pendingYield;
        }
        return drippedAmount;
    }

    /**
     * @dev Get the remaining pending yield
     * @return Remaining pending yield
     */
    function getPendingYield() external view returns (uint256) {
        return pendingYield;
    }

    /**
     * @dev Get the current drip rate
     * @return Current drip rate
     */
    function getDripRate() external view returns (uint256) {
        return getCurrentDripRate();
    }

    /**
     * @dev Get yield stats
     * @return totalAdded Total yield added
     * @return totalDripped Total yield dripped
     * @return pending Remaining pending yield
     */
    function getYieldStats() external view returns (
        uint256 totalAdded,
        uint256 totalDripped,
        uint256 pending
    ) {
        return (totalYieldAdded, totalYieldDripped, pendingYield);
    }

    /**
     * @dev Get drip progress percentage
     * @return Progress as a percentage (0-100)
     */
    function getDripProgress() external view returns (uint256) {
        if (pendingYield == 0 || dripEndTimestamp <= block.timestamp) {
            return 0;
        }

        uint256 totalTime = dripEndTimestamp - dripStartTimestamp;
        if (totalTime == 0) {
            return 0;
        }

        uint256 elapsed = block.timestamp - dripStartTimestamp;
        if (elapsed >= totalTime) {
            return 100;
        }

        return (elapsed * 100) / totalTime;
    }

    // ============================================
    # Admin Functions
    // ============================================

    /**
     * @dev Set the drip period
     * @param _dripPeriod New drip period in seconds
     * 
     * Requirements:
     * - Only callable by owner
     * - Period must be between MIN_DRIP_PERIOD and MAX_DRIP_PERIOD
     */
    function setDripPeriod(uint256 _dripPeriod) external onlyOwner {
        if (_dripPeriod == 0) revert ZeroDripPeriod();
        if (_dripPeriod < MIN_DRIP_PERIOD || _dripPeriod > MAX_DRIP_PERIOD) {
            revert InvalidDripPeriod();
        }

        // Drip existing yield before changing period
        _dripYield();

        uint256 oldPeriod = dripPeriod;
        dripPeriod = _dripPeriod;

        // Recalculate drip rate if there's pending yield
        if (pendingYield > 0) {
            dripStartTimestamp = block.timestamp;
            dripEndTimestamp = block.timestamp + dripPeriod;
            _updateDripRate();
        }

        emit DripPeriodUpdated(oldPeriod, _dripPeriod);
    }

    /**
     * @dev Pause yield dripping
     * 
     * Requirements:
     * - Only callable by owner
     */
    function pauseYield() external onlyOwner {
        _dripYield();
        yieldPaused = true;
        emit YieldPaused(block.timestamp);
    }

    /**
     * @dev Unpause yield dripping
     * 
     * Requirements:
     * - Only callable by owner
     */
    function unpauseYield() external onlyOwner {
        yieldPaused = false;
        // Recalculate drip rate after unpause
        if (pendingYield > 0) {
            dripStartTimestamp = block.timestamp;
            dripEndTimestamp = block.timestamp + dripPeriod;
            _updateDripRate();
        }
        emit YieldUnpaused(block.timestamp);
    }

    /**
     * @dev Force apply all pending yield (emergency)
     * 
     * Requirements:
     * - Only callable by owner
     */
    function forceApplyYield() external onlyOwner {
        if (pendingYield > 0) {
            uint256 amount = pendingYield;
            pendingYield = 0;
            dripRate = 0;
            totalYieldDripped += amount;
            
            emit YieldDripped(amount, block.timestamp);
        }
    }

    /**
     * @dev Reset yield state (use with caution)
     * 
     * Requirements:
     * - Only callable by owner
     */
    function resetYieldState() external onlyOwner {
        _dripYield();
        pendingYield = 0;
        dripRate = 0;
        dripStartTimestamp = 0;
        dripEndTimestamp = 0;
    }
}
