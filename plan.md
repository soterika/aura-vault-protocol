# Aura Vault Protocol — Wave Contribution Plan

## About the Project

Aura is a share-based yield vault smart contract built on Soroban for the Stellar ecosystem. It aggregates deposits of a single SEP-41 token, issues proportional vault shares, and auto-compounds yield through permissionless keeper harvests. The contract is written in Rust (`no_std`), targets `wasm32-unknown-unknown`, and is designed to be a trust-minimized DeFi primitive on Stellar mainnet.

---

## How We Use the Wave Program

We post scoped, self-contained issues that contributors can pick up independently during sprint cycles. Each issue includes a clear description, acceptance criteria, relevant file references, and a difficulty label. Contributors are not expected to understand the entire codebase — each issue is bounded to a specific module or concern.

---

## Types of Work We Post

### Bug Fixes
Soroban's execution environment has subtle edge cases around integer arithmetic, storage TTL expiry, and token transfer ordering. We post issues for:
- Rounding edge cases in share minting or redemption that violate the ±1 invariant
- CEI ordering violations discovered during audit
- Off-by-one errors in TTL threshold constants
- Error variant mismatches between the interface spec and implementation

### New Features
The v1 vault is intentionally minimal. Planned extensions we'll issue as Wave tasks:
- **Admin transfer** — allow the current admin to nominate a successor with a two-step accept pattern
- **Emergency pause** — admin-gated halt on deposits and harvests, withdrawals always remain open
- **Multi-asset support** — extend `DataKey` and share accounting to support a second underlying token
- **Keeper whitelist** — optional admin-controlled list of approved harvest callers
- **On-chain exchange rate view** — `exchange_rate(env) -> i128` read-only function returning `total_assets * 1_000_000 / total_shares`

### Testing
Property-based and integration test coverage is an ongoing priority:
- Additional `proptest` strategies covering extreme `i128` boundary values
- Fuzz targets for `deposit` and `withdraw` input combinations
- Multi-transaction sequence tests simulating realistic depositor behaviour
- TTL archival simulation tests — verify correct behaviour when a `Balance` entry is near expiry

### Documentation
- Inline `///` doc comments on all public functions and error variants
- A `SECURITY.md` describing the CEI pattern, inflation-attack mitigation, and overflow strategy
- A `CONTRIBUTING.md` with local setup instructions, build commands, and issue workflow
- Annotated worked examples for the share minting and redemption formulas

### Code Quality and Tooling
- `#[deny(clippy::all)]` pass — resolve all clippy lints in production code paths
- CI workflow (GitHub Actions) running `cargo test` and `cargo clippy` on every PR
- Wasm size audit — verify the compiled binary stays under the Soroban code size limit
- Benchmark harness for instruction count per function using the Soroban cost model

---

## Issue Labels We Use

| Label | Meaning |
|---|---|
| `good-first-issue` | Self-contained, well-scoped, no deep context required |
| `bug` | Confirmed incorrect behaviour with a reproduction case |
| `feature` | New functionality with a clear acceptance spec |
| `test` | Test coverage gap with a defined property to verify |
| `docs` | Documentation improvement with no code changes required |
| `security` | Audit finding or hardening task — requires careful review |

---

## Contribution Scope

All Wave issues will be scoped to a single file or a single logical concern. No issue will require understanding the full contract. Each issue will reference the relevant requirement or design property from the spec so contributors have the full context they need to deliver correct, verifiable work.
