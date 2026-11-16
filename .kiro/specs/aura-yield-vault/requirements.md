# Requirements Document

## Introduction

Aura is a production-ready, share-based yield vault smart contract built on Soroban for the Stellar ecosystem. It aggregates user deposits of a single underlying token, routes them into yield-bearing opportunities, and auto-compounds returns through keeper-incentivized harvests. Depositors receive vault shares (a proportional claim on the pool) that appreciate in value as yield accrues. The contract enforces strict correctness, security, and liveness properties suitable for a DeFi primitive that holds user funds in a trust-minimized, no-std on-chain environment.

---

## Glossary

- **Vault**: The Aura smart contract instance that custodies the underlying token and manages share accounting.
- **Underlying_Token**: The single SEP-41-compatible token that the Vault accepts as deposits and returns on withdrawal.
- **Share**: An internal unit of proportional ownership of the Vault's total assets, minted on deposit and burned on withdrawal.
- **Depositor**: Any Stellar account or contract address that calls `deposit`.
- **Keeper**: An authorized or permissionless address that calls `harvest` to inject additional yield into the Vault.
- **Admin**: The address recorded at initialization that has exclusive authority over privileged operations.
- **Total_Assets**: The sum of all Underlying_Token units currently held by the Vault (equivalent to `TotalDeposited` after accounting for harvested yield).
- **Total_Shares**: The running count of all outstanding Shares across all Depositors.
- **Exchange_Rate**: The ratio `Total_Assets / Total_Shares`, denominated in Underlying_Token units per Share. Defined only when `Total_Shares > 0`.
- **TTL**: Time-To-Live — the Soroban ledger-sequence lifetime of a storage entry.
- **Instance_Storage**: Soroban storage bucket shared across all invocations of one contract instance; used for global state.
- **Persistent_Storage**: Per-key storage with independently configurable TTL; used for per-user balances.
- **Math_Overflow**: An arithmetic condition where a computed value exceeds the representable range of the integer type.
- **ZeroAmount**: An input value of exactly zero passed where a positive quantity is required.

---

## Requirements

### Requirement 1: Contract Initialization

**User Story:** As the deployer, I want to initialize the Vault exactly once with an admin address and an underlying token, so that the contract is ready to accept deposits and all subsequent calls operate against a well-defined state.

#### Acceptance Criteria

1. WHEN `initialize` is called with a valid (non-zero, non-null) `admin` address and a valid (non-zero, non-null) `underlying_token` address, THE Vault SHALL store `admin` in Instance_Storage and `underlying_token` in Instance_Storage.
2. WHEN `initialize` is called on an already-initialized Vault, THE Vault SHALL return `VaultError::AlreadyInitialized` and make no state changes.
3. WHEN `initialize` is called, THE Vault SHALL set `TotalShares` to zero and `TotalDeposited` to zero in Instance_Storage.
4. WHEN `initialize` completes successfully, THE Vault SHALL extend the Instance_Storage TTL by `INSTANCE_BUMP_AMOUNT` ledgers from the current ledger.
5. IF `initialize` is called with a zero-value or null `admin` address or `underlying_token` address, THEN THE Vault SHALL return `VaultError::InvalidAddress` and make no state changes.

---

### Requirement 2: Deposit and Share Minting

**User Story:** As a Depositor, I want to deposit Underlying_Token units and receive Shares proportional to my contribution, so that my claim on the pool grows or shrinks in line with total yield accrued.

#### Acceptance Criteria

