# Storage Inspection Functions

## Overview
The storage inspector provides read-only introspection functions that return the full contract state for debugging and monitoring purposes.

## Features

### Core Functions

#### `getState() -> VaultState`
Returns complete vault state including:
- `totalAssets`: Total assets in vault
- `totalShares`: Total shares issued
- `sharePrice`: Current share price
- `pendingYield`: Pending yield to be dripped
- `totalYieldHarvested`: Total yield harvested
- `lastHarvestTimestamp`: Last harvest time
- `isPaused`: Whether vault is paused
- `yieldPaused`: Whether yield is paused
- `admin`: Admin address
- `underlyingToken`: Underlying token address
- `version`: Contract version
- `createdAt`: Creation timestamp
- `updatedAt`: Last update timestamp

#### `getUserState(address) -> UserState`
Returns detailed user state including:
- `user`: User address
- `balance`: Current balance
- `shares`: Shares held
- `deposited`: Total deposited
- `withdrawn`: Total withdrawn
- `rewardsEarned`: Total rewards earned
- `lastInteraction`: Last interaction timestamp

#### `getSystemHealth() -> SystemHealth`
Returns system health status including:
- `isHealthy`: Whether system is healthy
- `healthScore`: Health score (0-100)
- `totalUsers`: Total users
- `activeUsers`: Active users
- `averageBalance`: Average balance
- `totalValueLocked`: TVL
- `riskLevel`: Risk level (1-4)
- `warnings`: Warning messages
- `recommendations`: Recommendations

### Batch Functions

#### `getBatchUserStates(address[]) -> UserState[]`
Returns user states for multiple users in batch.

### Individual Getters

| Function | Returns |
|----------|---------|
| `getTotalAssets()` | `uint256` |
| `getTotalShares()` | `uint256` |
| `getSharePrice()` | `uint256` |
| `getPendingYield()` | `uint256` |
| `getTotalYieldHarvested()` | `uint256` |
| `getLastHarvestTimestamp()` | `uint256` |
| `isPaused()` | `bool` |
| `isYieldPaused()` | `bool` |
| `getAdmin()` | `address` |
| `getUnderlyingToken()` | `address` |
| `getVersion()` | `string` |

## Usage

### Monitoring Scripts

```typescript
// Example monitoring script
async function monitorVault() {
    const state = await storageInspector.getState();
    const health = await storageInspector.getSystemHealth();
    
    console.log('Vault State:', {
        totalAssets: state.totalAssets,
        sharePrice: state.sharePrice,
        isPaused: state.isPaused
    });
    
    console.log('Health:', {
        score: health.healthScore,
        isHealthy: health.isHealthy,
        tvl: health.totalValueLocked
    });
}
// Example admin UI integration
async function displayVaultStats() {
    const [state, health, users] = await Promise.all([
        storageInspector.getState(),
        storageInspector.getSystemHealth(),
        storageInspector.getBatchUserStates(activeUserList)
    ]);
    
    // Display stats in UI
}
