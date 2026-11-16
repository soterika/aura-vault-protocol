# ADR-003: Isolated vault instances and a future factory

- **Status:** Proposed; maintainer review required
- **Date:** 2026-10-22
- **Deciders:** To be confirmed by protocol maintainers

## Context

USDC, XLM, and other supported assets need independent balances, share ledgers,
configuration, and administrative controls. The current Soroban contract is
single-asset per instance. The repository deploys instances separately with
the Stellar CLI and backend registry; it does not currently contain an
`aura-factory/` contract. A single multi-asset vault or upgradeable proxy would
change the contract's storage and security model.

## Decision

Keep one isolated `AuraVault` contract instance per underlying asset. Continue
to create and register instances through the deployment process. Treat an
on-chain factory as a future option that requires a separate implementation,
security review, and governance decision before production use. If adopted, it
must create instances from reviewed Wasm and must not be described as protected
by a timelock unless that control is enforced on-chain.

## Alternatives considered

- **One multi-asset vault:** rejected because every asset would share contract
  state and administrative risk, and the current contract's accounting is
  deliberately scoped to one underlying token.
- **Upgradeable proxy:** rejected for the current deployment because a proxy
  introduces an administrator-controlled code replacement path and migration
  risk for user funds.
- **On-chain factory now:** deferred because no factory contract exists in the
  repository to deploy or validate. A factory centralizes instance creation
  and can standardize configuration, but adds privileged code and a new attack
  surface.

## Consequences

Each vault keeps separate storage, governance, and upgrade state. Deployments
must register every new contract and verify its configuration independently.
The operational deployment process is less atomic than a factory and can drift
between instances. A future factory would become a high-value governance target;
mitigations must include narrowly scoped creation permissions, reviewed Wasm
hashes, timelocked changes where supported, and monitoring of deployment events.

## References

- [Multi-vault deployment architecture](../multi-vault.md)
- [`aura-vault` contract](../../aura-vault/)
