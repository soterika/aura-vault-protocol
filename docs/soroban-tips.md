# Soroban Development Tips and Gotchas

**Aura Vault Protocol — Issue #423**
Last updated: 2026-08-24

---

## Overview

This document compiles practical Soroban development pitfalls, best practices, and patterns learned while building and operating the Aura Vault contract. Each tip describes the problem, explains why it happens, and shows the solution. Where official documentation covers a topic well, links are provided to avoid duplication.

> **Versions:** Tips are based on `soroban-sdk = "21.*"` and Stellar Protocol 21. Some behavior may change in future protocol upgrades.

---

## Storage and TTL

### Tip 1 — Every storage entry has an independent TTL; forgetting to bump it causes silent data loss

**Problem:** Soroban uses archival storage. Every `Persistent` and `Temporary` entry has a TTL (time-to-live measured in ledgers). If a key's TTL reaches zero, the entry is archived and reads return `None` — silently, with no panic. This is one of the most dangerous gotchas for developers coming from EVM.

**Why it happens:** Unlike Ethereum where storage is permanent, Soroban charges for storage over time. The protocol archives entries to reclaim space.

**Solution:** Extend TTL on every mutating call using `extend_ttl`. Define constants for lifetime and threshold:

```rust
// storage.rs
pub const LEDGERS_PER_DAY: u32 = 17_280;   // ~5s per ledger
pub const MAX_TTL_DAYS: u32 = 30;
pub const BUMP_THRESHOLD_DAYS: u32 = 7;

pub const MAX_TTL: u32 = LEDGERS_PER_DAY * MAX_TTL_DAYS;       // ~518_400
pub const BUMP_THRESHOLD: u32 = LEDGERS_PER_DAY * BUMP_THRESHOLD_DAYS; // ~120_960

pub fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(BUMP_THRESHOLD, MAX_TTL);
}
```

Call `bump_instance()` at the start of every state-changing function.

