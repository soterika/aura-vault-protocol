# Aura Vault upgrade playbook

## Preconditions

1. Build the proposed Wasm from the exact reviewed commit and record its SHA-256 hash.
2. Record the deployed contract address, contract version, storage layout version, admin, underlying token, total shares, total deposits, and representative account balances.
3. Confirm that the new Wasm expects the same storage layout version as the deployed contract. The `upgrade` entry point checks `LayoutVersion` against `CURRENT_LAYOUT_VERSION` before it changes the Wasm hash. A mismatch returns `StorageLayoutMismatch` (error 10) and leaves the upgrade unapplied.
4. Pause deposits and withdrawals if the release changes accounting behavior. Coordinate this with users and operators before proceeding.

## Same-layout code upgrade

1. Upload the reviewed Wasm and verify the uploaded hash.
2. Submit the governance upgrade proposal with that hash and collect the configured signer threshold.
3. Call `upgrade` as an authorized governance signer. Do not bypass the contract's layout-version guard.
4. Read back the contract version and the recorded state from the pre-upgrade checklist. Compare total shares, total deposits, and representative balances before unpausing.
5. Resume deposits and withdrawals only after those reads match the expected values.

## Storage-layout changes

The current `upgrade` method is a same-layout guard. It does not snapshot storage, invoke a post-upgrade migration hook, or run the `aura-migration` contract. Do not label a layout-changing Wasm as compatible or use the vault-to-vault migrator as an in-place storage migration: `aura-migration` moves user positions between two vault instances.

For a schema change, deploy and review a dedicated migration path before upgrading. The path must define an explicit source version, destination version, bounded/idempotent transformations, and read-back invariants for every affected key. Until an on-chain migration hook is implemented and reviewed, use a new vault instance with the audited vault-to-vault migration flow instead of upgrading the existing instance across layouts.

## Rollback

Soroban Wasm replacement is not a data rollback. Keep the previous Wasm hash and the pre-upgrade state record. If the new code is faulty but the layout is unchanged, submit a governed upgrade back to the previous Wasm and repeat the read-back checks. If state has changed incompatibly, pause the vault and follow the incident response process; do not assume restoring the old Wasm restores prior state.
