# Soroban TWAP Oracle Interface

The guarded `AuraVault.deposit_with_swap` entrypoint expects the configured
oracle contract to implement:

```rust
fn price(token: Address) -> (i128, u64);
fn twap_price(token: Address, lookback_secs: u64) -> (i128, u64);
```

Both prices use the same normalized price per smallest token unit and return
the observation timestamp in ledger Unix seconds. The vault requests the
configured lookback (default 1,800 seconds), rejects zero, negative, excessive,
or stale values, and rejects a spot/TWAP difference above the configured
maximum (default 500 basis points). The router must implement
`swap_exact_input(token_in, token_out, amount_in, min_amount_out, recipient)`;
the vault independently checks the router's reported output against the
underlying-token balance delta.

`set_oracle_address`, `set_oracle_max_age`, and `set_swap_config` are admin-only.
The swap configuration bounds maximum slippage to 20%, the TWAP window to
60–86,400 seconds, and spot deviation to at most 5%.