📖 [Soroban Storage Docs](https://developers.stellar.org/docs/build/smart-contracts/storage-types)

---

### Tip 2 — Use `Instance` storage for shared contract state, not `Persistent` per-key

**Problem:** Storing all contract state as individual `Persistent` entries means bumping each key separately and paying for each individually.

**Why it happens:** Developers familiar with mappings in Solidity often reach for per-key persistent storage for everything.

**Solution:** Use `Instance` storage for configuration and aggregate values (admin address, total_assets, total_shares, pause flag). Use `Persistent` only for per-user data (share balances) that cannot fit in the instance. `Instance` has a single TTL that covers all instance entries.

```rust
// Good — one TTL bump covers all instance keys
env.storage().instance().set(&DataKey::TotalAssets, &new_total);
env.storage().instance().set(&DataKey::TotalShares, &new_shares);
env.storage().instance().extend_ttl(BUMP_THRESHOLD, MAX_TTL);

// Risky — each key needs its own TTL bump
env.storage().persistent().set(&DataKey::TotalAssets, &new_total);
env.storage().persistent().extend_ttl(&DataKey::TotalAssets, BUMP_THRESHOLD, MAX_TTL);
env.storage().persistent().set(&DataKey::TotalShares, &new_shares);
env.storage().persistent().extend_ttl(&DataKey::TotalShares, BUMP_THRESHOLD, MAX_TTL);
```

---

### Tip 3 — `Temporary` storage is reset on every transaction; never use it for state that must persist

**Problem:** Using `Temporary` storage for values you expect to persist between transactions causes data loss.

**Why it happens:** `Temporary` storage is designed for within-transaction scratch space. Its TTL is extremely short (typically a few ledgers) and it is not preserved across ledger closes.

**Solution:** Use `Temporary` only for within-transaction scratch values if at all. Use `Instance` or `Persistent` for anything that must survive across transactions.

---

### Tip 4 — Read your storage keys back after writing to verify they are deserializable

**Problem:** If a `DataKey` enum variant is added between contract upgrades, old storage entries written with a previous layout may not deserialize correctly with the new key enum.

**Why it happens:** Soroban serializes storage keys using XDR. If the enum discriminant changes (e.g., you insert a new variant in the middle of the enum), old keys on-chain will map to the wrong variant.

**Solution:** Always add new enum variants at the **end** of the enum. Never insert or remove variants from the middle.

```rust
// Safe — new variant added at end
pub enum DataKey {
    Admin,
    UnderlyingToken,
    TotalDeposited,
    TotalShares,
    Balance(Address),
    Paused,
    LayoutVersion,  // ✅ added at end
}

// DANGEROUS — inserted in middle, shifts all discriminants
pub enum DataKey {
    Admin,
    LayoutVersion,  // ❌ shifts TotalDeposited, TotalShares, etc.
    UnderlyingToken,
    ...
}
```

---

## Auth Patterns

### Tip 5 — `require_auth()` does not return an error; it panics on auth failure

**Problem:** Developers expect `require_auth()` to return a `Result`, but it panics (traps) if auth is not satisfied. You cannot catch this in your contract logic.

**Why it happens:** Soroban auth is enforced at the host level — a failed auth halts the entire invocation immediately.

**Solution:** Call `require_auth()` at the very beginning of functions that need it — before any state reads or writes. This follows CEI (Checks-Effects-Interactions) ordering and ensures no state changes happen before auth is confirmed.

```rust
pub fn withdraw(env: Env, caller: Address, shares: i128) -> Result<i128, VaultError> {
    caller.require_auth();  // ✅ first line — panics immediately if not authorized
    
    // ... state reads and writes follow
}
```

📖 [Auth documentation](https://developers.stellar.org/docs/build/smart-contracts/authorization)

---

### Tip 6 — Sub-invocations require separate `require_auth` or `authorize_as_current_contract`

**Problem:** When your contract calls another contract (e.g., a token transfer), the callee's `require_auth()` for your contract's address will fail unless you explicitly authorize it.

**Why it happens:** Auth is not automatically propagated through cross-contract calls.

**Solution:** Use `authorize_as_current_contract` for sub-invocations where your contract is the authorizer, or pass the appropriate auth payload.

```rust
// Correct — token transfer using the token client handles auth via the host
// The token's transfer function is invoked as the current contract
token_client.transfer(
    &env.current_contract_address(),  // from: the vault contract
    &caller,                           // to: the user
    &amount,
);
// The vault's auth context covers this transfer because it's initiated by the vault.
```

---

### Tip 7 — Admin checks are not free; always define a dedicated helper

**Problem:** Repeating the admin check inline in multiple functions is error-prone — easy to accidentally skip in a new function.

**Solution:** Centralize the admin check in a single helper that reads the stored admin address and calls `require_auth()`:

```rust
fn require_admin(env: &Env) {
    let admin: Address = env.storage().instance()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| panic_with_error!(env, VaultError::NotInitialized));
    admin.require_auth();
}

// Usage in any admin-only function
pub fn pause(env: Env) {
    require_admin(&env);
    // ...
}
```

---

## Cross-Contract Calls

### Tip 8 — Always generate typed token clients from the official interface; do not hand-roll token calls

**Problem:** Calling SEP-41 token contracts with raw invocations (`env.invoke_contract`) is verbose and bypasses compile-time type checking.

**Solution:** Import and use the official `soroban_sdk::token` client:

```rust
use soroban_sdk::token::TokenClient;

let token = TokenClient::new(&env, &token_address);
token.transfer(&from, &to, &amount);
let balance: i128 = token.balance(&address);
```

📖 [Token Interface](https://developers.stellar.org/docs/tokens/token-interface)

---

### Tip 9 — Cross-contract calls are synchronous but gas costs compound

**Problem:** Each cross-contract call adds to the transaction's instruction budget. A vault calling a token contract three times in one function uses 3× the instructions for those calls.

**Why it happens:** Soroban has per-transaction instruction limits. Deep call chains can hit this limit, causing transaction failure.

**Solution:** Cache read-only cross-contract results in local variables rather than calling the same function multiple times. For the vault, call `token.balance()` once and store it:

```rust
let actual_balance: i128 = token.balance(&env.current_contract_address());
// Reuse `actual_balance` in subsequent logic — do not call token.balance() again
```

---

### Tip 10 — Cross-contract calls do not automatically roll back on your error return

**Problem:** If your contract calls another contract (e.g., token transfer), then returns an `Err(...)` from your own function, the sub-call is **not** automatically rolled back in all cases — the transaction itself panics/rolls back at the host level, but partial state changes within your contract could have already been written.

**Solution:** Follow strict CEI ordering: perform all state-changing writes **after** external calls, or verify state pre-conditions before calling out. Never write to storage before an external call that might cause the transaction to abort.

```rust
// BAD — state written before external call
env.storage().instance().set(&DataKey::TotalDeposited, &new_total);
token.transfer_from(&caller, &env.current_contract_address(), &amount); // may fail

// GOOD — external call first, then write state
token.transfer_from(&caller, &env.current_contract_address(), &amount);
env.storage().instance().set(&DataKey::TotalDeposited, &new_total);
```

---

## Testing

### Tip 11 — Use `register_contract` in tests, not live network addresses

**Problem:** Trying to call live Stellar addresses in unit tests will fail — the test environment is fully sandboxed.

**Solution:** Register mock contracts using the test environment. Use `soroban_sdk::testutils` to create test accounts and register mock token contracts:

```rust
#[cfg(test)]
mod test {
    use soroban_sdk::{testutils::Address as _, Env};
    use soroban_sdk::token::{Client as TokenClient, StellarAssetClient};

    #[test]
    fn test_deposit() {
        let env = Env::default();
        env.mock_all_auths();  // bypass auth checks in unit tests

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(admin.clone()).address();

        let vault_id = env.register(AuraVault, ());
        let vault = AuraVaultClient::new(&env, &vault_id);
        vault.initialize(&admin, &token_id);
        // ...
    }
}
```

---

### Tip 12 — `mock_all_auths()` silently accepts all auth in tests; audit real auth paths separately

**Problem:** `env.mock_all_auths()` is convenient but masks auth bugs — your tests will pass even if `require_auth()` is missing from a function.

**Solution:** Write dedicated tests that verify unauthorized callers are rejected, using `mock_auths` with a specific address:

```rust
#[test]
#[should_panic]
fn test_pause_requires_admin() {
    let env = Env::default();
    // Do NOT call mock_all_auths() here
    let non_admin = Address::generate(&env);
    env.mock_auths(&[MockAuth {
        address: &non_admin,
        invoke: &MockAuthInvoke { contract: &vault_id, fn_name: "pause", args: ().into_val(&env) },
    }]);
    vault.pause();  // should panic because non_admin != stored admin
}
```

---

### Tip 13 — Advance ledger sequences in tests to verify TTL and time-dependent logic

**Problem:** Tests run in a single ledger by default — you cannot test TTL expiry or time-based conditions without advancing the ledger.

**Solution:** Use `env.ledger().set()` to advance sequence and timestamp:

```rust
// Advance by 100 ledgers
env.ledger().set(LedgerInfo {
    timestamp: env.ledger().timestamp() + 500, // ~100 ledgers × 5s
    protocol_version: 21,
    sequence_number: env.ledger().sequence() + 100,
    ..env.ledger().get()
});
```

---

### Tip 14 — Test events explicitly; they are the primary audit trail for the vault

**Problem:** Emitting events that have the wrong structure or wrong data is a silent bug — the transaction succeeds, but off-chain indexers receive malformed data.

**Solution:** Assert events in tests using `env.events().all()`:

```rust
let events = env.events().all();
assert_eq!(events.len(), 1);
// events is a Vec<(ContractId, Topics, Data)>
let (contract, topics, data) = events.first().unwrap();
assert_eq!(contract, vault_id);
// Verify specific topic values
```

---

## Common Pitfalls

### Tip 15 — `i128` not `u128`: Soroban token amounts are signed

**Problem:** Soroban token balances and transfer amounts use `i128`, not `u128`. Trying to use `u128` arithmetic then convert will cause issues.

**Why it happens:** The token interface is defined with `i128` to allow balance-difference calculations that could temporarily be negative in intermediate steps.

**Solution:** Use `i128` throughout for token amounts. Validate that amounts are positive at the entry point of your contract functions:

```rust
pub fn deposit(env: Env, caller: Address, amount: i128) -> Result<i128, VaultError> {
    if amount <= 0 {
        return Err(VaultError::ZeroAmount);
    }
    // ...
}
```

---

### Tip 16 — Integer division in share formulas truncates; never use floating point

**Problem:** Using floating-point arithmetic in share calculations introduces rounding errors that compound over many operations and can be exploited.

**Why it happens:** Soroban runs in a deterministic `no_std` environment — `f64` is available but not appropriate for financial math.

**Solution:** Use integer arithmetic with explicit floor division. Accept that the first depositor gets an exact 1:1 ratio and subsequent depositors may receive slightly fewer shares due to flooring. Document this behavior clearly.

```rust
// Correct integer share formula
let shares: i128 = amount
    .checked_mul(total_shares)
    .ok_or(VaultError::MathOverflow)?
    .checked_div(total_assets)
    .ok_or(VaultError::MathOverflow)?;
```

---

### Tip 17 — Always use `checked_mul` and `checked_div`; `overflow-checks = true` only helps in debug mode

**Problem:** Arithmetic overflow in Soroban causes a host panic and reverts the transaction. Relying on `overflow-checks = true` in release builds is not sufficient — it must be explicitly set and can still produce confusing error messages.

**Solution:** Use `checked_*` arithmetic methods on every multiplication and division that operates on user-supplied or on-chain values. Return a typed `MathOverflow` error:

```rust
let result = a.checked_mul(b).ok_or(VaultError::MathOverflow)?;
```

Also set in `Cargo.toml`:
```toml
[profile.release]
overflow-checks = true
```

---

### Tip 18 — The inflation attack: first-depositor share manipulation

**Problem:** If the first depositor deposits 1 token and then donates a large amount directly to the contract (bypassing deposit), they can manipulate the exchange rate and cause the second depositor to receive 0 shares due to floor division.

**Solution:** Reject any deposit that results in 0 shares being minted. The Aura Vault implements this as `VaultError::ZeroShares`:

```rust
let shares = compute_shares(amount, total_assets, total_shares)?;
if shares == 0 {
    return Err(VaultError::ZeroAmount);  // or ZeroShares
}
```

Also, the flash loan guard (balance mismatch check) detects unsolicited token donations before executing operations.

📖 [ERC-4626 Inflation Attack](https://docs.openzeppelin.com/contracts/4.x/erc4626#inflation-attack)

---

### Tip 19 — `panic_with_error!` vs returning `Err(...)`: know which to use

**Problem:** Using `panic!` or unreachable code paths instead of structured errors makes it impossible for callers to handle specific failure cases programmatically.

**Solution:** Use `return Err(VaultError::SomeVariant)` for expected, handleable failure conditions. Use `panic_with_error!(env, VaultError::SomeVariant)` only for invariant violations where continuing would corrupt state. Avoid bare `panic!("message")` — it produces an opaque error with no typed code.

```rust
// Good — typed error the caller can match on
if total_shares == 0 {
    return Err(VaultError::ZeroShares);
}

// Good — invariant violation that should never happen in correct operation
let admin = env.storage().instance()
    .get(&DataKey::Admin)
    .unwrap_or_else(|| panic_with_error!(&env, VaultError::NotInitialized));
```

---

### Tip 20 — `initialize` must be idempotency-protected or callable only once

**Problem:** If `initialize` can be called multiple times, an attacker can re-initialize the contract with a new admin address and take control.

**Why it happens:** Unlike constructors in EVM, Soroban `initialize` is a regular function — there is no special protection.

**Solution:** Check for an existing admin address at the start of `initialize` and return `AlreadyInitialized` if it is already set:

```rust
pub fn initialize(env: Env, admin: Address, underlying_token: Address) -> Result<(), VaultError> {
    if env.storage().instance().has(&DataKey::Admin) {
        return Err(VaultError::AlreadyInitialized);
    }
    env.storage().instance().set(&DataKey::Admin, &admin);
    env.storage().instance().set(&DataKey::UnderlyingToken, &underlying_token);
    env.storage().instance().extend_ttl(BUMP_THRESHOLD, MAX_TTL);
    Ok(())
}
```

---

### Tip 21 — Contract upgrades change the Wasm but not on-chain storage; storage migration must be explicit

**Problem:** After calling `upgrade(new_wasm_hash)`, the new Wasm executes immediately on the next invocation. If the new code reads storage keys that the old code never wrote (or expects a different layout), reads return `None` unexpectedly.

**Solution:** Version your storage layout. Store a `LayoutVersion` key and check it on first invocation after an upgrade. Provide an explicit migration function if the layout changes:

```rust
pub fn migrate(env: Env) -> Result<(), VaultError> {
    require_admin(&env);
    let current_version: u32 = env.storage().instance()
        .get(&DataKey::LayoutVersion)
        .unwrap_or(0);
    if current_version == EXPECTED_VERSION {
        return Err(VaultError::StorageLayoutMismatch);
    }
    // ... perform migration ...
    env.storage().instance().set(&DataKey::LayoutVersion, &EXPECTED_VERSION);
    Ok(())
}
```

---

### Tip 22 — Wasm binary size affects deployment cost and instruction budgets

**Problem:** Large Wasm binaries cost more to upload (based on byte size) and may approach limits. Unused dependencies pulled in via `Cargo.toml` inflate binary size.

**Solution:**
- Use `cargo build --target wasm32-unknown-unknown --release` and inspect Wasm size with `wasm-opt -Os`
- Audit `Cargo.toml` dependencies — every crate added to a `no_std` Wasm contract should be deliberate
- Enable LTO in release profile:

```toml
[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
strip = true
```

---

### Tip 23 — Events are write-only from inside the contract; you cannot read them back

**Problem:** Developers sometimes try to use events as a queryable log within the contract (e.g., "read all deposit events to compute APY on-chain"). This is not possible.

**Why it happens:** Soroban events are emitted to the ledger's event log and are only accessible off-chain via Horizon or Soroban RPC. The contract has no API to read past events.

**Solution:** Store any data the contract needs to reference later in contract storage, not in events. Events are for off-chain indexers and UIs only.

---

### Tip 24 — `env.current_contract_address()` is the correct self-reference; never hardcode a contract ID

**Problem:** Hardcoding the contract's own address as a constant is fragile — the address changes if the contract is redeployed, and it breaks on Testnet vs Mainnet.

**Solution:** Always use `env.current_contract_address()` when the contract needs to reference itself (e.g., checking its own token balance):

```rust
let vault_balance: i128 = token.balance(&env.current_contract_address());
```

---

### Tip 25 — Test the pause state explicitly in every mutating function test

**Problem:** Adding a new mutating function later and forgetting to check the pause flag is a common oversight that leaves the function unprotected.

**Solution:** Define a `require_not_paused` helper and call it in every mutating function. Test it explicitly for each function:

```rust
fn require_not_paused(env: &Env) -> Result<(), VaultError> {
    let paused: bool = env.storage().instance()
        .get(&DataKey::Paused)
        .unwrap_or(false);
    if paused {
        return Err(VaultError::VaultPaused);
    }
    Ok(())
}
```

```rust
// In each mutating function
pub fn deposit(env: Env, caller: Address, amount: i128) -> Result<i128, VaultError> {
    require_not_paused(&env)?;
    caller.require_auth();
    // ...
}
```

---

## Additional Resources

- [Soroban SDK Reference](https://docs.rs/soroban-sdk/latest/soroban_sdk/)
- [Stellar Developer Docs — Smart Contracts](https://developers.stellar.org/docs/build/smart-contracts)
- [Soroban Examples Repository](https://github.com/stellar/soroban-examples)
- [Soroban Quest (hands-on learning)](https://quest.stellar.org/soroban)
- [Stellar Stack Exchange](https://stellar.stackexchange.com)
- [Soroban Security Best Practices](https://developers.stellar.org/docs/build/smart-contracts/security)
- [Stellar Futurenet](https://developers.stellar.org/docs/fundamentals/networks) — for pre-upgrade testing
