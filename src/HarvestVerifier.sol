// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title HarvestVerifier
 * @dev Validates that harvested yield actually arrived in the vault
 * 
 * This contract extends the flash loan guard logic to verify that yield
 * amounts are genuine by checking the vault token balance before and
 * after the harvest call.
 */
contract HarvestVerifier is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============================================
    # Errors
    // ============================================

    /**
     * @dev Thrown when yield amount doesn't match actual balance increase
     */
    error YieldNotReceived(
        uint256 expectedYield,
        uint256 actualYield,
        uint256 balanceBefore,
        uint256 balanceAfter
    );

    /**
     * @dev Thrown when harvest is called during flash loan
     */
    error HarvestDuringFlashLoan();

    /**
     * @dev Thrown when no yield is harvested
     */
    error NoYieldHarvested();

    /**
     * @dev Thrown when flash loan is still active
     */
    error FlashLoanActive();

    // ============================================
    # Events
    // ============================================

    /**
     * @dev Emitted when harvest is verified successfully
     * @param yieldAmount Amount of yield harvested
     * @param balanceBefore Balance before harvest
     * @param balanceAfter Balance after harvest
     */
    event HarvestVerified(
        uint256 yieldAmount,
        uint256 balanceBefore,
        uint256 balanceAfter
    );

    /**
     * @dev Emitted when harvest verification fails
     * @param expectedYield Expected yield amount
     * @param actualYield Actual yield amount
     * @param balanceBefore Balance before harvest
     * @param balanceAfter Balance after harvest
     */
    event HarvestVerificationFailed(
        uint256 expectedYield,
        uint256 actualYield,
        uint256 balanceBefore,
        uint256 balanceAfter
    );

    /**
     * @dev Emitted when flash loan is detected
     * @param flashLoanActive Whether flash loan is active
     */
    event FlashLoanDetected(bool flashLoanActive);

    // ============================================
    # State Variables
    // ============================================

    /**
     * @dev Address of the vault token
     */
    IERC20 public token;

    /**
     * @dev Whether flash loan is currently active
     */
    bool public flashLoanActive;

    /**
     * @dev Maximum allowed deviation for yield verification (basis points)
     */
    uint256 public maxDeviationBps = 10; // 0.1%

    /**
     * @dev Minimum yield amount to verify
     */
    uint256 public minYieldAmount = 1e6; // 0.01 tokens

    /**
     * @dev Last harvest timestamp
     */
    uint256 public lastHarvestTimestamp;

    /**
     * @dev Last harvest amount
     */
    uint256 public lastHarvestAmount;

    // ============================================
    # Modifiers
    // ============================================

    /**
     * @dev Modifier to check flash loan status
     */
    modifier whenNotFlashLoan() {
        if (flashLoanActive) {
            revert FlashLoanActive();
        }
        _;
    }

    /**
     * @dev Modifier to check if vault is not paused
     */
    modifier whenNotPaused() {
        require(!paused(), "HarvestVerifier: vault paused");
        _;
    }

    // ============================================
    # Constructor
    // ============================================

    /**
     * @dev Constructor initializes the contract
     * @param _token Address of the vault token
     */
    constructor(address _token) {
        require(_token != address(0), "HarvestVerifier: zero token address");
        token = IERC20(_token);
    }

    // ============================================
    # Core Functions
    // ============================================

    /**
     * @dev Verify harvest yield by checking balance before and after
     * @param yieldAmount The expected yield amount
     * @param harvestCall The harvest function call
     * 
     * Requirements:
     * - Flash loan must not be active
     * - Vault must not be paused
     * - Yield amount must be > 0
     * - Balance must increase by yield amount
     */
    function verifyHarvest(
        uint256 yieldAmount,
        function() external harvestCall
    ) external 
        nonReentrant 
        whenNotFlashLoan 
        whenNotPaused 
        returns (uint256 actualYield)
    {
        require(yieldAmount > 0, "HarvestVerifier: zero yield amount");
        require(yieldAmount >= minYieldAmount, "HarvestVerifier: yield below minimum");

        // Read balance before
        uint256 balanceBefore = token.balanceOf(address(this));

        // Execute harvest
        harvestCall();

        // Read balance after
        uint256 balanceAfter = token.balanceOf(address(this));

        // Calculate actual yield
        actualYield = balanceAfter - balanceBefore;

        // Verify yield
        _verifyYield(yieldAmount, actualYield, balanceBefore, balanceAfter);

        // Update state
        lastHarvestTimestamp = block.timestamp;
        lastHarvestAmount = actualYield;

        emit HarvestVerified(actualYield, balanceBefore, balanceAfter);

        return actualYield;
    }

    /**
     * @dev Verify yield with custom verification function
     * @param yieldAmount The expected yield amount
     * @param beforeBalance Balance before harvest
     * @param afterBalance Balance after harvest
     */
    function verifyYieldAmount(
        uint256 yieldAmount,
        uint256 beforeBalance,
        uint256 afterBalance
    ) external view returns (bool) {
        uint256 actualYield = afterBalance - beforeBalance;
        return _isYieldValid(yieldAmount, actualYield);
    }

    /**
     * @dev Internal yield verification
     * @param expectedYield Expected yield amount
     * @param actualYield Actual yield amount
     * @param balanceBefore Balance before harvest
     * @param balanceAfter Balance after harvest
     */
    function _verifyYield(
        uint256 expectedYield,
        uint256 actualYield,
        uint256 balanceBefore,
        uint256 balanceAfter
    ) internal view {
        if (!_isYieldValid(expectedYield, actualYield)) {
            emit HarvestVerificationFailed(
                expectedYield,
                actualYield,
                balanceBefore,
                balanceAfter
            );
            revert YieldNotReceived(
                expectedYield,
                actualYield,
                balanceBefore,
                balanceAfter
            );
        }
    }

    /**
     * @dev Check if yield is valid
     * @param expectedYield Expected yield amount
     * @param actualYield Actual yield amount
     * @return Whether yield is valid
     */
    function _isYieldValid(
        uint256 expectedYield,
        uint256 actualYield
    ) internal view returns (bool) {
        // Exact match
        if (actualYield == expectedYield) {
            return true;
        }

        // Allow small deviation (within maxDeviationBps)
        if (actualYield > expectedYield) {
            uint256 deviation = (actualYield - expectedYield) * 10000 / expectedYield;
            if (deviation <= maxDeviationBps) {
                return true;
            }
        }

        return false;
    }

    // ============================================
    # Flash Loan Guard
    // ============================================

    /**
     * @dev Start flash loan (called by flash loan provider)
     */
    function startFlashLoan() external onlyOwner {
        flashLoanActive = true;
        emit FlashLoanDetected(true);
    }

    /**
     * @dev End flash loan (called by flash loan provider)
     */
    function endFlashLoan() external onlyOwner {
        flashLoanActive = false;
        emit FlashLoanDetected(false);
    }

    /**
     * @dev Check if flash loan is active
     * @return Whether flash loan is active
     */
    function isFlashLoanActive() external view returns (bool) {
        return flashLoanActive;
    }

    // ============================================
    # View Functions
    // ============================================

    /**
     * @dev Get current token balance
     * @return Current token balance
     */
    function getTokenBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    /**
     * @dev Get last harvest info
     * @return timestamp Last harvest timestamp
     * @return amount Last harvest amount
     */
    function getLastHarvest() external view returns (uint256 timestamp, uint256 amount) {
        return (lastHarvestTimestamp, lastHarvestAmount);
    }

    /**
     * @dev Check if harvest is valid
     * @param yieldAmount Expected yield amount
     * @return Whether harvest is valid
     */
    function isValidHarvest(uint256 yieldAmount) external view returns (bool) {
        return yieldAmount >= minYieldAmount && !flashLoanActive && !paused();
    }

    // ============================================
    # Admin Functions
    // ============================================

    /**
     * @dev Set maximum deviation
     * @param _maxDeviationBps New max deviation in basis points
     * 
     * Requirements:
     * - Only callable by owner
     * - Value must be <= 1000 (10%)
     */
    function setMaxDeviation(uint256 _maxDeviationBps) external onlyOwner {
        require(_maxDeviationBps <= 1000, "HarvestVerifier: deviation too high");
        maxDeviationBps = _maxDeviationBps;
    }

    /**
     * @dev Set minimum yield amount
     * @param _minYieldAmount New minimum yield amount
     * 
     * Requirements:
     * - Only callable by owner
     */
    function setMinYieldAmount(uint256 _minYieldAmount) external onlyOwner {
        minYieldAmount = _minYieldAmount;
    }

    /**
     * @dev Set token address
     * @param _token New token address
     * 
     * Requirements:
     * - Only callable by owner
     */
    function setToken(address _token) external onlyOwner {
        require(_token != address(0), "HarvestVerifier: zero token address");
        token = IERC20(_token);
    }
}
