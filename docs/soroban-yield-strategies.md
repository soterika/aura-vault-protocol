# Soroban Yield Strategies

AuraVault can keep assets idle (the default) or forward them to one active
strategy implementing the `YieldStrategy` contract interface:

- `deposit(amount)` invests underlying tokens already transferred by AuraVault.
- `withdraw(amount)` returns at least the requested amount of underlying tokens.
- `total_assets()` reports the current underlying value held by the strategy.

Use `propose_strategy_update` and the normal signer voting flow to change the
strategy. `execute` validates the interface before applying the approved
address. Strategy accounting participates in the vault's balance reconciliation
and withdrawals request liquidity from the strategy when the vault's liquid
balance is insufficient. Strategy replacement currently requires an empty
vault and empty old strategy so existing positions are never silently moved or
abandoned. With no active strategy, existing idle-token behavior is preserved.
