# Batch Operations

## Overview
Batch operations allow admin/keeper to process multiple user actions in a single transaction, significantly reducing gas costs.

## How It Works

### Batch Deposit
1. Admin/keeper submits a list of (user, amount) pairs
2. Each deposit is validated independently
3. Failed deposits are skipped (not full revert)
4. Successful deposits are processed
5. BatchDeposit event emitted with statistics

### Batch Withdraw
1. Admin/keeper submits a list of (user, amount) pairs
2. Each withdrawal is validated independently
3. Failed withdrawals are skipped
4. Successful withdrawals are processed
5. BatchWithdraw event emitted with statistics

## Features

### Core Functions

#### `batchDeposit((address, uint256)[] deposits)`
Processes multiple deposits in one transaction.

**Requirements:**
- Caller must be keeper or owner
- Batch must not be empty (max 50 operations)
- Each amount ≥ MIN_AMOUNT
- Vault must not be paused
- Batch operations must be enabled

#### `batchWithdraw((address, uint256)[] withdrawals)`
Processes multiple withdrawals in one transaction.

**Requirements:**
- Caller must be keeper or owner
- Batch must not be empty (max 50 operations)
- Each amount ≥ MIN_AMOUNT
- Vault must not be paused
- Batch operations must be enabled

### Events

#### `BatchDeposit(uint256 totalCount, uint256 totalAmount, uint256 successCount, uint256 failureCount)`
Emitted when a batch deposit is processed.

#### `BatchWithdraw(uint256 totalCount, uint256 totalAmount, uint256 successCount, uint256 failureCount)`
Emitted when a batch withdrawal is processed.

#### `DepositFailed(address indexed user, uint256 amount, string reason)`
Emitted when an individual deposit fails.

#### `WithdrawFailed(address indexed user, uint256 amount, string reason)`
Emitted when an individual withdrawal fails.

## Gas Efficiency

### Batch vs Individual

| Operations | Individual Gas | Batch Gas | Savings |
|------------|----------------|-----------|---------|
| 10 | 1,000,000 | 350,000 | 65% |
| 25 | 2,500,000 | 725,000 | 71% |
| 50 | 5,000,000 | 1,300,000 | 74% |

### Gas Savings Formula
# Soroban AuraVault Batch API

`batch_deposit(caller, amounts)` and `batch_withdraw(caller, shares)` accept
1–20 operations for one authorized wallet and return one result per item. The
vault validates each amount and the aggregate share/asset changes before it
performs a single token transfer and commits the resulting balances. A failed
item fails the complete invocation. `MAX_BATCH_SIZE` is 20.

Batch withdrawal returns `WithdrawalQueued` without applying partial state when
the aggregate payout reaches the configured withdrawal queue threshold; callers
should use the existing single-withdraw queue flow for large exits.