1. WHEN `deposit` is called with `amount > 0`, THE Vault SHALL transfer exactly `amount` Underlying_Token units from the caller to the Vault.
2. WHEN `deposit` is called with `amount > 0` and `Total_Shares == 0`, THE Vault SHALL mint exactly `amount` Shares to the caller (1:1 seeding).
3. WHEN `deposit` is called with `amount > 0` and `Total_Shares > 0`, THE Vault SHALL mint `floor(amount * Total_Shares / Total_Assets)` Shares to the caller.
4. WHEN `deposit` succeeds, THE Vault SHALL add `amount` to `TotalDeposited`.
5. WHEN `deposit` succeeds, THE Vault SHALL add the minted Shares to the caller's Persistent_Storage balance.
6. WHEN `deposit` succeeds, THE Vault SHALL add the minted Shares to `Total_Shares`.
7. IF `deposit` is called with `amount == 0`, THEN THE Vault SHALL return `VaultError::ZeroAmount` and SHALL leave `TotalDeposited`, `Total_Shares`, and the caller's Persistent_Storage balance unchanged.
8. IF `deposit` is called and arithmetic for share minting would cause Math_Overflow (detected by any means before writing to storage), THEN THE Vault SHALL return `VaultError::MathOverflow` and SHALL leave all vault state variables unchanged; if overflow is detected alongside any other failure condition, `VaultError::MathOverflow` SHALL take precedence.
9. WHEN `deposit` is called and succeeds, THE Vault SHALL extend the caller's Persistent_Storage TTL by `PERSISTENT_BUMP_AMOUNT` ledgers from the current ledger.
10. WHEN `deposit` is called and succeeds, THE Vault SHALL extend the Instance_Storage TTL by `INSTANCE_BUMP_AMOUNT` ledgers from the current ledger.
11. WHILE the Vault is not initialized, THE Vault SHALL return `VaultError::NotInitialized` for any `deposit` call.
12. IF `deposit` is called and the Underlying_Token transfer from the caller fails, THEN THE Vault SHALL propagate the transfer error and make no state changes to `TotalDeposited`, `Total_Shares`, or the caller's Persistent_Storage balance.
13. IF `deposit` is called with `amount > 0` and `Total_Shares > 0` and `floor(amount * Total_Shares / Total_Assets) == 0`, THEN THE Vault SHALL return `VaultError::ZeroAmount` and make no state changes, ensuring the caller does not lose tokens without receiving shares.

---

### Requirement 3: Withdrawal and Share Burning

**User Story:** As a Depositor, I want to withdraw my proportional share of Total_Assets by burning my Shares, so that I receive the exact Underlying_Token amount my Shares entitle me to, including accrued yield.

#### Acceptance Criteria

1. WHEN `withdraw` is called with `shares > 0`, THE Vault SHALL compute `redeem_amount = floor(shares * Total_Assets / Total_Shares)` and transfer exactly that many Underlying_Token units to the caller.
2. WHEN `withdraw` is called with `shares > 0`, THE Vault SHALL subtract `shares` from the caller's Persistent_Storage balance.
3. WHEN `withdraw` is called with `shares > 0`, THE Vault SHALL subtract `shares` from `Total_Shares`.
4. WHEN `withdraw` is called with `shares > 0`, THE Vault SHALL subtract `redeem_amount` from `TotalDeposited`.
5. IF `withdraw` is called with `shares == 0`, THEN THE Vault SHALL return `VaultError::ZeroAmount` and make no state changes.
6. IF `withdraw` is called with `shares` greater than the caller's recorded balance, THEN THE Vault SHALL return `VaultError::InsufficientShares` and make no state changes.
7. IF `withdraw` is called and the arithmetic for redemption amount would cause Math_Overflow, THEN THE Vault SHALL return `VaultError::MathOverflow` and make no state changes.
8. WHEN `withdraw` succeeds, THE Vault SHALL extend the caller's Persistent_Storage TTL by `PERSISTENT_BUMP_AMOUNT` ledgers from the current ledger.
9. WHEN `withdraw` succeeds, THE Vault SHALL extend the Instance_Storage TTL by `INSTANCE_BUMP_AMOUNT` ledgers from the current ledger.
10. WHILE the Vault is not initialized, THE Vault SHALL return `VaultError::NotInitialized` for any `withdraw` call.
11. IF `withdraw` is called and the Vault's Underlying_Token balance is insufficient to transfer `redeem_amount` to the caller, THEN THE Vault SHALL return `VaultError::InsufficientUnderlying` and make no state changes.
12. IF `withdraw` is called with `shares > 0` and `floor(shares * Total_Assets / Total_Shares) == 0`, THEN THE Vault SHALL return `VaultError::ZeroAmount` and make no state changes, ensuring the caller does not burn shares without receiving any tokens.

