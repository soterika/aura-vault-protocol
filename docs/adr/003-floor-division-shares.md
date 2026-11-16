# ADR-003: Floor Division for Share Minting

## Status

Accepted

## Context

Vault share calculations involve division operations that often result in fractional shares. Since most blockchain systems work with integer tokens, we must choose a rounding strategy:

1. **Floor division (round down)**: `shares = floor(amount × total_shares / total_assets)`
2. **Ceiling division (round up)**: `shares = ceil(amount × total_shares / total_assets)`  
3. **Banker's rounding (round to nearest)**: Complex implementation with tie-breaking rules

The choice affects fairness between depositors and the protocol, precision of share calculations, and potential for exploitation through rounding attacks.

## Decision

We will use floor division (rounding down) for share minting calculations and asset redemption calculations.

## Consequences

### Positive

- **Protocol protection**: Rounding down ensures the vault never mints more shares than mathematically justified, protecting existing shareholders from dilution
- **Inflation attack prevention**: Prevents attackers from exploiting rounding to mint shares worth more than their deposit
- **Consistent behavior**: Both deposit and withdrawal operations use the same rounding direction, maintaining mathematical consistency
- **EIP-4626 compliance**: Follows the established standard for tokenized vaults in the DeFi ecosystem
- **Simplified implementation**: Floor division is straightforward to implement and audit across different programming languages
- **Predictable outcomes**: Users always receive slightly fewer shares/assets than the exact mathematical calculation, eliminating edge cases

### Negative

- **Dust accumulation**: Small amounts of underlying tokens may accumulate in the vault over time due to rounding down
- **User experience**: Users receive slightly less than expected, which could cause confusion or dissatisfaction
- **Precision loss**: Frequent small deposits may suffer from cumulative rounding losses
- **Inequality impact**: Disproportionately affects smaller deposits relative to larger ones

### Neutral

- **Gas costs**: Floor division has similar computational cost to other rounding methods
- **Audit complexity**: Rounding behavior must be clearly documented and tested but doesn't add significant complexity
- **Cross-platform consistency**: Rust's integer division naturally floors, aligning with our choice

## Notes

The decision prioritizes protocol security and existing shareholder protection over maximizing individual user returns. The accumulated dust benefits all shareholders collectively through a slightly higher exchange rate over time.

Mathematical implementation:
```rust
// Share minting (deposit)
let shares_to_mint = (amount * total_shares) / total_assets; // Integer division floors automatically

// Asset redemption (withdrawal)  
let assets_to_redeem = (shares * total_assets) / total_shares; // Integer division floors automatically
```

Edge case handling:
- First deposit (total_shares = 0): Mint shares 1:1 with deposit amount
- Zero-share minting: Reject deposits that would result in zero shares to prevent value loss
- Overflow protection: All arithmetic uses checked operations to prevent overflow attacks

References:
- [EIP-4626 Specification](https://eips.ethereum.org/EIPS/eip-4626#security-considerations)  
- [Vault Inflation Attacks Analysis](https://mixbytes.io/blog/overview-of-the-inflation-attack)
- [OpenZeppelin Security Considerations](https://docs.openzeppelin.com/contracts/4.x/erc4626#security)