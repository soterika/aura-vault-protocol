// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title KeeperTracker
 * @dev Tracks per-address keeper harvest data for fair compensation
 * 
 * This contract tracks which keeper triggered each harvest so that an
 * off-chain rewards system can fairly compensate keepers.
 */
contract KeeperTracker is Ownable, Pausable, ReentrancyGuard {
    // ============================================
    # Data Structures
    // ============================================

    /**
     * @dev Keeper statistics
     */
    struct KeeperStats {
        uint256 totalHarvests;
        uint256 totalYieldInjected;
        uint256 lastHarvestTimestamp;
        uint256 lastHarvestAmount;
    }

    /**
     * @dev Harvest record
     */
    struct HarvestRecord {
        address keeper;
        uint256 yieldAmount;
        uint256 timestamp;
        uint256 blockNumber;
        bytes32 txHash;
    }

    // ============================================
    # Events
    // ============================================

    /**
     * @dev Emitted when a keeper triggers a harvest
     * @param keeper Address of the keeper
     * @param yieldAmount Amount of yield harvested
     * @param totalHarvests Total harvests by this keeper
     * @param totalYieldInjected Total yield injected by this keeper
     */
    event HarvestTriggered(
        address indexed keeper,
        uint256 yieldAmount,
        uint256 totalHarvests,
        uint256 totalYieldInjected
    );

    /**
     * @dev Emitted when keeper statistics are updated
     * @param keeper Address of the keeper
     * @param totalHarvests Total harvests
     * @param totalYieldInjected Total yield injected
     */
    event KeeperStatsUpdated(
        address indexed keeper,
        uint256 totalHarvests,
        uint256 totalYieldInjected
    );

    /**
     * @dev Emitted when a keeper is registered
     * @param keeper Address of the keeper
     * @param registrationTime Time of registration
     */
    event KeeperRegistered(
        address indexed keeper,
        uint256 registrationTime
    );

    /**
     * @dev Emitted when a keeper is deregistered
     * @param keeper Address of the keeper
     * @param deregistrationTime Time of deregistration
     */
    event KeeperDeregistered(
        address indexed keeper,
        uint256 deregistrationTime
    );

    // ============================================
    # State Variables
    // ============================================

    /**
     * @dev Mapping of keeper address to their statistics
     */
    mapping(address => KeeperStats) public keeperStats;

    /**
     * @dev Mapping of keeper address to harvest history
     */
    mapping(address => HarvestRecord[]) public harvestHistory;

    /**
     * @dev List of all registered keepers
     */
    address[] public registeredKeepers;

    /**
     * @dev Mapping of keeper address to registration status
     */
    mapping(address => bool) public isRegisteredKeeper;

    /**
     * @dev Total harvests across all keepers
     */
    uint256 public totalHarvests;

    /**
     * @dev Total yield injected across all keepers
     */
    uint256 public totalYieldInjected;

    /**
     * @dev Maximum harvest history per keeper
     */
    uint256 public constant MAX_HARVEST_HISTORY = 1000;

    /**
     * @dev Minimum yield amount to track
     */
    uint256 public minYieldToTrack = 1e6; // 0.01 tokens

    // ============================================
    # Modifiers
    // ============================================

    /**
     * @dev Modifier to check if caller is a registered keeper
     */
    modifier onlyRegisteredKeeper() {
        require(isRegisteredKeeper[msg.sender], "KeeperTracker: caller is not a registered keeper");
        _;
    }

    /**
     * @dev Modifier to check if vault is not paused
     */
    modifier whenNotPaused() {
        require(!paused(), "KeeperTracker: vault paused");
        _;
    }

    // ============================================
    # Core Functions
    // ============================================

    /**
     * @dev Track a harvest event triggered by a keeper
     * @param keeper Address of the keeper
     * @param yieldAmount Amount of yield harvested
     * 
     * Requirements:
     * - Caller must be a registered keeper
     * - Yield amount must be > 0
     * - Vault must not be paused
     */
    function trackHarvest(
        address keeper,
        uint256 yieldAmount
    ) external 
        nonReentrant 
        whenNotPaused 
        onlyRegisteredKeeper 
    {
        require(keeper != address(0), "KeeperTracker: zero keeper address");
        require(yieldAmount > 0, "KeeperTracker: zero yield amount");
        require(yieldAmount >= minYieldToTrack, "KeeperTracker: yield below minimum");

        // Update keeper stats
        KeeperStats storage stats = keeperStats[keeper];
        stats.totalHarvests++;
        stats.totalYieldInjected += yieldAmount;
        stats.lastHarvestTimestamp = block.timestamp;
        stats.lastHarvestAmount = yieldAmount;

        // Update global stats
        totalHarvests++;
        totalYieldInjected += yieldAmount;

        // Store harvest record
        if (harvestHistory[keeper].length < MAX_HARVEST_HISTORY) {
            harvestHistory[keeper].push(HarvestRecord({
                keeper: keeper,
                yieldAmount: yieldAmount,
                timestamp: block.timestamp,
                blockNumber: block.number,
                txHash: bytes32(0) // txhash not available in contract
            }));
        }

        // Emit events
        emit HarvestTriggered(
            keeper,
            yieldAmount,
            stats.totalHarvests,
            stats.totalYieldInjected
        );

        emit KeeperStatsUpdated(
            keeper,
            stats.totalHarvests,
            stats.totalYieldInjected
        );
    }

    /**
     * @dev Register a keeper
     * @param keeper Address of the keeper
     * 
     * Requirements:
     * - Only callable by owner
     * - Keeper must not already be registered
     */
    function registerKeeper(address keeper) external onlyOwner {
        require(keeper != address(0), "KeeperTracker: zero keeper address");
        require(!isRegisteredKeeper[keeper], "KeeperTracker: keeper already registered");

        isRegisteredKeeper[keeper] = true;
        registeredKeepers.push(keeper);

        emit KeeperRegistered(keeper, block.timestamp);
    }

    /**
     * @dev Deregister a keeper
     * @param keeper Address of the keeper
     * 
     * Requirements:
     * - Only callable by owner
     * - Keeper must be registered
     */
    function deregisterKeeper(address keeper) external onlyOwner {
        require(isRegisteredKeeper[keeper], "KeeperTracker: keeper not registered");

        isRegisteredKeeper[keeper] = false;

        // Remove from registeredKeepers array
        for (uint256 i = 0; i < registeredKeepers.length; i++) {
            if (registeredKeepers[i] == keeper) {
                registeredKeepers[i] = registeredKeepers[registeredKeepers.length - 1];
                registeredKeepers.pop();
                break;
            }
        }

        emit KeeperDeregistered(keeper, block.timestamp);
    }

    /**
     * @dev Batch register multiple keepers
     * @param keepers Array of keeper addresses
     * 
     * Requirements:
     * - Only callable by owner
     */
    function batchRegisterKeepers(address[] calldata keepers) external onlyOwner {
        for (uint256 i = 0; i < keepers.length; i++) {
            if (keepers[i] != address(0) && !isRegisteredKeeper[keepers[i]]) {
                isRegisteredKeeper[keepers[i]] = true;
                registeredKeepers.push(keepers[i]);
                emit KeeperRegistered(keepers[i], block.timestamp);
            }
        }
    }

    // ============================================
    # View Functions
    // ============================================

    /**
     * @dev Get keeper statistics
     * @param keeper Address of the keeper
     * @return KeeperStats struct
     */
    function getKeeperStats(address keeper) external view returns (KeeperStats memory) {
        return keeperStats[keeper];
    }

    /**
     * @dev Get harvest history for a keeper
     * @param keeper Address of the keeper
     * @param limit Number of records to return (0 = all)
     * @return Array of harvest records
     */
    function getHarvestHistory(
        address keeper,
        uint256 limit
    ) external view returns (HarvestRecord[] memory) {
        HarvestRecord[] storage history = harvestHistory[keeper];
        uint256 historyLength = history.length;
        
        if (limit == 0 || limit > historyLength) {
            limit = historyLength;
        }

        HarvestRecord[] memory result = new HarvestRecord[](limit);
        uint256 startIndex = historyLength - limit;
        
        for (uint256 i = 0; i < limit; i++) {
            result[i] = history[startIndex + i];
        }
        
        return result;
    }

    /**
     * @dev Get recent harvests across all keepers
     * @param limit Number of records to return
     * @return Array of harvest records
     */
    function getRecentHarvests(uint256 limit) external view returns (HarvestRecord[] memory) {
        // Collect recent harvests from all keepers
        // This is a simplified version - would need more sophisticated logic
        HarvestRecord[] memory result = new HarvestRecord[](limit);
        uint256 count = 0;
        
        for (uint256 i = 0; i < registeredKeepers.length && count < limit; i++) {
            address keeper = registeredKeepers[i];
            HarvestRecord[] storage history = harvestHistory[keeper];
            uint256 historyLength = history.length;
            
            if (historyLength > 0) {
                uint256 startIndex = historyLength > 1 ? historyLength - 1 : 0;
                result[count] = history[startIndex];
                count++;
            }
        }
        
        return result;
    }

    /**
     * @dev Get all registered keepers
     * @return Array of keeper addresses
     */
    function getRegisteredKeepers() external view returns (address[] memory) {
        return registeredKeepers;
    }

    /**
     * @dev Get number of registered keepers
     * @return Number of keepers
     */
    function getKeeperCount() external view returns (uint256) {
        return registeredKeepers.length;
    }

    /**
     * @dev Get total harvests for a keeper
     * @param keeper Address of the keeper
     * @return Total harvests
     */
    function getKeeperHarvestCount(address keeper) external view returns (uint256) {
        return keeperStats[keeper].totalHarvests;
    }

    /**
     * @dev Get total yield injected by a keeper
     * @param keeper Address of the keeper
     * @return Total yield injected
     */
    function getKeeperYieldTotal(address keeper) external view returns (uint256) {
        return keeperStats[keeper].totalYieldInjected;
    }

    /**
     * @dev Get top keepers by harvest count
     * @param limit Number of keepers to return
     * @return Array of keeper addresses and their stats
     */
    function getTopKeepers(uint256 limit) external view returns (address[] memory, KeeperStats[] memory) {
        uint256 count = registeredKeepers.length;
        if (limit > count) {
            limit = count;
        }

        // Simple implementation - returns keepers in order of registration
        address[] memory keeperAddresses = new address[](limit);
        KeeperStats[] memory stats = new KeeperStats[](limit);
        
        for (uint256 i = 0; i < limit; i++) {
            keeperAddresses[i] = registeredKeepers[i];
            stats[i] = keeperStats[registeredKeepers[i]];
        }
        
        return (keeperAddresses, stats);
    }

    /**
     * @dev Check if an address is a registered keeper
     * @param keeper Address to check
     * @return Whether the address is a registered keeper
     */
    function isKeeper(address keeper) external view returns (bool) {
        return isRegisteredKeeper[keeper];
    }

    // ============================================
    # Admin Functions
    // ============================================

    /**
     * @dev Set minimum yield amount to track
     * @param _minYieldToTrack New minimum yield amount
     * 
     * Requirements:
     * - Only callable by owner
     */
    function setMinYieldToTrack(uint256 _minYieldToTrack) external onlyOwner {
        minYieldToTrack = _minYieldToTrack;
    }

    /**
     * @dev Reset keeper stats (use with caution)
     * @param keeper Address of the keeper
     * 
     * Requirements:
     * - Only callable by owner
     */
    function resetKeeperStats(address keeper) external onlyOwner {
        require(isRegisteredKeeper[keeper], "KeeperTracker: keeper not registered");
        
        delete keeperStats[keeper];
        delete harvestHistory[keeper];
        
        emit KeeperStatsUpdated(keeper, 0, 0);
    }

    /**
     * @dev Force a harvest record (for migration)
     * @param keeper Address of the keeper
     * @param yieldAmount Amount of yield
     * @param timestamp Timestamp of harvest
     * 
     * Requirements:
     * - Only callable by owner
     */
    function forceHarvestRecord(
        address keeper,
        uint256 yieldAmount,
        uint256 timestamp
    ) external onlyOwner {
        require(keeper != address(0), "KeeperTracker: zero keeper address");
        require(yieldAmount > 0, "KeeperTracker: zero yield amount");

        KeeperStats storage stats = keeperStats[keeper];
        stats.totalHarvests++;
        stats.totalYieldInjected += yieldAmount;
        stats.lastHarvestTimestamp = timestamp;
        stats.lastHarvestAmount = yieldAmount;

        totalHarvests++;
        totalYieldInjected += yieldAmount;

        if (harvestHistory[keeper].length < MAX_HARVEST_HISTORY) {
            harvestHistory[keeper].push(HarvestRecord({
                keeper: keeper,
                yieldAmount: yieldAmount,
                timestamp: timestamp,
                blockNumber: block.number,
                txHash: bytes32(0)
            }));
        }

        emit HarvestTriggered(
            keeper,
            yieldAmount,
            stats.totalHarvests,
            stats.totalYieldInjected
        );
    }
}