---

### Requirement 4: Harvest and Yield Compounding

**User Story:** As a Keeper, I want to inject additional Underlying_Token units into the Vault without receiving Shares, so that all existing Shareholders benefit from compounded yield without dilution.

#### Acceptance Criteria

1. WHEN `harvest` is called with `yield_amount > 0`, THE Vault SHALL transfer exactly `yield_amount` Underlying_Token units from the caller to the Vault.
2. WHEN `harvest` is called with `yield_amount > 0`, THE Vault SHALL add `yield_amount` to `TotalDeposited`.
3. WHEN `harvest` is called, THE Vault SHALL NOT mint any new Shares.
4. WHEN `harvest` succeeds and `Total_Shares > 0`, the Exchange_Rate (`TotalDeposited / Total_Shares`) SHALL be strictly greater than the Exchange_Rate immediately before the call.
5. IF `harvest` is called with `yield_amount == 0`, THEN THE Vault SHALL return `VaultError::ZeroAmount` and make no state changes.
6. IF `harvest` is called and the addition of `yield_amount` to `TotalDeposited` would cause Math_Overflow, THEN THE Vault SHALL return `VaultError::MathOverflow` and make no state changes.
7. WHEN `harvest` succeeds, THE Vault SHALL extend the Instance_Storage TTL by `INSTANCE_BUMP_AMOUNT` ledgers from the current ledger.
8. WHILE the Vault is not initialized, THE Vault SHALL return `VaultError::NotInitialized` for any `harvest` call.
9. IF `harvest` is called and `Total_Shares == 0`, THEN THE Vault SHALL return `VaultError::ZeroShares` and make no state changes, as there are no shareholders to benefit from the yield injection.
10. IF `harvest` is called and the Underlying_Token transfer from the Keeper fails, THEN THE Vault SHALL propagate the transfer error and make no state changes to `TotalDeposited`.

---

### Requirement 5: Read-Only View Functions

**User Story:** As an integrator or UI, I want read-only functions that return the current total assets and a specific address's Share balance, so that I can display accurate vault state without modifying on-chain data.

#### Acceptance Criteria

1. WHEN `total_assets` is called on an initialized Vault, THE Vault SHALL return the current value of `TotalDeposited` from Instance_Storage; if `TotalDeposited` has never been written, it SHALL return zero.
2. WHEN `balance_of` is called with an address that has a non-zero Share balance entry in Persistent_Storage, THE Vault SHALL return that address's recorded Share balance.
3. WHEN `balance_of` is called with an address that has never deposited, has a zero-value balance entry, or has an address not present in Persistent_Storage, THE Vault SHALL return zero.
4. THE `total_assets` function SHALL NOT modify any storage entry and SHALL NOT emit any events.
5. THE `balance_of` function SHALL NOT modify any storage entry and SHALL NOT emit any events.
6. WHEN `balance_of` is called with a zero-value or otherwise invalid address, THE Vault SHALL return zero without panicking.

---

### Requirement 6: Share-Based Accounting Invariants

**User Story:** As a protocol auditor, I want the share accounting to preserve mathematical invariants across all operations, so that the vault is free from economic exploits such as inflation attacks or rounding theft.

#### Acceptance Criteria

1. AFTER each mutating call (`initialize`, `deposit`, `withdraw`, `harvest`) completes, THE Vault SHALL maintain the invariant: `sum of all individual Share balances == Total_Shares`.
2. AFTER each mutating call completes, THE Vault SHALL maintain the invariant: `Total_Assets >= 0`.
3. WHEN a caller performs a `deposit(amount)` followed immediately by `withdraw(minted_shares)` with no other state changes between the two calls, THE caller SHALL receive at least `amount - 1` Underlying_Token units (rounding loss bounded by one unit per round-trip).
4. WHEN a single Depositor is the sole holder and calls `withdraw` with `shares == Total_Shares`, THE Vault SHALL transfer all `TotalDeposited` units to the Depositor and set both `Total_Shares` and `TotalDeposited` to zero.
5. WHEN `deposit` is first called on an empty Vault (i.e., `Total_Shares == 0`), THE Vault SHALL mint exactly `amount` Shares at a 1:1 ratio, ensuring no inflation attack is possible at seeding.
6. WHEN any Depositor calls `withdraw` for their shares, THE Vault SHALL NOT alter the Share balance of any other Depositor in Persistent_Storage.

