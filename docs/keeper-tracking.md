# Keeper Tracking

## Soroban Vault API

The Soroban vault maintains a `KeeperRecord` per keeper with `address`,
`harvest_count`, `total_yield_harvested`, `last_harvest_ledger`, and
`registered_at`. `register_keeper(keeper)` lets a keeper register with its own
authorization. A successful `harvest` also creates the record if needed and
updates the gross yield counters atomically with the harvest.

Read `get_keeper_stats(keeper)` for an individual record and
`get_top_keepers(limit)` for an on-chain leaderboard. The leaderboard is
ordered by total gross yield and caps results at 20 records. Keeper records use
persistent storage with TTL extension on access.

The backend service `backend/src/services/keeperStatsService.ts` provides an
indexed-event leaderboard from the existing `vault_events` harvest stream:

```ts
const topKeepers = await getKeeperStats(20);
```

It reports yield as a decimal string to avoid losing database numeric
precision. The indexed view can lag behind the chain; use `get_keeper_stats`
for the authoritative current contract record.

## Overview
The keeper tracking system tracks which keeper triggered each harvest so that an off-chain rewards system can fairly compensate keepers.

## Architecture

### Data Storage

#### KeeperStats
```solidity
struct KeeperStats {
    uint256 totalHarvests;
    uint256 totalYieldInjected;
    uint256 lastHarvestTimestamp;
    uint256 lastHarvestAmount;
}
struct HarvestRecord {
    address keeper;
    uint256 yieldAmount;
    uint256 timestamp;
    uint256 blockNumber;
    bytes32 txHash;
}
event HarvestTriggered(
    address indexed keeper,
    uint256 yieldAmount,
    uint256 totalHarvests,
    uint256 totalYieldInjected
);
event KeeperStatsUpdated(
    address indexed keeper,
    uint256 totalHarvests,
    uint256 totalYieldInjected
);
const events = await contract.queryFilter("HarvestTriggered", fromBlock, toBlock);
const leaderboard = new Map();

for (const event of events) {
    const keeper = event.args.keeper;
    const yieldAmount = event.args.yieldAmount;
    
    if (!leaderboard.has(keeper)) {
        leaderboard.set(keeper, { totalHarvests: 0, totalYield: 0 });
    }
    
    const stats = leaderboard.get(keeper);
    stats.totalHarvests++;
    stats.totalYield += yieldAmount;
}

// Sort by totalYield descending
const sorted = Array.from(leaderboard.entries())
    .sort((a, b) => b[1].totalYield - a[1].totalYield);
