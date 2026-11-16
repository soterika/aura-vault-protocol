# Share Burning Mechanism

## Overview
The vault share burning mechanism allows the protocol to implement share buyback and burn programs, increasing share price over time.

## How It Works

### Burning Shares
1. User calls `burn(shares)` with the amount they want to burn
2. Contract verifies:
   - User has sufficient shares
   - Burning is not paused
   - Vault is not paused
   - Amount is within limits
3. Shares are removed from user's balance
4. Total supply is reduced proportionally
5. Share price increases automatically

### Share Price Impact
- **Before Burn**: `price = totalValue / totalShares`
- **After Burn**: `price = totalValue / (totalShares - burnedShares)`
- Price increases because denominator decreases

## Features

### Core Functions

#### `burn(uint256 shares)`
Burns shares from caller's balance.

**Requirements:**
- Caller must have sufficient shares
- Burning must not be paused
- Vault must not be paused
- Amount ≤ MAX_BURN_PER_TX
- Must leave at least MIN_SHARES_AFTER_BURN

#### `batchBurn(address[] accounts, uint256[] shares)`
Burns shares from multiple addresses (admin only).

#### `balanceOf(address account)`
Returns share balance of an account.

#### `totalShares()`
Returns total supply of shares.

#### `getSharePrice(uint256 totalValue)`
Calculates current share price.

### Events

#### `Burned(address indexed account, uint256 shares, uint256 totalShares, uint256 timestamp)`
Emitted when shares are burned.

#### `BurningPaused(bool paused)`
Emitted when burning is paused/unpaused.

## Security Considerations

### Protection Mechanisms
1. **Amount Limits**: Max burn per transaction
2. **Minimum Balance**: Cannot burn below minimum threshold
3. **Pause Controls**: Owner can pause burning
4. **Reentrancy Guard**: Prevents reentrancy attacks

### Footguns
1. **Burning all shares** - Cannot burn below MIN_SHARES_AFTER_BURN
2. **Burning more than balance** - Reverts with insufficient shares
3. **Burning while paused** - Reverts with paused error

## Use Cases

### Protocol Buybacks
1. Protocol accumulates fees in a fee recipient address
2. Protocol burns shares from fee recipient
3. Share price increases
4. All remaining shareholders benefit

### User-Initiated Burns
1. User wants to exit position
2. User burns shares instead of selling
3. Reduces total supply
4. Increases value of remaining shares

## Testing

### Unit Tests
```bash
npx hardhat test test/VaultShareBurner.test.ts