---

### Requirement 7: Storage Archival and TTL Management

**User Story:** As a contract operator, I want all storage entries to have their TTL extended on every mutating call, so that the contract state is never expired mid-operation due to Soroban's archival mechanism.

#### Acceptance Criteria

1. WHEN any mutating function (`initialize`, `deposit`, `withdraw`, `harvest`) is called, THE Vault SHALL extend the Instance_Storage TTL to at least `INSTANCE_BUMP_AMOUNT` ledgers from the current ledger before the function returns.
2. WHEN `deposit`, `withdraw`, or `harvest` is called, THE Vault SHALL extend the caller's Persistent_Storage TTL to at least `PERSISTENT_BUMP_AMOUNT` ledgers from the current ledger before the function returns.
3. IF a Persistent_Storage entry for a user does not exist, THE Vault SHALL treat it as a balance of zero and SHALL NOT panic.
4. THE Vault SHALL use `bump_instance` for Instance_Storage TTL extension and `bump_persistent` for Persistent_Storage TTL extension, as provided by the Soroban SDK.
5. THE Vault SHALL define `INSTANCE_LIFETIME_THRESHOLD`, `INSTANCE_BUMP_AMOUNT`, `PERSISTENT_LIFETIME_THRESHOLD`, and `PERSISTENT_BUMP_AMOUNT` as named constants, where each `BUMP_AMOUNT` is strictly greater than its corresponding `LIFETIME_THRESHOLD`.
6. WHEN any mutating function completes, THE Vault SHALL have extended the relevant TTLs before returning, so that no state entry can expire between the last write and the TTL extension within the same invocation.

---

### Requirement 8: Error Handling and Safety

**User Story:** As a security reviewer, I want every failure mode to return a typed error variant instead of panicking, so that callers receive actionable error codes and the contract never enters an inconsistent state.

#### Acceptance Criteria

1. THE Vault SHALL define `VaultError` with at least the variants: `NotInitialized`, `AlreadyInitialized`, `InsufficientShares`, `InsufficientUnderlying`, `ZeroAmount`, `MathOverflow`, `InvalidAddress`, `ZeroShares`.
2. WHEN any operation fails, THE Vault SHALL return the `VaultError` variant specified by the acceptance criteria of the failing operation; if no specific variant is prescribed, the variant SHALL be the most precisely matching one from the enum.
3. IF any arithmetic operation would overflow a `i128` or `u128` value, THEN THE Vault SHALL return `VaultError::MathOverflow` before committing any storage change; `VaultError::MathOverflow` SHALL take precedence over any other concurrently applicable error.
4. IF `withdraw` is called and `TotalDeposited < redeem_amount` due to any accounting discrepancy, THEN THE Vault SHALL return `VaultError::InsufficientUnderlying` and make no state changes.
5. IF any Underlying_Token transfer call fails (for `deposit`, `withdraw`, or `harvest`), THE Vault SHALL propagate the error as a typed `VaultError` variant without panicking and SHALL make no state changes.
6. THE Vault SHALL NOT use `unwrap()` or `expect()` on any fallible operation in code paths that are not `#[cfg(test)]`-gated.

---

### Requirement 9: No-Std and Soroban Environment Compatibility

**User Story:** As a smart contract developer, I want the Vault to compile and execute in the Soroban `no_std` environment, so that it can be deployed on the Stellar network without runtime dependencies.

#### Acceptance Criteria

1. THE Vault SHALL declare `#![no_std]` at the crate root.
2. THE Vault SHALL NOT use `std::string::String`, `std::vec::Vec`, `std::collections`, `Box`, or any OS-level interfaces; it SHALL use only `soroban_sdk` types and `core` library primitives.
3. THE Vault SHALL annotate the contract struct with `#[contract]` and the implementation block with `#[contractimpl]`.
4. THE Vault SHALL annotate `VaultError` with `#[contracterror]` so that SDK-level error propagation is enabled.
5. THE `AuraVaultTrait` interface SHALL be annotated with `#[contractspecentry]` so that the ABI is auto-generated.
6. THE Vault crate SHALL compile successfully when targeting `wasm32-unknown-unknown` with no implicit `std` features enabled, which is the definitive verification of `no_std` compliance.

