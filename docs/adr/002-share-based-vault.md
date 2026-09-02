# ADR-002: Share-based Vault vs Rebasing Token

## Status

Accepted

## Context

Yield-bearing vault protocols can implement value accrual through two primary mechanisms:

1. **Share-based model**: Users receive vault shares that represent a proportional claim on the underlying assets. The share-to-asset exchange rate increases as yield is harvested.

2. **Rebasing token model**: Users receive tokens that automatically increase in quantity as yield accrues, maintaining a 1:1 relationship with the underlying asset.

The choice affects user experience, integration complexity, gas costs, and composability with other DeFi protocols.

## Decision

We will implement a share-based vault model where users receive ERC-20-compatible vault shares that appreciate in value relative to the underlying assets.

## Consequences

### Positive

- **Predictable share supply**: Total shares remain constant between deposits/withdrawals, simplifying accounting and preventing inflation attacks
- **Gas efficiency**: No need for periodic rebase operations across all holders, reducing operational costs
- **Composability**: Vault shares can be used as collateral or traded on DEXs without rebase complications
- **Tax clarity**: Many jurisdictions treat appreciation as unrealized gains until redemption, compared to rebasing which may trigger taxable events
- **Integration simplicity**: DeFi protocols can integrate vault shares without handling rebase mechanics
- **Precise accounting**: Share-based math eliminates rounding errors that accumulate in rebasing systems
- **MEV resistance**: No predictable rebase transactions that could be front-run or manipulated

### Negative

- **User confusion**: Less intuitive than 1:1 token model; users must understand exchange rate mechanics
- **Price discovery complexity**: External systems need to calculate underlying value from share price and exchange rate  
- **Display challenges**: Wallets and explorers may show share count rather than underlying value without special integration
- **Education requirement**: Users need to understand that their share count remains constant while value increases

### Neutral

- **Implementation complexity**: Similar development effort between models, with different trade-offs
- **Yield calculation**: Both models require similar backend logic for APY computation and reporting
- **Frontend complexity**: Share model requires exchange rate calculations in UI but eliminates rebase handling

## Notes

The decision aligns with successful vault protocols like Yearn Finance and follows the EIP-4626 tokenized vault standard. The share-based model is battle-tested and widely adopted in the DeFi ecosystem.

Mathematical implementation uses the following formulas:
```
shares_to_mint = floor(deposit_amount × total_shares / total_assets)
assets_to_redeem = floor(shares_to_burn × total_assets / total_shares)
```

References:
- [EIP-4626: Tokenized Vault Standard](https://eips.ethereum.org/EIPS/eip-4626)
- [Yearn Finance Architecture](https://docs.yearn.fi/getting-started/products/yvaults/vault-tokens)
- [OpenZeppelin ERC4626 Implementation](https://docs.openzeppelin.com/contracts/4.x/erc4626)