# Aura Factory contract

`AuraFactory` is a Soroban contract for administering the accepted underlying
tokens and deployment fee, registering already deployed vaults, and listing the
registered vault addresses.

## ABI

| Method | Access | Result |
| --- | --- | --- |
| `initialize(admin, deployment_fee)` | One time | Sets the administrator and fee (stroops). |
| `whitelist_token(admin, token, enabled)` | Administrator | Adds or removes an underlying token. |
| `set_deployment_fee(admin, fee)` | Administrator | Sets a non-negative fee in stroops. |
| `deploy_vault(caller, vault, token)` | Permissionless | Registers a deployed vault for a whitelisted token. |
| `vault_count()` | Public | Number of registered vaults. |
| `list_vaults(page, page_size)` | Public | A zero-based page; page size must be positive. |
| `get_deployment_fee()` | Public | Current fee in stroops. |
| `is_token_whitelisted(token)` | Public | Whether the token is currently enabled. |

All state-changing calls require authorization from the supplied admin/caller
where specified. `deploy_vault` records the address; vault deployment and
vault initialization are performed by the caller before registration.

## Contract tests

The in-crate suite in `src/test.rs` exercises initialization, authorization,
fee updates, token allowlisting, permissionless registration, duplicate and
unapproved token rejection, vault count, and paginated listing, including
invalid page size and boundary cases. Run it with `cargo test --manifest-path
aura-factory/Cargo.toml`.
