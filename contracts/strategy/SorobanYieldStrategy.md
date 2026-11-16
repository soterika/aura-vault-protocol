# Soroban Yield Strategy Interface

AuraVault uses the `YieldStrategy` contract client declared in
`aura-vault/src/strategy.rs`:

```rust
fn deposit(amount: i128) -> Result<(), VaultError>;
fn withdraw(amount: i128) -> Result<i128, VaultError>;
fn harvest() -> Result<i128, VaultError>;
fn total_assets() -> i128;
```

AuraVault transfers underlying tokens before calling `deposit`. A withdrawal
must transfer the requested underlying tokens back to AuraVault and report the
amount returned. `total_assets` is used in the vault's balance reconciliation;
negative values are rejected. `harvest` realizes yield, transfers it to AuraVault,
and reports the gross amount for fee and keeper accounting. A strategy change is proposed through multisig,
then waits 24 hours after the threshold is reached before execution. The
interface is checked during execution, and replacement requires the vault and
current strategy to be empty.