---

### Requirement 10: Property-Based Testing and Correctness Coverage

**User Story:** As a test engineer, I want property-based and unit tests covering all invariants and edge cases, so that the contract's correctness can be verified programmatically before deployment.

#### Acceptance Criteria

1. THE Test_Suite SHALL include a round-trip property: FOR ALL `amount` in `[1, i128::MAX / 2]` on a Vault with `Total_Shares > 0`, calling `deposit(amount)` then `withdraw(minted_shares)` SHALL return a Depositor Underlying_Token balance within one unit of the pre-deposit balance (rounding invariant).
2. THE Test_Suite SHALL include a harvest non-dilution property: WHEN `Total_Shares > 0` and `harvest(yield_amount)` is called with `yield_amount` in `[1, i128::MAX / 2]`, the call SHALL succeed, all existing Share balances SHALL remain unchanged, and `TotalDeposited / Total_Shares` SHALL be strictly greater than before the call.
3. THE Test_Suite SHALL include a share-sum invariant test: AFTER each individual `deposit` or `withdraw` call in any sequence, the sum of all recorded Share balances SHALL equal `Total_Shares`.
4. THE Test_Suite SHALL include an overflow guard test: calling `deposit` with `amount = i128::MAX` on a non-empty vault SHALL return `VaultError::MathOverflow`.
5. THE Test_Suite SHALL include a zero-amount guard test: calling `deposit(0)`, `withdraw(0)`, and `harvest(0)` SHALL each return `VaultError::ZeroAmount`.
6. THE Test_Suite SHALL include a double-initialization test: calling `initialize` twice SHALL return `VaultError::AlreadyInitialized` on the second call.
7. THE Test_Suite SHALL configure the Soroban test environment with `mock_all_auths()` and SHALL create Underlying_Token instances using `StellarAssetClient` before executing any vault calls.
8. THE Test_Suite SHALL include a multi-depositor proportionality test: WHEN two Depositors each deposit an equal `amount` into an empty Vault (so `Total_Shares` is evenly divisible by 2), each SHALL hold exactly `Total_Shares / 2` Shares.
9. THE Test_Suite SHALL include a sequential harvest-then-withdraw test: WHEN a Depositor holds `s` shares with `pre_harvest_redeem = floor(s * TotalDeposited_before / Total_Shares)`, and `harvest(yield_amount)` is called and succeeds, THEN calling `withdraw(s)` SHALL return Underlying_Token units strictly greater than `pre_harvest_redeem`.
10. THE Test_Suite SHALL verify that `balance_of` returns zero for an address that has never deposited.

---

### Requirement 11: Serialization and Storage Encoding Round-Trip

**User Story:** As a contract developer, I want all stored values to serialize and deserialize correctly across Soroban's XDR-based encoding, so that data written in one invocation is readable in any subsequent invocation.

#### Acceptance Criteria

1. THE Vault SHALL use only `soroban_sdk`-provided types (`Address`, `i128`, `Symbol`) for all storage keys and values.
2. THE Vault SHALL NOT use raw bytes, manual XDR serialization, or any custom encoding for storage keys or values.
3. WHEN a value is written to any `DataKey` and then read back using the same `DataKey` in any subsequent invocation, THE Vault SHALL produce the identical value as was written (round-trip property).
4. WHEN `DataKey::Balance(address_a)` and `DataKey::Balance(address_b)` are used as storage keys and `address_a != address_b`, THE Vault SHALL write to and read from distinct storage slots with no collision.
5. WHEN a `DataKey` is read before any value has been written to it, THE Vault SHALL return the zero/default value for that type and SHALL NOT panic.
6. THE Vault SHALL define all `DataKey` variants as entries in a `#[contracttype]`-annotated enum so that Soroban's codec handles serialization automatically.
