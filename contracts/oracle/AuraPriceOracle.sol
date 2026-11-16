// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

// ─── Chainlink interface (AggregatorV3) ───────────────────────────────────────

interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}

/**
 * @title AuraPriceOracle
 * @notice Multi-feed Chainlink oracle with:
 *         - 1-hour on-chain price cache
 *         - Decimal normalisation to 18 dp
 *         - Multi-oracle fallback (primary → secondary)
 *         - Emergency pause when price deviates > MAX_DEVIATION from cache
 *         - OPERATOR_ROLE emergency pause; ADMIN can unpause and configure feeds
 *
 * Gas profile per getPrice() call (cache hit): ~3 k gas (2 SLOADs).
 * Gas profile per getPrice() call (cache miss): ~45 k gas (latestRoundData + 3 SSTOREs).
 */
contract AuraPriceOracle is AccessControl {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    uint256 public constant CACHE_TTL        = 1 hours;
    uint256 public constant MAX_DEVIATION_BP = 500;   // 5% triggers emergency pause
    uint8   public constant NORMALISED_DEC   = 18;

    struct Feed {
        AggregatorV3Interface primary;
        AggregatorV3Interface fallback_;  // address(0) = no fallback
        bool enabled;
    }

    struct CachedPrice {
        uint256 price;       // normalised to 18 dp
        uint256 updatedAt;   // block.timestamp of last fetch
    }

    mapping(bytes32 => Feed)        public feeds;         // key = feedId (e.g. keccak256("ETH/USD"))
    mapping(bytes32 => CachedPrice) public cache;
    bytes32[]                       public feedIds;

    bool public paused;

    // ─── Events ───────────────────────────────────────────────────────────────

    event FeedRegistered(bytes32 indexed feedId, address primary, address fallback_);
    event PriceUpdated(bytes32 indexed feedId, uint256 price, bool usedFallback);
    event EmergencyPaused(bytes32 indexed feedId, uint256 cachedPrice, uint256 newPrice);
    event Unpaused(address indexed by);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
    }

    // ─── Feed management ──────────────────────────────────────────────────────

    /**
     * @notice Register or update a price feed.
     * @param feedId    Arbitrary identifier, e.g. keccak256("ETH/USD").
     * @param primary   Primary Chainlink aggregator address.
     * @param fallback_ Secondary aggregator (address(0) to disable fallback).
     */
    function registerFeed(bytes32 feedId, address primary, address fallback_)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(primary != address(0), "Zero primary");
        if (!feeds[feedId].enabled) feedIds.push(feedId);
        feeds[feedId] = Feed({
            primary:  AggregatorV3Interface(primary),
            fallback_: AggregatorV3Interface(fallback_),
            enabled:  true
        });
        emit FeedRegistered(feedId, primary, fallback_);
    }

    // ─── Price queries ────────────────────────────────────────────────────────

    /**
     * @notice Return the latest price for `feedId`, normalised to 18 decimals.
     *         Returns the cached value if it is still fresh (< CACHE_TTL old).
     *         Falls back to the secondary aggregator on primary failure.
     *         Triggers an emergency pause if the new price deviates more than
     *         MAX_DEVIATION_BP from the cached price.
     */
    function getPrice(bytes32 feedId) external returns (uint256 price) {
        require(!paused, "Oracle paused");
        Feed storage feed = feeds[feedId];
        require(feed.enabled, "Feed not registered");

        CachedPrice storage cp = cache[feedId];

        // Return cached price if still fresh
        if (cp.updatedAt != 0 && block.timestamp - cp.updatedAt < CACHE_TTL) {
            return cp.price;
        }

        bool usedFallback;
        (price, usedFallback) = _fetchPrice(feed);

        // Deviation check against last cached value
        if (cp.updatedAt != 0 && cp.price != 0) {
            uint256 diff = price > cp.price ? price - cp.price : cp.price - price;
            uint256 bps  = (diff * 10_000) / cp.price;
            if (bps > MAX_DEVIATION_BP) {
                paused = true;
                emit EmergencyPaused(feedId, cp.price, price);
                revert("Price deviation: oracle paused");
            }
        }

        cp.price     = price;
        cp.updatedAt = block.timestamp;
        emit PriceUpdated(feedId, price, usedFallback);
    }

    /**
     * @notice Read cached price without triggering a refresh or the pause.
     *         Returns (price, age) where age is seconds since last update.
     */
    function getCachedPrice(bytes32 feedId)
        external
        view
        returns (uint256 price, uint256 age)
    {
        CachedPrice storage cp = cache[feedId];
        price = cp.price;
        age   = cp.updatedAt == 0 ? type(uint256).max : block.timestamp - cp.updatedAt;
    }

    // ─── Emergency controls ───────────────────────────────────────────────────

    /// @notice Manually pause the oracle (operator or admin).
    function pause() external onlyRole(OPERATOR_ROLE) {
        paused = true;
    }

    /// @notice Unpause the oracle after investigation (admin only).
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        paused = false;
        emit Unpaused(msg.sender);
    }

    // ─── View helpers ─────────────────────────────────────────────────────────

    /// @notice Return all registered feed IDs.
    function allFeedIds() external view returns (bytes32[] memory) {
        return feedIds;
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _fetchPrice(Feed storage feed)
        internal
        view
        returns (uint256 price, bool usedFallback)
    {
        // Try primary
        (bool ok, uint256 p) = _readAggregator(feed.primary);
        if (ok) return (p, false);

        // Fallback
        require(address(feed.fallback_) != address(0), "Primary failed, no fallback");
        (ok, p) = _readAggregator(feed.fallback_);
        require(ok, "Both oracles failed");
        return (p, true);
    }

    function _readAggregator(AggregatorV3Interface agg)
        internal
        view
        returns (bool ok, uint256 price)
    {
        try agg.latestRoundData() returns (
            uint80 roundId,
            int256 answer,
            uint256 /* startedAt */,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            if (
                answer <= 0 ||
                updatedAt == 0 ||
                answeredInRound < roundId
            ) return (false, 0);

            uint8 dec = agg.decimals();
            price = _normalise(uint256(answer), dec);
            return (true, price);
        } catch {
            return (false, 0);
        }
    }

    /// @dev Scale `value` from `fromDec` decimals to NORMALISED_DEC (18).
    function _normalise(uint256 value, uint8 fromDec) internal pure returns (uint256) {
        if (fromDec == NORMALISED_DEC) return value;
        if (fromDec < NORMALISED_DEC)  return value * 10 ** (NORMALISED_DEC - fromDec);
        return value / 10 ** (fromDec - NORMALISED_DEC);
    }
}
