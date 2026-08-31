// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title StorageInspector
 * @dev Provides read-only introspection functions for debugging and monitoring
 * 
 * This contract exposes the full contract state for debugging purposes.
 * All functions are read-only and do not modify state.
 */
contract StorageInspector is Ownable {
    // ============================================
    # Data Structures
    // ============================================

    /**
     * @dev Complete vault state
     */
    struct VaultState {
        uint256 totalAssets;
        uint256 totalShares;
        uint256 sharePrice;
        uint256 pendingYield;
        uint256 totalYieldHarvested;
        uint256 lastHarvestTimestamp;
        bool isPaused;
        bool yieldPaused;
        address admin;
        address underlyingToken;
        string version;
        uint256 createdAt;
        uint256 updatedAt;
    }

    /**
     * @dev Detailed user state
     */
    struct UserState {
        address user;
        uint256 balance;
        uint256 shares;
        uint256 deposited;
        uint256 withdrawn;
        uint256 rewardsEarned;
        uint256 lastInteraction;
    }

    /**
     * @dev System health status
     */
    struct SystemHealth {
        bool isHealthy;
        uint256 healthScore;
        uint256 totalUsers;
        uint256 activeUsers;
        uint256 averageBalance;
        uint256 totalValueLocked;
        uint256 riskLevel;
        string[] warnings;
        string[] recommendations;
    }

    // ============================================
    # Events
    // ============================================

    /**
     * @dev Emitted when state is inspected
     * @param caller Address of the caller
     * @param timestamp When inspection occurred
     */
    event StateInspected(
        address indexed caller,
        uint256 timestamp
    );

    /**
     * @dev Emitted when health check is performed
     * @param healthScore Health score
     * @param isHealthy Whether system is healthy
     */
    event HealthCheckPerformed(
        uint256 healthScore,
        bool isHealthy
    );

    // ============================================
    # State Variables
    // ============================================

    /**
     * @dev Reference to the vault contract
     */
    address public vault;

    /**
     * @dev Version of the contract
     */
    string public version = "1.0.0";

    /**
     * @dev Creation timestamp
     */
    uint256 public createdAt;

    /**
     * @dev Last update timestamp
     */
    uint256 public updatedAt;

    /**
     * @dev Total number of users
     */
    uint256 public totalUsers;

    /**
     * @dev Mapping of user addresses
     */
    mapping(address => bool) public isUser;

    /**
     * @dev User registration timestamp
     */
    mapping(address => uint256) public userRegisteredAt;

    // ============================================
    # Constructor
    // ============================================

    /**
     * @dev Constructor initializes the inspector
     * @param _vault Address of the vault contract
     */
    constructor(address _vault) {
        require(_vault != address(0), "StorageInspector: zero vault address");
        vault = _vault;
        createdAt = block.timestamp;
        updatedAt = block.timestamp;
    }

    // ============================================
    # Core Inspection Functions
    // ============================================

    /**
     * @dev Get complete vault state
     * @return VaultState struct with all state variables
     */
    function getState() external view returns (VaultState memory) {
        // This is a template - actual implementation would fetch from the vault
        // In a real implementation, these values would come from the vault contract
        
        return VaultState({
            totalAssets: _getTotalAssets(),
            totalShares: _getTotalShares(),
            sharePrice: _getSharePrice(),
            pendingYield: _getPendingYield(),
            totalYieldHarvested: _getTotalYieldHarvested(),
            lastHarvestTimestamp: _getLastHarvestTimestamp(),
            isPaused: _isPaused(),
            yieldPaused: _isYieldPaused(),
            admin: _getAdmin(),
            underlyingToken: _getUnderlyingToken(),
            version: version,
            createdAt: createdAt,
            updatedAt: updatedAt
        });
    }

    /**
     * @dev Get user state
     * @param user Address of the user
     * @return UserState struct with user details
     */
    function getUserState(address user) external view returns (UserState memory) {
        return UserState({
            user: user,
            balance: _getUserBalance(user),
            shares: _getUserShares(user),
            deposited: _getUserDeposited(user),
            withdrawn: _getUserWithdrawn(user),
            rewardsEarned: _getUserRewards(user),
            lastInteraction: _getUserLastInteraction(user)
        });
    }

    /**
     * @dev Get system health status
     * @return SystemHealth struct with health metrics
     */
    function getSystemHealth() external view returns (SystemHealth memory) {
        uint256 healthScore = _calculateHealthScore();
        bool isHealthy = healthScore >= 70;
        string[] memory warnings = _getWarnings(healthScore);
        string[] memory recommendations = _getRecommendations(warnings);

        return SystemHealth({
            isHealthy: isHealthy,
            healthScore: healthScore,
            totalUsers: totalUsers,
            activeUsers: _getActiveUsers(),
            averageBalance: _getAverageBalance(),
            totalValueLocked: _getTotalValueLocked(),
            riskLevel: _getRiskLevel(healthScore),
            warnings: warnings,
            recommendations: recommendations
        });
    }

    /**
     * @dev Get multiple user states in batch
     * @param users Array of user addresses
     * @return Array of UserState structs
     */
    function getBatchUserStates(address[] calldata users) external view returns (UserState[] memory) {
        UserState[] memory states = new UserState[](users.length);
        for (uint256 i = 0; i < users.length; i++) {
            states[i] = getUserState(users[i]);
        }
        return states;
    }

    // ============================================
    # Individual State Getters
    // ============================================

    /**
     * @dev Get total assets
     */
    function getTotalAssets() external view returns (uint256) {
        return _getTotalAssets();
    }

    /**
     * @dev Get total shares
     */
    function getTotalShares() external view returns (uint256) {
        return _getTotalShares();
    }

    /**
     * @dev Get share price
     */
    function getSharePrice() external view returns (uint256) {
        return _getSharePrice();
    }

    /**
     * @dev Get pending yield
     */
    function getPendingYield() external view returns (uint256) {
        return _getPendingYield();
    }

    /**
     * @dev Get total yield harvested
     */
    function getTotalYieldHarvested() external view returns (uint256) {
        return _getTotalYieldHarvested();
    }

    /**
     * @dev Get last harvest timestamp
     */
    function getLastHarvestTimestamp() external view returns (uint256) {
        return _getLastHarvestTimestamp();
    }

    /**
     * @dev Check if vault is paused
     */
    function isPaused() external view returns (bool) {
        return _isPaused();
    }

    /**
     * @dev Check if yield is paused
     */
    function isYieldPaused() external view returns (bool) {
        return _isYieldPaused();
    }

    /**
     * @dev Get admin address
     */
    function getAdmin() external view returns (address) {
        return _getAdmin();
    }

    /**
     * @dev Get underlying token address
     */
    function getUnderlyingToken() external view returns (address) {
        return _getUnderlyingToken();
    }

    /**
     * @dev Get contract version
     */
    function getVersion() external view returns (string memory) {
        return version;
    }

    // ============================================
    # User State Getters
    // ============================================

    /**
     * @dev Get user balance
     */
    function getUserBalance(address user) external view returns (uint256) {
        return _getUserBalance(user);
    }

    /**
     * @dev Get user shares
     */
    function getUserShares(address user) external view returns (uint256) {
        return _getUserShares(user);
    }

    /**
     * @dev Get user deposited amount
     */
    function getUserDeposited(address user) external view returns (uint256) {
        return _getUserDeposited(user);
    }

    /**
     * @dev Get user withdrawn amount
     */
    function getUserWithdrawn(address user) external view returns (uint256) {
        return _getUserWithdrawn(user);
    }

    /**
     * @dev Get user rewards earned
     */
    function getUserRewards(address user) external view returns (uint256) {
        return _getUserRewards(user);
    }

    /**
     * @dev Get user last interaction
     */
    function getUserLastInteraction(address user) external view returns (uint256) {
        return _getUserLastInteraction(user);
    }

    // ============================================
    # Internal Helper Functions
    // ============================================

    /**
     * @dev Internal function to get total assets
     * This would be implemented based on the actual vault contract
     */
    function _getTotalAssets() internal view returns (uint256) {
        // Placeholder - would call vault contract
        return 0;
    }

    /**
     * @dev Internal function to get total shares
     */
    function _getTotalShares() internal view returns (uint256) {
        // Placeholder - would call vault contract
        return 0;
    }

    /**
     * @dev Internal function to get share price
     */
    function _getSharePrice() internal view returns (uint256) {
        // Placeholder - would call vault contract
        return 0;
    }

    /**
     * @dev Internal function to get pending yield
     */
    function _getPendingYield() internal view returns (uint256) {
        // Placeholder - would call vault contract
        return 0;
    }

    /**
     * @dev Internal function to get total yield harvested
     */
    function _getTotalYieldHarvested() internal view returns (uint256) {
        // Placeholder - would call vault contract
        return 0;
    }

    /**
     * @dev Internal function to get last harvest timestamp
     */
    function _getLastHarvestTimestamp() internal view returns (uint256) {
        // Placeholder - would call vault contract
        return 0;
    }

    /**
     * @dev Internal function to check if vault is paused
     */
    function _isPaused() internal view returns (bool) {
        // Placeholder - would call vault contract
        return false;
    }

    /**
     * @dev Internal function to check if yield is paused
     */
    function _isYieldPaused() internal view returns (bool) {
        // Placeholder - would call vault contract
        return false;
    }

    /**
     * @dev Internal function to get admin
     */
    function _getAdmin() internal view returns (address) {
        // Placeholder - would call vault contract
        return address(0);
    }

    /**
     * @dev Internal function to get underlying token
     */
    function _getUnderlyingToken() internal view returns (address) {
        // Placeholder - would call vault contract
        return address(0);
    }

    /**
     * @dev Internal function to get user balance
     */
    function _getUserBalance(address user) internal view returns (uint256) {
        // Placeholder - would call vault contract
        return 0;
    }

    /**
     * @dev Internal function to get user shares
     */
    function _getUserShares(address user) internal view returns (uint256) {
        // Placeholder - would call vault contract
        return 0;
    }

    /**
     * @dev Internal function to get user deposited
     */
    function _getUserDeposited(address user) internal view returns (uint256) {
        // Placeholder - would call vault contract
        return 0;
    }

    /**
     * @dev Internal function to get user withdrawn
     */
    function _getUserWithdrawn(address user) internal view returns (uint256) {
        // Placeholder - would call vault contract
        return 0;
    }

    /**
     * @dev Internal function to get user rewards
     */
    function _getUserRewards(address user) internal view returns (uint256) {
        // Placeholder - would call vault contract
        return 0;
    }

    /**
     * @dev Internal function to get user last interaction
     */
    function _getUserLastInteraction(address user) internal view returns (uint256) {
        // Placeholder - would call vault contract
        return 0;
    }

    /**
     * @dev Get active users count
     */
    function _getActiveUsers() internal view returns (uint256) {
        // Placeholder - would calculate active users
        return 0;
    }

    /**
     * @dev Get average balance
     */
    function _getAverageBalance() internal view returns (uint256) {
        // Placeholder - would calculate average balance
        return 0;
    }

    /**
     * @dev Get total value locked
     */
    function _getTotalValueLocked() internal view returns (uint256) {
        // Placeholder - would calculate TVL
        return 0;
    }

    /**
     * @dev Get risk level based on health score
     */
    function _getRiskLevel(uint256 healthScore) internal pure returns (uint256) {
        if (healthScore >= 90) return 1; // Low risk
        if (healthScore >= 70) return 2; // Medium risk
        if (healthScore >= 50) return 3; // High risk
        return 4; // Critical risk
    }

    /**
     * @dev Calculate health score
     */
    function _calculateHealthScore() internal view returns (uint256) {
        // Placeholder - would calculate health score
        return 85;
    }

    /**
     * @dev Get warnings based on health score
     */
    function _getWarnings(uint256 healthScore) internal pure returns (string[] memory) {
        string[] memory warnings = new string[](0);
        if (healthScore < 70) {
            warnings = new string[](1);
            warnings[0] = "Health score below threshold";
        }
        return warnings;
    }

    /**
     * @dev Get recommendations based on warnings
     */
    function _getRecommendations(string[] memory warnings) internal pure returns (string[] memory) {
        if (warnings.length == 0) {
            string[] memory empty = new string[](0);
            return empty;
        }
        string[] memory recommendations = new string[](1);
        recommendations[0] = "Review vault operations and optimize";
        return recommendations;
    }
}
