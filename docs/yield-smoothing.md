# Yield Smoothing

## Overview
Yield smoothing distributes harvested yield linearly over a configurable period to prevent share price volatility.

## How It Works

### Yield Drip Mechanism
1. **Yield is harvested** and stored as pending yield
2. **Yield drips linearly** over the drip period (default 6 hours)
3. **Each call to mutating functions** triggers a drip
4. **Full yield is applied** if vault is paused

### Drip Rate Calculation
function pauseYield() external onlyOwner
function unpauseYield() external onlyOwner
