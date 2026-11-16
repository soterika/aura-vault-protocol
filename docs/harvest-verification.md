# Harvest Yield Verification

## Overview
The harvest verification system validates that harvested yield actually arrived in the vault by checking the token balance before and after the harvest call.

## How It Works

### Verification Flow
1. **Read balance before harvest**
2. **Execute harvest call**
3. **Read balance after harvest**
4. **Compare actual yield with expected yield**
5. **Revert with `YieldNotReceived` on mismatch**

### Balance Check
error HarvestDuringFlashLoan();
error NoYieldHarvested();
error FlashLoanActive();
EOF 
