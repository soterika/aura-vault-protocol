# Aura Vault - Fuzz Testing Quick Start

## Running Fuzz Tests Locally

### Prerequisites

```bash
rustup default stable
rustup target add wasm32-unknown-unknown
cd aura-vault
```

### Quick Test (100 cases)

```bash
PROPTEST_PROFILE=quick cargo test --lib fuzz
```

**Expected Output**:
```
test fuzz::prop_first_deposit_one_to_one ... ok
test fuzz::prop_deposit_withdraw_no_gain ... ok
test fuzz::prop_total_shares_consistency ... ok
test fuzz::prop_cannot_overdraw ... ok
test fuzz::prop_zero_amount_rejected ... ok
test fuzz::prop_harvest_improves_exchange_rate ... ok
test fuzz::prop_no_overflow ... ok
test invariants::invariant_assets_cover_shares ... ok
test invariants::invariant_balance_non_negative ... ok
test invariants::invariant_version_exists ... ok
test invariants::invariant_must_initialize ... ok

test result: ok. 11 passed
```

**Duration**: ~5 seconds

### Full Test (1,000+ cases per property)

```bash
cargo test --lib fuzz
```

**Environment**:
```bash
PROPTEST_CASES=1000 \
PROPTEST_MAX_SHRINK_ITERS=100000 \
cargo test --lib fuzz -- --nocapture --test-threads=1
```

**Expected Output**:
```
test fuzz::prop_first_deposit_one_to_one ... ok
test fuzz::prop_deposit_withdraw_no_gain ... ok
test fuzz::prop_total_shares_consistency ... ok
test fuzz::prop_cannot_overdraw ... ok
test fuzz::prop_zero_amount_rejected ... ok
test fuzz::prop_harvest_improves_exchange_rate ... ok
test fuzz::prop_no_overflow ... ok
test invariants::invariant_assets_cover_shares ... ok
test invariants::invariant_balance_non_negative ... ok
test invariants::invariant_version_exists ... ok
test invariants::invariant_must_initialize ... ok

test result: ok. 11 passed in 45.2s
```

**Duration**: ~45 seconds

### Intensive Test (10,000 cases)

```bash
PROPTEST_CASES=10000 cargo test --lib fuzz
```

**Duration**: ~5 minutes

### Run Specific Property

```bash
# Test only first deposit property
cargo test --lib prop_first_deposit_one_to_one

# Test only invariants
cargo test --lib invariant
```

### With Verbose Output

```bash
cargo test --lib fuzz -- --nocapture
```

Shows all generated test cases and detailed failure messages.

### Reproduce Failed Case

If a test fails with seed, reproduce with:

```bash
PROPTEST_SEED=0x1234567890abcdef cargo test --lib prop_first_deposit_one_to_one
```

---

## CI/CD Pipeline

Fuzz tests run automatically via GitHub Actions:

### Workflow Triggers

```yaml
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM UTC
```

### View Results

1. Go to **GitHub Repository**
2. Click **Actions** tab
3. Select **"Fuzz Testing"** workflow
4. View latest run

### CI/CD Configuration

File: `.github/workflows/fuzz-test.yml`

```yaml
- name: Run property tests (1000+ transactions)
  run: PROPTEST_CASES=1000 cargo test --lib fuzz
  
- name: Run invariant checks
  run: cargo test --lib invariants
```

---

## Understanding Test Failures

### Example: Property Failure

```
thread 'fuzz::prop_deposit_withdraw_no_gain' panicked at '
assertion failed: redeemed <= amount

Seed: 0x1234567890abcdef
Input: amount = 999999999999999999
Shrunk to: amount = 1000000
```

**Debug Steps**:

1. **Reproduce**:
   ```bash
   PROPTEST_SEED=0x1234567890abcdef cargo test --lib prop_deposit_withdraw_no_gain
   ```

2. **Understand**: Run with verbose output
   ```bash
   cargo test --lib prop_deposit_withdraw_no_gain -- --nocapture
   ```

