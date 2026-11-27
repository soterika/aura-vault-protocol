# Local development troubleshooting

Use the command from the repository root unless a step says otherwise. After
changing environment variables, restart the affected service.

## `Error: EADDRINUSE: address already in use :::3001`

**Cause:** Another process owns port 3001 (often a previous backend dev server).

**Fix:** Find the process with `lsof -i :3001` (macOS/Linux) or
`Get-NetTCPConnection -LocalPort 3001` (PowerShell). Stop that process, or set
the app's supported port variable to an unused port and update the frontend API
URL to match.

## `error[E0463]: can't find crate for 'core'`

**Cause:** Rust's WebAssembly target is missing from the active toolchain.

**Fix:** Run `rustup show` to confirm the toolchain, then install the target
used by the contract build: `rustup target add wasm32-unknown-unknown` for this
repository's existing build scripts. Re-run the same build command. If you use
a newer Soroban CLI toolchain, follow its target guidance because supported
Wasm targets vary with SDK and Rust versions.

## `FATAL: password authentication failed for user 'aura'`

**Cause:** The backend's database URL does not match the credentials of the
Postgres container or local database.

**Fix:** Copy the repository's example environment file to the expected local
`.env`, compare `DATABASE_URL` with the Postgres service's user/password in
`docker-compose.yml`, and restart the backend. Do not commit real credentials.

## `Redis connection refused`

**Cause:** Redis is stopped or the configured host/port is unreachable.

**Fix:** Start the repository services with `docker compose up -d redis`.
Confirm the configured Redis URL/host and port match the container mapping,
then inspect `docker compose logs redis` if it exits.

## `JWT_SECRET must be set`

**Cause:** The backend has no local signing secret configured.

**Fix:** Add a long random value to the backend's local `.env` as `JWT_SECRET`
and restart the backend. Use a different secret in each environment; never
commit it or reuse a production secret locally.

## `Cannot find module '@stellar/stellar-sdk'`

**Cause:** Dependencies were not installed in the package that is being run,
or the command was started from the wrong directory.

**Fix:** Run `npm install` from the package directory shown in the error
(typically `backend` or `frontend`), then retry its documented dev command.
The root package does not install every workspace's dependencies.

## Freighter does not connect on localhost over HTTP

**Cause:** The wallet may reject an insecure origin, be locked, or be set to a
different Stellar network.

**Fix:** Use `http://localhost` (which supported browser wallet extensions
treat as a secure development origin), unlock Freighter, and select the same
network configured by the app (`NEXT_PUBLIC_STELLAR_NETWORK`). For another
hostname, use a local HTTPS setup. Reload the page after changing wallet
network or app configuration. See the [Frontend Public Configuration Reference](DEPLOYMENT.md#frontend-public-configuration-reference)
for setting up your frontend environment.

## `soroban: command not found`

**Cause:** The old `soroban` executable may not be installed; current Stellar
tooling uses the `stellar` command.

**Fix:** Install the Stellar CLI using the official Stellar CLI instructions,
then verify with `stellar --version`. Use `stellar contract build` and
`stellar contract invoke` for Soroban operations.

## Migration fails with `relation already exists`

**Cause:** The database has objects created outside the migration runner, or
the migration was partially applied.

**Fix:** Check migration status and inspect the named table/index before
changing anything. Prefer the project's migration status/up commands to
manually rerun SQL. For a disposable local database, recreate it and apply all
migrations from the beginning. Never drop production data to resolve this
error.

## `cargo test` fails due to `overflow-checks` in the test profile

**Cause:** The contract enables overflow checks in release builds, while a
test helper or fixture may rely on arithmetic that wraps in debug mode.

**Fix:** Treat the failure as an arithmetic bug first: use checked arithmetic
or correct the fixture's value. Do not disable overflow checks as a workaround;
the contract must remain safe under checked arithmetic. Include the failing
operation and input when reporting an unresolved case.

## Vault state: paused, capacity, or unknown capacity

Use this section when the dashboard banner, the capacity bar, or a deposit
error suggests that a vault is unavailable. The three states have different
causes and different next steps.

### Paused

**Dashboard:** amber banner "⚠️ Vault operations are currently paused.
Withdrawals remain available." and a disabled **Vault Paused** button.
**Contract:** `is_paused()` returns `true`; mutating calls fail with error 11
(`VaultPaused`).

While paused, deposits, harvests, normal withdrawals, and queued-withdrawal
claims revert. Read-only views still work, and `emergency_withdraw(caller,
shares)` remains callable as the exit path (no fee, no queue, only while
paused). Wait for an admin/GUARDIAN to call `unpause`; do not keep retrying
deposits. The normal Withdraw button is disabled during a pause — the exit
path is `emergency_withdraw` or an admin `unpause`.

### Capacity limit reached

**Dashboard:** red capacity bar reading `Vault Capacity: 100.0% full` with
`Remaining 0.00`; deposits fail with error 16 (`TvlCapExceeded`). At 80–95%
the bar is amber and deposits still work.

Check `get_tvl_caps()` / `get_tvl_cap()`, then deposit only up to the
remaining capacity or withdraw to free capacity. Only an admin can raise or
remove the cap.

### Capacity information unavailable

**Dashboard:** the capacity section is missing entirely, or the dashboard
shows `Failed to load vault data` with a `Retry` button. This means the stats
request failed or returned no `tvl_cap`; note that `tvl_cap: null` can also
mean that no cap is configured.

Check `GET /api/v1/vault/stats` (including the `X-Cache` header), then query
`get_tvl_caps()` directly. Deposits and withdrawals still follow the on-chain
state, so the dashboard being unavailable does not by itself mean the vault is
paused or full.

See [SUPPORT_FAQ.md](../SUPPORT_FAQ.md#vault-states-paused-capacity-limited-and-unknown-capacity)
for example dashboard messages, the actions that remain available in each
state, and the information to include when escalating.

## Still stuck?

Capture the exact command, package directory, toolchain versions, and the
complete error output. Remove tokens, private keys, and passwords before
sharing logs. See also [Getting Started](getting-started.md) and the
[development setup guide](../DEVELOPMENT_SETUP.md).
