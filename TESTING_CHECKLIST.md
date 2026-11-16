# Aura Vault - Testing Checklist

## Pre-Integration Testing

### Contract Deployment
- [ ] Build WASM: `cargo build --target wasm32-unknown-unknown --release`
- [ ] Generated binary at: `target/wasm32-unknown-unknown/release/aura_vault.wasm`
- [ ] Run contract unit tests: `cargo test`
- [ ] All 22 tests passing

### Network Selection
- [ ] Testnet credentials prepared
- [ ] Testnet tokens funded (XLM + test tokens)
- [ ] Contract uploaded to testnet
- [ ] Contract ID noted and verified

---

## Functional Testing

### 1. Initialization Test

```bash
# Initialize vault
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_KEYPAIR> \
  --network testnet \
  -- initialize \
  --admin <ADMIN_ADDRESS> \
  --underlying_token <TOKEN_CONTRACT_ID>
```

**Verification**:
- [ ] TX succeeds with no errors
- [ ] TX hash recorded
- [ ] Cannot initialize twice (verify AlreadyInitialized error)

### 2. Deposit Test - First Depositor (1:1 Ratio)

```bash
# First deposit should get 1:1 share ratio
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <USER1_KEYPAIR> \
  --network testnet \
  -- deposit \
  --caller <USER1_ADDRESS> \
  --amount 1000000
```

**Verification**:
- [ ] TX succeeds
- [ ] Shares returned = 1000000 (1:1 ratio)
- [ ] `balance_of(USER1)` returns 1000000
- [ ] `total_assets()` returns 1000000

### 3. Deposit Test - Second Depositor (Pro-rata)

```bash
# Second deposit: 2M tokens, should mint floor(2M * 1M / 1M) = 2M shares
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <USER2_KEYPAIR> \
  --network testnet \
  -- deposit \
  --caller <USER2_ADDRESS> \
  --amount 2000000
```

**Verification**:
- [ ] TX succeeds
- [ ] Shares returned = 2000000
- [ ] `balance_of(USER2)` returns 2000000
- [ ] `total_assets()` returns 3000000 (1M + 2M)
- [ ] `total_shares()` returns 3000000

### 4. Harvest Test (Increase Exchange Rate)

```bash
# Inject 300k yield without minting shares
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <KEEPER_KEYPAIR> \
  --network testnet \
  -- harvest \
  --caller <KEEPER_ADDRESS> \
  --yield_amount 300000
```

**Verification**:
- [ ] TX succeeds
- [ ] `total_assets()` returns 3300000 (3M + 300k yield)
- [ ] `total_shares()` still 3000000 (no new shares minted)
- [ ] Exchange rate increased: 3.3M / 3M = 1.1

### 5. Withdraw Test - Partial Withdrawal

User has 1M shares after first deposit. Withdraw 500k shares:
- Expected redemption: floor(500k * 3.3M / 3M) = floor(550k) = 550k tokens

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <USER1_KEYPAIR> \
  --network testnet \
  -- withdraw \
  --caller <USER1_ADDRESS> \
  --shares 500000
```

**Verification**:
- [ ] TX succeeds
- [ ] Tokens returned = 550000
- [ ] `balance_of(USER1)` returns 500000 (1M - 500k)
- [ ] `total_assets()` returns 2750000 (3.3M - 550k)
- [ ] `total_shares()` returns 2500000 (3M - 500k)

### 6. Withdraw Test - Full Withdrawal

User has 500k shares. Withdraw all:
- Expected redemption: floor(500k * 2.75M / 2.5M) = floor(550k) = 550k tokens

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <USER1_KEYPAIR> \
  --network testnet \
  -- withdraw \
  --caller <USER1_ADDRESS> \
  --shares 500000
```

**Verification**:
- [ ] TX succeeds
- [ ] `balance_of(USER1)` returns 0
- [ ] User receives 550k tokens
- [ ] `total_assets()` returns 2200000 (2.75M - 550k)

---

## Error Handling Tests

### Error 1: NotInitialized
Try to deposit before initialize:

```bash
stellar contract invoke \
  --id <NEW_CONTRACT_ID> \
  --source <USER_KEYPAIR> \
  --network testnet \
  -- deposit \
  --caller <USER_ADDRESS> \
  --amount 1000000
```

**Verification**:
- [ ] Error code 1 returned
- [ ] No state changes

### Error 2: AlreadyInitialized
Call initialize twice:

```bash
# First call succeeds
stellar contract invoke --id <CONTRACT_ID> ... -- initialize ...

# Second call fails
stellar contract invoke --id <CONTRACT_ID> ... -- initialize ...
```

**Verification**:
- [ ] Second call returns error 2

### Error 3: InsufficientShares
Try to withdraw more shares than owned:

```bash
# User has 100k shares
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <USER_KEYPAIR> \
  --network testnet \
  -- withdraw \
  --caller <USER_ADDRESS> \
  --shares 200000  # More than owned
```

**Verification**:
- [ ] Error code 3 returned
- [ ] No state changes

### Error 4: ZeroAmount
Deposit zero or negative:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <USER_KEYPAIR> \
  --network testnet \
  -- deposit \
  --caller <USER_ADDRESS> \
  --amount 0
```

**Verification**:
- [ ] Error code 5 returned

### Error 5: MathOverflow
Deposit with extremely large numbers:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <USER_KEYPAIR> \
  --network testnet \
  -- deposit \
  --caller <USER_ADDRESS> \
  --amount 999999999999999999  # i128::MAX
```

**Verification**:
- [ ] Error code 6 returned (if it overflows)

### Error 8: ZeroShares
Harvest when no deposits exist:

```bash
# On new vault with no deposits
stellar contract invoke \
  --id <EMPTY_CONTRACT_ID> \
  --source <KEEPER_KEYPAIR> \
  --network testnet \
  -- harvest \
  --caller <KEEPER_ADDRESS> \
  --yield_amount 1000
```

**Verification**:
- [ ] Error code 8 returned

---

## Integration Testing

### Test Case 1: Multi-user Scenario

**Setup**: 3 users deposit over time

```bash
# User 1: Deposit 1M tokens
# Expected: 1M shares, exchange rate 1.0

# User 2: Deposit 2M tokens
# Expected: 2M shares, exchange rate 1.0

# Harvest 300k
# Expected: exchange rate becomes 1.1

# User 3: Deposit 3M tokens
# Expected: floor(3M * 3M / 3.3M) ≈ 2.727M shares

# User 1 withdraws 1M shares
# Expected: floor(1M * 3.3M / 5.727M) ≈ 576k tokens
```

**Test Code**:

```python
def test_multi_user_scenario():
    vault = AuraVaultClient('CABC...')
    
    # User 1 deposit
    shares_1 = vault.deposit(user1, 1_000_000)
    assert shares_1 == 1_000_000
    
    # User 2 deposit
    shares_2 = vault.deposit(user2, 2_000_000)
    assert shares_2 == 2_000_000
    
    # Harvest
    vault.harvest(keeper, 300_000)
    total = vault.get_total_assets()
    assert total == 3_300_000
    
    # User 3 deposit
    shares_3 = vault.deposit(user3, 3_000_000)
    assert shares_3 == 2_727_272  # floor(3M * 3M / 3.3M)
    
    # User 1 withdraw
    tokens = vault.withdraw(user1, 1_000_000)
    assert tokens == 576923  # floor(1M * 3.3M / 5.727M)
```

### Test Case 2: Rounding Validation

Verify floor division throughout:

```python
def test_rounding():
    vault = AuraVaultClient('CABC...')
    
    # Deposit that results in rounding
    vault.deposit(user1, 1_000_000)
    vault.harvest(keeper, 1)  # Add 1 wei of yield
    
    # Deposit 333k tokens
    # Shares = floor(333k * 1M / 1M) = 333k
    shares = vault.deposit(user2, 333_333)
    assert shares == 333_333
```

---

## Performance & Load Testing

### Test: High Frequency Deposits

```python
def test_high_frequency():
    vault = AuraVaultClient('CABC...')
    
    for i in range(100):
        shares = vault.deposit(users[i], 10_000 + i)
        assert shares > 0
        
    total = vault.get_total_assets()
    assert total == sum(10_000 + i for i in range(100))
```

**Success Criteria**:
- [ ] All 100 deposits succeed
- [ ] No timeouts
- [ ] Final state matches expectations

### Test: Harvest Performance

```python
def test_harvest_performance():
    vault = AuraVaultClient('CABC...')
    
    vault.deposit(user1, 10_000_000)
    
    # 1000 harvests
    for i in range(1000):
        vault.harvest(keeper, 1000 + i)
    
    total = vault.get_total_assets()
    assert total == 10_000_000 + sum(1000 + i for i in range(1000))
```

**Success Criteria**:
- [ ] All harvests succeed
- [ ] Total assets calculated correctly
- [ ] No overflow errors

---

## Security Testing

### Test: Authorization Checks

```python
def test_auth_required():
    vault = AuraVaultClient('CABC...')
    
    # Try to deposit without auth from caller
    # This should fail at Soroban level
    try:
        result = vault.deposit(user2, 1_000_000)
        assert False, "Should have failed auth check"
    except Exception as e:
        assert "auth" in str(e).lower()
```

### Test: Reentrancy Prevention

The contract uses CEI (Checks-Effects-Interactions) pattern:
- [ ] Effects (state changes) happen before interactions (token transfers)
- [ ] Verified in contract code review

---

## Mainnet Readiness Checklist

Before deploying to mainnet:

- [ ] All tests passing on testnet
- [ ] No remaining error logs
- [ ] Contract code reviewed by 2+ developers
- [ ] Security audit completed (if applicable)
- [ ] Upgrade path tested (if applicable)
- [ ] Admin key management documented
- [ ] Emergency pause procedure established
- [ ] Monitoring/alerting configured
- [ ] Liquidity provider onboarded
- [ ] User documentation finalized
- [ ] Support team trained

---

## Regression Testing Template

After any code changes:

```bash
# 1. Rebuild and test
cargo test

# 2. Deploy to testnet
stellar contract upload --wasm ...
stellar contract deploy --wasm-hash ...

# 3. Run full test suite
python test_suite.py

# 4. Manual spot checks
# - Initialize new vault
# - Deposit from 3 users
# - Harvest
# - Withdraw
# - Check balances

# 5. Verify no state corruption
python verify_invariants.py
```

---

## Test Execution Log Template

Use this to document test runs:

```
Date: 2024-06-25
Tester: Your Name
Network: testnet
Contract ID: CABC...

[ ] Initialization
    Status: PASS / FAIL
    TX Hash: abc123...
    Notes: 

[ ] Deposit (1:1)
    Status: PASS / FAIL
    Shares: 1000000
    Notes:

[ ] Deposit (pro-rata)
    Status: PASS / FAIL
    Shares: 2000000
    Notes:

[ ] Harvest
    Status: PASS / FAIL
    Exchange Rate: 1.1x
    Notes:

[ ] Withdraw
    Status: PASS / FAIL
    Tokens: 550000
    Notes:

[ ] Error handling
    Status: PASS / FAIL
    Notes:

Overall: PASS / FAIL
Issues: None / See notes above
Sign-off: ________________
```