3. **Fix**: Modify contract code and re-test
   ```bash
   cargo test --lib prop_deposit_withdraw_no_gain
   ```

4. **Verify**: Re-run with same seed to confirm fix
   ```bash
   PROPTEST_SEED=0x1234567890abcdef cargo test --lib prop_deposit_withdraw_no_gain
   ```

### Regression Testing

Failed cases are saved in `.proptest-regressions/`:

```bash
# View regression cases
ls -la .proptest-regressions/

# Re-test regressions automatically
cargo test --lib fuzz
```

---

## Performance Tuning

### Faster Tests

```bash
# Use quick profile (100 cases)
PROPTEST_PROFILE=quick cargo test --lib fuzz
```

### More Thorough

```bash
# Increase cases
PROPTEST_CASES=50000 cargo test --lib fuzz
```

### Parallel Testing

```bash
# Default: sequential (deterministic)
cargo test --lib fuzz -- --test-threads=1

# Parallel (faster but non-deterministic)
cargo test --lib fuzz
```

---

## Coverage Analysis

Generate code coverage for fuzz tests:

```bash
# Install tarpaulin
cargo install cargo-tarpaulin

# Generate coverage
cargo tarpaulin --lib --out Html --output-dir coverage

# View report
open coverage/index.html
```

**Target Coverage**: >90%

---

## Files Modified

### New Files Added

1. **src/fuzz.rs** - Proptest property tests and invariants
2. **proptest.toml** - Fuzzing configuration
3. **.github/workflows/fuzz-test.yml** - CI/CD workflow
4. **FUZZING_STRATEGY.md** - Detailed strategy documentation
5. **FUZZ_FINDINGS.md** - Test results and findings
6. **FUZZ_TEST_GUIDE.md** - This file

### Modified Files

1. **src/lib.rs** - Added fuzz module import

---

## Continuous Integration

### Automatic Execution

- ✅ Every push to main/develop
- ✅ Every pull request
- ✅ Daily at 2 AM UTC
- ✅ Manual trigger via GitHub UI

### Acceptance Criteria

Each run must satisfy:
- [ ] 1,000+ transactions per property
- [ ] All 7 properties pass
- [ ] All 4 invariants hold
- [ ] Zero panics or overflows
- [ ] Coverage ≥ 80%

### Viewing Logs

```bash
# View GitHub Actions logs
gh run view <RUN_ID> --log

# Download artifacts
gh run download <RUN_ID> -n coverage-report
```

---

## Troubleshooting

### Test Timeout

```bash
# Increase timeout
PROPTEST_TIMEOUT=600000 cargo test --lib fuzz
```

### Out of Memory

```bash
# Reduce cases
PROPTEST_CASES=100 cargo test --lib fuzz
```

### Cache Issues

```bash
# Clean and rebuild
cargo clean
cargo test --lib fuzz
```

### Regression Files Corrupt

```bash
# Remove and re-generate
rm -rf .proptest-regressions/
cargo test --lib fuzz
```

---

## Support

Questions about fuzz testing?

- **Documentation**: See FUZZING_STRATEGY.md
- **Issues**: github.com/aura-vault/aura-vault-protocol/issues
- **Email**: fuzzing-support@aura-vault.dev

---

## Quick Reference Commands

| Command | Purpose |
|---------|---------|
| `cargo test --lib fuzz` | Run all 1,000+ case fuzz tests |
| `PROPTEST_PROFILE=quick cargo test --lib fuzz` | Quick 100-case test |
| `PROPTEST_CASES=10000 cargo test --lib fuzz` | Intensive 10k case test |
| `cargo test --lib invariant` | Run invariants only |
| `PROPTEST_SEED=0x... cargo test --lib prop_X` | Reproduce specific case |
| `cargo test --lib fuzz -- --nocapture` | Show verbose output |
| `cargo tarpaulin --lib --out Html` | Generate coverage report |

---

**Status**: ✅ Ready for use  
**Last Updated**: 2024-06-25
