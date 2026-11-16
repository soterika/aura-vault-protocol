# ADR-001: Choice of Soroban over EVM

## Status

Accepted

## Context

When designing the Aura Vault Protocol, we needed to choose a smart contract platform. The primary options considered were Ethereum Virtual Machine (EVM) based chains (Ethereum, Polygon, Arbitrum, etc.) and Soroban, Stellar's smart contract platform.

Key factors influencing this decision:
- Transaction costs and scalability requirements
- Developer experience and tooling maturity
- Target user base and ecosystem integration
- Technical capabilities and limitations
- Long-term protocol sustainability

The vault protocol requires frequent operations (deposits, withdrawals, harvests) that must be cost-effective for users while maintaining security and decentralization.

## Decision

We will build the Aura Vault Protocol on Soroban (Stellar's smart contract platform) rather than EVM-based chains.

## Consequences

### Positive

- **Low transaction costs**: Soroban transactions cost fractions of a cent, making frequent vault operations economically viable for all user segments
- **Predictable fees**: Fixed fee structure eliminates gas price volatility and MEV concerns that plague EVM chains
- **Native multi-asset support**: Stellar's built-in asset issuance and atomic pathfinding simplify complex DeFi operations
- **Rust development**: Memory-safe, performant language with excellent tooling and growing DeFi developer adoption
- **5-second finality**: Near-instant transaction confirmation improves user experience compared to EVM block times
- **Built-in compliance features**: Stellar's regulatory-friendly design supports institutional adoption
- **Energy efficiency**: Stellar Consensus Protocol is environmentally sustainable compared to Ethereum's energy usage

### Negative

- **Smaller ecosystem**: Limited DeFi protocols and liquidity compared to mature EVM ecosystems
- **Fewer developers**: Smaller talent pool familiar with Soroban development
- **Tooling immaturity**: Development tools and infrastructure still evolving compared to battle-tested EVM toolchain
- **Limited composability**: Fewer protocols to integrate with for yield generation strategies
- **Uncertain adoption**: Risk that Soroban may not achieve widespread adoption despite technical merits

### Neutral

- **Different programming model**: Rust and Soroban SDK require learning curve but offer better security guarantees
- **Stellar network dependency**: Protocol success tied to Stellar's continued development and adoption
- **Cross-chain complexity**: Integration with other ecosystems requires additional bridge infrastructure

## Notes

This decision was made in early 2024 when Soroban was entering production readiness. The choice prioritizes user accessibility through low costs over immediate ecosystem benefits. We maintain flexibility to deploy on EVM chains in the future if market conditions or technical requirements change.

Key references:
- [Soroban Documentation](https://soroban.stellar.org/)
- [Stellar Consensus Protocol](https://developers.stellar.org/docs/encyclopedia/consensus-protocol)
- [EVM Gas Cost Analysis](https://etherscan.io/gastracker)