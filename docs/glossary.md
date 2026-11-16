# Aura Vault Protocol — DeFi & Stellar/Soroban Glossary

A plain-language reference for contributors, integrators, and users of the Aura Vault Protocol. Terms are grouped by subject area and listed alphabetically within each section.

---

## Table of Contents

### Category 1: DeFi Basics
- [APR (Annual Percentage Rate)](#apr-annual-percentage-rate)
- [APY (Annual Percentage Yield)](#apy-annual-percentage-yield)
- [Basis Points (bps)](#basis-points-bps)
- [Collateralization](#collateralization)
- [Compounding](#compounding)
- [Exchange Rate](#exchange-rate)
- [Flash Loan](#flash-loan)
- [Governance Token](#governance-token)
- [Harvest](#harvest)
- [Impermanent Loss](#impermanent-loss)
- [Inflation Attack](#inflation-attack)
- [Keeper](#keeper)
- [Liquidation](#liquidation)
- [Liquidity Pool](#liquidity-pool)
- [MEV (Maximal Extractable Value)](#mev-maximal-extractable-value)
- [Multi-sig (Multi-signature)](#multi-sig-multi-signature)
- [Over-collateralization](#over-collateralization)
- [Performance Fee](#performance-fee)
- [Proposal](#proposal)
- [Protocol Fee](#protocol-fee)
- [Quorum](#quorum)
- [Reentrancy](#reentrancy)
- [Rounding Attack](#rounding-attack)
- [Sandwich Attack](#sandwich-attack)
- [Share Token](#share-token)
- [Slippage](#slippage)
- [Smart Contract Audit](#smart-contract-audit)
- [Timelock](#timelock)
- [TVL (Total Value Locked)](#tvl-total-value-locked)
- [Vault](#vault)
- [Yield Farming](#yield-farming)

### Category 2: Stellar / Soroban Specific
- [Archival (State Archival)](#archival-state-archival)
- [Base Fee](#base-fee)
- [Contract ID](#contract-id)
- [Contract Instance](#contract-instance)
- [Contract Storage](#contract-storage)
- [Fee Bump Transaction](#fee-bump-transaction)
- [Footprint](#footprint)
- [Horizon](#horizon)
- [Instance Storage](#instance-storage)
- [Ledger](#ledger)
- [Ledger Close](#ledger-close)
- [Lumens (XLM)](#lumens-xlm)
- [Mainnet](#mainnet)
- [Network Passphrase](#network-passphrase)
- [Operation](#operation)
- [Persistent Storage](#persistent-storage)
- [Resource Limits](#resource-limits)
- [RPC Node](#rpc-node)
- [SEP-41](#sep-41)
- [Sequence Number](#sequence-number)
- [Soroban](#soroban)
- [State Expiry](#state-expiry)
- [Stellar](#stellar)
- [Stellar Asset Contract (SAC)](#stellar-asset-contract-sac)
- [Stroop](#stroop)
- [Temporary Storage](#temporary-storage)
- [Testnet](#testnet)
- [Transaction](#transaction)
- [TTL (Time-to-Live)](#ttl-time-to-live)
- [WASM](#wasm)

### Category 3: Aura-Specific Terms
- [AlreadyVoted](#alreadyvoted)
- [AuraVault](#auravault)
- [balance_of()](#balance_of)
- [BalanceMismatch](#balancemismatch)
- [Blameless Post-mortem](#blameless-post-mortem)
- [CEI Pattern](#cei-pattern)
- [deposit()](#deposit)
- [First Depositor](#first-depositor)
- [Flash Loan Guard](#flash-loan-guard)
- [harvest()](#harvest-1)
- [initialize()](#initialize)
- [is_paused()](#is_paused)
- [MathOverflow](#mathoverflow)
- [NotApproved](#notapproved)
- [pause()](#pause)
- [Seed Ratio](#seed-ratio)
- [Share Ratio](#share-ratio)
- [StorageLayoutMismatch](#storagelayoutmismatch)
- [TimelockNotExpired](#timelocknotexpired)
- [total_assets() (function)](#total_assets-function)
- [Total Assets (state)](#total-assets-state)
- [Total Shares](#total-shares)
- [Underlying Token](#underlying-token)
- [unpause()](#unpause)
- [UpgradeUnauthorized](#upgradeunauthorized)
- [Vault Share](#vault-share)
- [VaultError](#vaulterror)
- [VaultPaused](#vaultpaused)
- [withdraw()](#withdraw)
- [ZeroShares](#zeroshares)

---

## Category 1: DeFi Basics

### APR (Annual Percentage Rate)
The simple yearly interest rate on a deposit or loan, calculated without factoring in compounding. A vault earning 1% per month has an APR of 12%, regardless of how often that interest is reinvested. Compare with APY, which accounts for the effect of compounding.

*See also:* [APY (Annual Percentage Yield)](#apy-annual-percentage-yield), [Compounding](#compounding)

---

### APY (Annual Percentage Yield)
The effective yearly return on a deposit after accounting for how often earnings are reinvested (compounded). Because Aura automatically reinvests harvested yield, the APY will always be higher than the raw APR for the same underlying rate. A higher compounding frequency increases the gap between APR and APY.

*See also:* [APR (Annual Percentage Rate)](#apr-annual-percentage-rate), [Compounding](#compounding), [Harvest](#harvest)

---

### Basis Points (bps)
A unit equal to one one-hundredth of one percent (0.01%). Fees in DeFi are often expressed in basis points to avoid decimal ambiguity — for example, a 30 bps fee is 0.30%. Aura's protocol and performance fees are configured in basis points internally.

*See also:* [Protocol Fee](#protocol-fee), [Performance Fee](#performance-fee)

---

### Collateralization
The practice of locking up an asset as security before borrowing or issuing another asset. The locked asset (collateral) can be seized if the borrower fails to repay. Collateralization ratios determine how much can be borrowed relative to the collateral's value.

*See also:* [Over-collateralization](#over-collateralization), [Liquidation](#liquidation)

---

### Compounding
The process of reinvesting earned returns so that future returns are calculated on a larger base. In Aura, yield injected during a harvest increases `total_assets` without changing `total_shares`, so each existing share automatically becomes worth more — this is compounding in action. Over time, compounding produces exponential rather than linear growth.

*See also:* [Harvest](#harvest), [APY (Annual Percentage Yield)](#apy-annual-percentage-yield), [Exchange Rate](#exchange-rate)

---

### Exchange Rate
The ratio of the total underlying assets in a vault to the total number of outstanding shares. As yield is harvested and compounded, the exchange rate rises, meaning each share can be redeemed for more underlying tokens than when it was originally minted. In Aura the rate is implicitly `total_assets / total_shares`.

*See also:* [Total Assets (state)](#total-assets-state), [Total Shares](#total-shares), [Vault Share](#vault-share)

---

### Flash Loan
A loan that must be borrowed and repaid within the same transaction. Because no time passes between borrow and repay, the lender takes no credit risk. Flash loans can be used legitimately for arbitrage or liquidations, but they can also be weaponized to manipulate on-chain price calculations within a single transaction.

*See also:* [Flash Loan Guard](#flash-loan-guard), [BalanceMismatch](#balancemismatch)

---

### Governance Token
A special token that grants its holder the right to vote on changes to a protocol — such as adjusting fees, upgrading contracts, or modifying risk parameters. Voting power is usually proportional to how many governance tokens a wallet holds or has staked.

*See also:* [Proposal](#proposal), [Quorum](#quorum), [Multi-sig (Multi-signature)](#multi-sig-multi-signature)

---

### Harvest
The act of collecting accumulated yield and depositing it back into the vault so that all shareholders benefit. In Aura, any external caller (a "keeper") may trigger a harvest by calling `harvest()`, which adds tokens to the vault without minting new shares, thereby raising the share price for everyone. Because anyone can call it, no single party controls when compounding happens.

*See also:* [Keeper](#keeper), [harvest()](#harvest-1), [Compounding](#compounding)

---

### Impermanent Loss
A temporary reduction in the dollar value of assets deposited into a two-sided liquidity pool compared to simply holding those assets. It occurs because the pool's rebalancing algorithm forces more of the falling asset to be held as prices diverge. Aura is a single-asset vault, so impermanent loss does not apply — users are only exposed to the underlying token's price movement.

*See also:* [Liquidity Pool](#liquidity-pool), [Vault](#vault)

---

### Inflation Attack
A manipulation technique where an attacker donates tokens directly to a vault (bypassing the deposit function) to artificially inflate the exchange rate before a victim deposits. The inflated rate causes the victim's deposit to mint zero or very few shares, which the attacker can then absorb. Aura guards against this by rejecting any deposit that would mint zero shares.

*See also:* [Rounding Attack](#rounding-attack), [Flash Loan Guard](#flash-loan-guard), [ZeroShares](#zeroshares)

---

### Keeper
An external account or automated bot that calls permissionless maintenance functions on a protocol. In Aura, any wallet can act as a keeper by calling `harvest()`, injecting yield tokens into the vault. Keepers are typically incentivized by the protocol or by MEV opportunities; Aura's design requires no trusted keeper.

*See also:* [Harvest](#harvest), [harvest()](#harvest-1), [MEV (Maximal Extractable Value)](#mev-maximal-extractable-value)

---

### Liquidation
The forced sale or seizure of collateral when its value falls below a required minimum ratio. Liquidations protect lenders from borrowers defaulting. Aura itself is not a lending protocol and does not perform liquidations, but they are a core concept in the broader DeFi ecosystem that interacts with yield vaults.

*See also:* [Collateralization](#collateralization), [Over-collateralization](#over-collateralization)

---

### Liquidity Pool
A collection of tokens locked in a smart contract that allows users to trade, borrow, or earn yield without a traditional counterparty. Liquidity providers deposit pairs of tokens and receive a share of trading fees. Unlike a liquidity pool, Aura holds only a single token and focuses on yield accumulation rather than facilitating swaps.

*See also:* [Vault](#vault), [TVL (Total Value Locked)](#tvl-total-value-locked)

---

### MEV (Maximal Extractable Value)
The extra profit a block producer or validator can capture by reordering, inserting, or censoring transactions within a block. MEV strategies include front-running, back-running, and sandwich attacks. Stellar's consensus model (SCP) differs from proof-of-work chains, making some MEV strategies harder but not impossible.

*See also:* [Sandwich Attack](#sandwich-attack), [Keeper](#keeper)

---

### Multi-sig (Multi-signature)
A security arrangement that requires more than one private key to authorize a transaction or action. For example, a 2-of-3 multi-sig requires any two of three designated signers to approve. In governance contexts, multi-sig is used to ensure no single person can unilaterally upgrade or drain a protocol.

*See also:* [Governance Token](#governance-token), [Timelock](#timelock), [Proposal](#proposal)

---

### Over-collateralization
Locking up more value in collateral than the amount being borrowed or minted. A 150% collateralization ratio means $150 of collateral backs every $100 of debt, providing a buffer against price drops before liquidation is triggered. Over-collateralization is a standard safety mechanism in DeFi lending and stablecoin protocols.

*See also:* [Collateralization](#collateralization), [Liquidation](#liquidation)

---

### Performance Fee
A fee charged as a percentage of the profit generated by the vault, rather than on the total balance. For example, a 10% performance fee means the protocol takes 10 cents of every $1 of yield before distributing the rest to shareholders. This aligns protocol incentives with depositor returns.

*See also:* [Protocol Fee](#protocol-fee), [Basis Points (bps)](#basis-points-bps), [Harvest](#harvest)

---

### Proposal
A formal, on-chain request to change a protocol's configuration or code. Proposals typically go through a voting period where governance token holders cast their votes, followed by a mandatory waiting period (timelock) before the change is executed. A proposal only takes effect if it meets the required quorum and approval threshold.

*See also:* [Governance Token](#governance-token), [Quorum](#quorum), [Timelock](#timelock)

---

### Protocol Fee
A fee collected by the protocol treasury on all deposits, withdrawals, or harvests — as opposed to a performance fee that only applies to profits. Protocol fees fund ongoing development and maintenance. They are typically expressed in basis points.

*See also:* [Performance Fee](#performance-fee), [Basis Points (bps)](#basis-points-bps)

---

### Quorum
The minimum level of participation required for a governance vote to be considered valid. For example, a 20% quorum means at least 20% of all eligible voting tokens must cast a vote before the result is binding. Quorums prevent a small, active minority from passing changes that most token holders would oppose.

*See also:* [Governance Token](#governance-token), [Proposal](#proposal)

---

### Reentrancy
A type of smart contract vulnerability where a malicious contract repeatedly calls back into the victim contract before the first execution finishes, allowing it to drain funds or corrupt state. The classic defense is the Checks-Effects-Interactions (CEI) pattern, which ensures all state changes happen before any external calls are made.

*See also:* [CEI Pattern](#cei-pattern), [Smart Contract Audit](#smart-contract-audit)

---

### Rounding Attack
A type of exploit that takes advantage of integer division truncation in share calculations. Because Solidity and Soroban use integer arithmetic (no decimals), dividing one number by another always rounds down. An attacker can craft deposits and withdrawals that repeatedly exploit this rounding to extract small amounts of extra value over many transactions.

*See also:* [Inflation Attack](#inflation-attack), [MathOverflow](#mathoverflow)

---

### Sandwich Attack
A form of MEV where an attacker places one transaction immediately before and one immediately after a victim's large swap transaction. The attacker buys the asset before the victim's trade (driving the price up), lets the victim trade at the inflated price, then sells immediately after (driving the price back down), pocketing the spread at the victim's expense.

*See also:* [MEV (Maximal Extractable Value)](#mev-maximal-extractable-value), [Slippage](#slippage)

---

### Share Token
A token representing a proportional claim on the assets held in a vault or pool. When you deposit into Aura, you receive vault shares rather than a direct IOU — the shares automatically appreciate in value as yield is compounded. Redeeming (burning) shares gives back the proportional amount of underlying tokens at the current exchange rate.

*See also:* [Vault Share](#vault-share), [Exchange Rate](#exchange-rate), [Vault](#vault)

---

### Slippage
The difference between the price expected when a transaction is submitted and the price actually received when it executes. Slippage occurs because on-chain state (like pool reserves) can change between when a transaction is signed and when it is confirmed. Users typically set a maximum slippage tolerance to protect themselves.

*See also:* [Sandwich Attack](#sandwich-attack), [MEV (Maximal Extractable Value)](#mev-maximal-extractable-value)

---

### Smart Contract Audit
A thorough review of smart contract code by independent security experts, looking for bugs, logic errors, and known vulnerability patterns. Audits are not a guarantee of safety but are a standard step before deploying significant value on-chain. Audit reports are typically published publicly so users can assess the risk themselves.

*See also:* [Reentrancy](#reentrancy), [Inflation Attack](#inflation-attack)

---

### Timelock
A mandatory waiting period between when a governance action is approved and when it can actually be executed. For example, a 48-hour timelock gives users time to review an upcoming change and withdraw funds if they disagree before it takes effect. Timelocks are a key protection against malicious or rushed governance.

*See also:* [Proposal](#proposal), [Multi-sig (Multi-signature)](#multi-sig-multi-signature), [TimelockNotExpired](#timelocknotexpired)

---

### TVL (Total Value Locked)
The total market value of all tokens currently deposited in a protocol's smart contracts, expressed in a fiat currency (usually USD). TVL is the most commonly used metric for comparing the size and adoption of DeFi protocols. A rising TVL generally signals growing user trust, while a sudden drop can indicate withdrawals or a hack.

*See also:* [Vault](#vault), [Liquidity Pool](#liquidity-pool)

---

### Vault
A smart contract designed to hold tokens on behalf of depositors and grow them over time through a defined yield strategy. Depositors receive share tokens representing their ownership stake; shares appreciate as the vault earns yield. Aura is a single-asset yield vault built on Soroban.

*See also:* [Share Token](#share-token), [AuraVault](#auravault), [Yield Farming](#yield-farming)

---

### Yield Farming
The practice of actively moving tokens between DeFi protocols to maximize returns. Yield farmers chase the highest available interest rates, often using multiple protocols in combination. Vaults like Aura simplify yield farming by automating the compounding step so depositors earn optimized returns without manual intervention.

*See also:* [Vault](#vault), [Harvest](#harvest), [APY (Annual Percentage Yield)](#apy-annual-percentage-yield)

---

## Category 2: Stellar / Soroban Specific

### Archival (State Archival)
The process by which Stellar removes contract storage entries that have not been renewed past their TTL (Time-to-Live) from the active ledger state. Archived data is not deleted — it can be restored by providing a proof — but a contract trying to access archived storage will fail until the data is restored. Aura extends TTLs on every write to avoid accidental archival.

*See also:* [TTL (Time-to-Live)](#ttl-time-to-live), [State Expiry](#state-expiry), [Persistent Storage](#persistent-storage)

---

### Base Fee
The minimum fee per operation required for a transaction to be included in a Stellar ledger. The base fee is set in stroops and adjusts upward during periods of network congestion via a surge-pricing mechanism. Validators reject any transaction whose offered fee falls below the current base fee.

*See also:* [Stroop](#stroop), [Fee Bump Transaction](#fee-bump-transaction), [Operation](#operation)

---

### Contract ID
A unique 32-byte identifier assigned to a smart contract when it is first deployed on Stellar. The contract ID is derived deterministically from the deploying transaction and identifies the contract instance across all interactions. Users and other contracts use the contract ID to invoke functions on a deployed contract.

*See also:* [Contract Instance](#contract-instance), [Soroban](#soroban)

---

### Contract Instance
The on-chain deployment of a specific compiled contract binary, identified by a Contract ID. Multiple instances of the same WASM binary can exist with different Contract IDs and independent storage. Each Aura vault deployment is a separate contract instance.

*See also:* [Contract ID](#contract-id), [WASM](#wasm), [Contract Storage](#contract-storage)

---

### Contract Storage
The persistent, on-chain key-value store where a Soroban smart contract saves its state between transactions. Contract storage is split into three tiers — persistent, instance, and temporary — each with different TTL rules. Reading from or writing to storage costs fees proportional to the size and tier accessed.

*See also:* [Persistent Storage](#persistent-storage), [Instance Storage](#instance-storage), [Temporary Storage](#temporary-storage)

---

### Fee Bump Transaction
A special Stellar transaction type that wraps an existing signed transaction and provides a higher fee on its behalf. This allows a third party (such as a relayer service) to pay fees for a user whose account has insufficient XLM, or to re-submit a stuck transaction with a higher fee during congestion.

*See also:* [Base Fee](#base-fee), [Transaction](#transaction)

---

### Footprint
The declared set of ledger entries (contract storage keys, account balances, etc.) that a Soroban transaction will read from or write to during execution. Validators use the footprint to parallelize transaction processing — two transactions with non-overlapping footprints can execute simultaneously. An incorrect footprint causes a transaction to fail.

*See also:* [Resource Limits](#resource-limits), [Contract Storage](#contract-storage)

---

### Horizon
The public HTTP API server for the Stellar network, maintained by the Stellar Development Foundation. Horizon allows applications to query account balances, transaction history, and network state, as well as submit transactions. It is the primary interface for traditional web applications integrating with Stellar before Soroban RPC became available.

*See also:* [RPC Node](#rpc-node), [Stellar](#stellar)

---

### Instance Storage
A tier of Soroban contract storage tied directly to the contract instance itself. Data stored in instance storage shares the contract instance's TTL, meaning it is kept alive as long as the instance is active. It is best suited for small, frequently accessed values like admin addresses or configuration flags.

*See also:* [Contract Storage](#contract-storage), [Persistent Storage](#persistent-storage), [TTL (Time-to-Live)](#ttl-time-to-live)

---

### Ledger
A single, agreed-upon snapshot of the complete state of the Stellar network at a specific point in time, analogous to a block in other blockchain systems. Each ledger has a sequence number and contains a set of transactions that were applied to the previous ledger's state. Ledgers close approximately every 5 seconds on Stellar.

*See also:* [Ledger Close](#ledger-close), [Transaction](#transaction)

---

### Ledger Close
The moment when the Stellar network finalizes a new ledger by reaching consensus among validators. All transactions included in that ledger are applied atomically, and the resulting state is permanent and irreversible. Unlike proof-of-work chains, Stellar ledger closes have true finality — there are no forks or reorgs.

*See also:* [Ledger](#ledger), [Stellar](#stellar)

---

### Lumens (XLM)
The native currency of the Stellar network. XLM is used to pay transaction fees and to maintain minimum account balances (called "reserves"). It cannot be frozen or controlled by any single entity. On Soroban, XLM is also used to pay for computation and storage resources.

*See also:* [Stroop](#stroop), [Base Fee](#base-fee)

---

### Mainnet
The live, production Stellar network where transactions have real financial value. Code deployed to Mainnet interacts with real assets and real users. Aura Vault is intended for eventual Mainnet deployment after thorough testing on Testnet.

*See also:* [Testnet](#testnet), [Network Passphrase](#network-passphrase)

---

### Network Passphrase
A unique string that identifies a specific Stellar network (Mainnet, Testnet, or a private network). Transaction signatures include the network passphrase, so a signed transaction is only valid on the network it was built for. This prevents a transaction signed for Testnet from accidentally being replayed on Mainnet.

*See also:* [Mainnet](#mainnet), [Testnet](#testnet), [Transaction](#transaction)

---

### Operation
A single action within a Stellar transaction, such as a payment, an account creation, or a smart contract invocation. A transaction can bundle up to 100 operations that all succeed or fail together. Each operation costs one base fee unit.

*See also:* [Transaction](#transaction), [Base Fee](#base-fee)

---

### Persistent Storage
The longest-lived tier of Soroban contract storage, designed for data that must survive indefinitely (such as user balances and vault totals). Persistent entries have their own TTL that must be renewed independently of the contract instance. If a persistent entry expires, it is archived and must be explicitly restored before it can be read again.

*See also:* [Contract Storage](#contract-storage), [TTL (Time-to-Live)](#ttl-time-to-live), [Archival (State Archival)](#archival-state-archival)

---

### Resource Limits
Per-transaction caps on CPU instructions, memory usage, and ledger entry reads/writes enforced by the Soroban runtime. Transactions that exceed any resource limit are rejected. Developers must benchmark their contracts to ensure they stay within limits, particularly for operations that iterate over large collections.

*See also:* [Footprint](#footprint), [Soroban](#soroban)

---

### RPC Node
A server that exposes a JSON-RPC interface for interacting with Soroban smart contracts. Unlike Horizon, which focuses on payments and account data, the Soroban RPC node supports contract simulation, submission, and event streaming. The Aura frontend and backend connect to a Soroban RPC node to read vault state and submit transactions.

*See also:* [Horizon](#horizon), [Soroban](#soroban)

---

### SEP-41
A Stellar Ecosystem Proposal that defines a standard interface for fungible tokens on Soroban, analogous to ERC-20 on Ethereum. Any contract implementing SEP-41 exposes a consistent set of functions (`transfer`, `balance`, `approve`, etc.) so that other contracts and tools can interact with it without knowing the implementation details. Aura accepts any SEP-41-compatible token as its underlying asset.

*See also:* [Stellar Asset Contract (SAC)](#stellar-asset-contract-sac), [Underlying Token](#underlying-token)

---

### Sequence Number
A monotonically increasing counter stored on every Stellar account, incremented by one with each submitted transaction. Including the sequence number in a transaction prevents replay attacks — the same signed transaction cannot be submitted twice. Transactions with an out-of-order sequence number are rejected by the network.

*See also:* [Transaction](#transaction), [Operation](#operation)

---

### Soroban
Stellar's smart contract platform, introduced to add programmability to the Stellar network. Soroban contracts are written in Rust and compiled to WebAssembly (WASM). It provides a deterministic, resource-metered execution environment with built-in storage tiers, event logging, and cross-contract call support.

*See also:* [Stellar](#stellar), [WASM](#wasm), [Contract Storage](#contract-storage)

---

### State Expiry
The broader Soroban design principle that all on-chain state has a finite lifetime unless actively renewed. State expiry prevents the Stellar ledger from growing without bound by allowing unused data to be archived and eventually pruned. Protocols must pay to extend storage TTLs or risk having their data become inaccessible.

*See also:* [TTL (Time-to-Live)](#ttl-time-to-live), [Archival (State Archival)](#archival-state-archival)

---

### Stellar
A public, open-source blockchain network designed for fast, low-cost financial transactions and cross-border payments. Stellar uses the Stellar Consensus Protocol (SCP), a federated Byzantine agreement system, to achieve finality in seconds without mining. Soroban is Stellar's smart contract layer built on top of this network.

*See also:* [Soroban](#soroban), [Lumens (XLM)](#lumens-xlm)

---

### Stellar Asset Contract (SAC)
A Soroban contract automatically generated by the Stellar network for any classic Stellar asset, giving it a SEP-41-compatible interface. SACs allow existing Stellar assets (like USDC.e or native XLM) to be used directly in Soroban contracts without deploying a separate token contract. Aura can use a SAC as its underlying token.

*See also:* [SEP-41](#sep-41), [Underlying Token](#underlying-token)

---

### Stroop
The smallest indivisible unit of a Stellar Lumen (XLM). One XLM equals 10,000,000 stroops (10^7). Fees and balances on Stellar are expressed internally in stroops to avoid floating-point errors.

*See also:* [Lumens (XLM)](#lumens-xlm), [Base Fee](#base-fee)

---

### Temporary Storage
The shortest-lived tier of Soroban contract storage, intended for data that is only needed within a single transaction or for a brief period. Temporary entries are automatically deleted after their (short) TTL expires and cannot be restored once gone. They are appropriate for things like nonces or inter-transaction caches.

*See also:* [Contract Storage](#contract-storage), [Persistent Storage](#persistent-storage), [TTL (Time-to-Live)](#ttl-time-to-live)

---

### Testnet
A public Stellar network that mirrors Mainnet behavior but uses tokens with no real-world value. Testnet is used for development, testing, and integration work before deploying to production. Accounts on Testnet can be funded for free using the Friendbot faucet.

*See also:* [Mainnet](#mainnet), [Network Passphrase](#network-passphrase)

---

### Transaction
The fundamental unit of change on the Stellar network: a signed envelope containing one or more operations along with a fee, a sequence number, and an expiration time. All operations in a transaction succeed or fail together — there are no partial transactions. A contract invocation is submitted as a Soroban transaction.

*See also:* [Operation](#operation), [Sequence Number](#sequence-number), [Ledger Close](#ledger-close)

---

### TTL (Time-to-Live)
The number of ledgers remaining before a Soroban storage entry is considered expired and eligible for archival. TTL is measured in ledger counts, not wall-clock time. Aura extends TTLs on every mutating call using a 30-day lifetime target and a 7-day bump threshold to ensure user balances and vault state are never accidentally archived.

*See also:* [Archival (State Archival)](#archival-state-archival), [State Expiry](#state-expiry), [Persistent Storage](#persistent-storage)

---

### WASM
WebAssembly — a compact, portable binary instruction format that Soroban uses as its execution target. Rust smart contracts are compiled to WASM before being uploaded to the Stellar network. The WASM binary is stored on-chain and instantiated by the runtime whenever a contract function is invoked.

*See also:* [Soroban](#soroban), [Contract Instance](#contract-instance)

---

## Category 3: Aura-Specific Terms

### AlreadyVoted
A `VaultError` (code 15) returned when a governance signer attempts to cast a second vote on the same proposal. Each signer address may only vote once per proposal; subsequent attempts are rejected to prevent double-voting. The contract tracks which signers have voted using a per-proposal set stored in contract storage.

*See also:* [VaultError](#vaulterror), [Proposal](#proposal), [NotApproved](#notapproved)

---

### AuraVault
The primary Soroban smart contract at the core of this project. It accepts deposits of a single SEP-41-compatible token, issues proportional vault shares, auto-compounds yield through permissionless keeper harvests, and enforces security controls including pause functionality, a flash loan guard, and governance-gated upgrades.

*See also:* [Vault](#vault), [SEP-41](#sep-41), [Underlying Token](#underlying-token)

---

### balance_of()
A read-only (view) function that returns the number of vault shares held by a given address. Calling `balance_of` does not modify any state and does not consume significant resources. It is the primary way for depositors and frontends to check how many shares an account owns.

*See also:* [Vault Share](#vault-share), [Total Shares](#total-shares)

---

### BalanceMismatch
A `VaultError` (code 12) returned when the vault's actual on-chain token balance — queried live from the token contract — differs from the `total_deposited` value tracked in internal storage. A mismatch suggests that tokens were injected or removed outside the normal deposit/withdraw/harvest flow, which is a hallmark of a flash loan attack. Aura emits a `suspicious` event with the observed and tracked amounts before returning this error.

*See also:* [VaultError](#vaulterror), [Flash Loan Guard](#flash-loan-guard), [Flash Loan](#flash-loan)

---

### Blameless Post-mortem
A structured incident review process that focuses on understanding what went wrong in a system without assigning personal blame to individuals. The goal is to identify the root cause, contributing factors, and systemic improvements rather than punishing people for mistakes. Blameless post-mortems are a standard practice in production software operations and are referenced in Aura's security documentation as the expected response to any on-chain incident.

*See also:* [Smart Contract Audit](#smart-contract-audit)

---

### CEI Pattern
Checks-Effects-Interactions — an ordering discipline for writing safe smart contract functions. The pattern requires that a function first validate all inputs and preconditions (Checks), then update all internal state variables (Effects), and only then make any calls to external contracts (Interactions). Following CEI prevents reentrancy attacks because by the time an external call is made, the internal state already reflects the completed operation. Every mutating function in AuraVault follows this pattern.

*See also:* [Reentrancy](#reentrancy), [Flash Loan Guard](#flash-loan-guard)

---

### deposit()
The AuraVault function that accepts a specified amount of the underlying token from a caller and mints a proportional number of vault shares in return. If the vault has no existing shares, the first depositor receives shares at the seed ratio. On subsequent deposits, shares minted equal `floor(amount × total_shares / total_assets)`. The function rejects zero-amount deposits, paused-vault calls, and any balance mismatch detected by the flash loan guard.

*See also:* [Vault Share](#vault-share), [Seed Ratio](#seed-ratio), [First Depositor](#first-depositor), [Flash Loan Guard](#flash-loan-guard)

---

### First Depositor
The very first address to deposit tokens into a freshly initialized vault with zero shares and zero assets. Because there are no existing shares to derive a ratio from, the first depositor receives shares at the seed ratio (currently 1:1). This bootstrap condition also makes the vault most vulnerable to inflation attacks if not guarded correctly.

*See also:* [Seed Ratio](#seed-ratio), [Inflation Attack](#inflation-attack), [deposit()](#deposit)

---

### Flash Loan Guard
A security check performed at the start of every mutating function (`deposit`, `withdraw`, `harvest`) that compares the vault's live on-chain token balance against its internally tracked `total_deposited` figure. If these values differ, it means tokens were added or removed outside the standard flow — a pattern consistent with a flash loan attack — and the function returns a `BalanceMismatch` error and emits a `suspicious` event.

*See also:* [BalanceMismatch](#balancemismatch), [Flash Loan](#flash-loan), [CEI Pattern](#cei-pattern)

---

### harvest()
The AuraVault function that injects a specified amount of yield tokens into the vault without minting any new shares. This increases `total_assets` while leaving `total_shares` unchanged, causing the exchange rate (and therefore each share's redemption value) to rise. Anyone may call `harvest()`, making it permissionless; it reverts with `ZeroShares` if the vault has no existing shareholders, and with `VaultPaused` if the vault is halted.

*See also:* [Harvest](#harvest), [ZeroShares](#zeroshares), [Total Assets (state)](#total-assets-state), [Exchange Rate](#exchange-rate)

---

### initialize()
The one-time setup function for the AuraVault contract that stores the admin address and the underlying token contract address. It can only be called once; subsequent calls return `AlreadyInitialized`. This function must be called immediately after deployment before any other function will work.

*See also:* [AuraVault](#auravault), [Underlying Token](#underlying-token), [VaultError](#vaulterror)

---

### is_paused()
A read-only function that returns `true` if the vault is currently paused and `false` otherwise. Any user or integration can call this to check whether deposits, withdrawals, and harvests are currently allowed. It does not modify any state.

*See also:* [pause()](#pause), [unpause()](#unpause), [VaultPaused](#vaultpaused)

---

### MathOverflow
A `VaultError` (code 6) returned when an arithmetic operation during share calculation would exceed the maximum value of the integer type being used. Aura uses `checked_mul` and `checked_div` for all share math; if any intermediate result would overflow, the function returns this error rather than wrapping around to an incorrect value. The Cargo profile also sets `overflow-checks = true` as a compile-time safety net.

*See also:* [VaultError](#vaulterror), [Rounding Attack](#rounding-attack)

---

### NotApproved
A `VaultError` (code 14) returned when an attempt is made to execute a governance proposal that has not yet reached the required approval threshold. The number of approvals is compared against the configured quorum before execution proceeds. This prevents a single signer from executing multi-sig actions unilaterally.

*See also:* [VaultError](#vaulterror), [Quorum](#quorum), [AlreadyVoted](#alreadyvoted)

---

### pause()
An admin-only AuraVault function that sets the vault's paused flag to `true`, immediately blocking all calls to `deposit()`, `withdraw()`, and `harvest()`. The pause is intended for emergency situations such as a detected exploit or a critical bug. It does not affect read-only calls like `balance_of()` or `total_assets()`.

*See also:* [unpause()](#unpause), [is_paused()](#is_paused), [VaultPaused](#vaultpaused)

---

### Seed Ratio
The initial exchange rate used when the very first tokens are deposited into an empty vault. In AuraVault the seed ratio is 1:1, meaning the first depositor receives exactly as many shares as the number of tokens they deposit. This bootstraps the share accounting system before any yield has been earned.

*See also:* [First Depositor](#first-depositor), [Exchange Rate](#exchange-rate), [Share Ratio](#share-ratio)

---

### Share Ratio
The formula used to calculate how many vault shares to mint for a deposit after the first: `floor(amount × total_shares / total_assets)`. The ratio ensures that new depositors receive shares proportional to their contribution relative to the vault's current size, so that existing shareholders are not diluted and new shareholders do not overpay.

*See also:* [Seed Ratio](#seed-ratio), [Exchange Rate](#exchange-rate), [Total Shares](#total-shares)

---

### StorageLayoutMismatch
A `VaultError` (code 10) returned during a contract upgrade if the on-chain storage layout version does not match what the new code expects. This guard prevents a new contract version from misinterpreting data written by an older version, which could corrupt vault state. Upgrades must include a migration path or version bump that satisfies this check.

*See also:* [VaultError](#vaulterror), [UpgradeUnauthorized](#upgradeunauthorized)

---

### TimelockNotExpired
A `VaultError` (code 13) returned when an attempt is made to execute a governance proposal before its mandatory waiting period has elapsed. The timelock is measured in ledger numbers; execution is only permitted after the ledger count at approval plus the configured delay has passed. This gives users time to react to approved changes before they take effect.

*See also:* [VaultError](#vaulterror), [Timelock](#timelock), [Proposal](#proposal)

---

### total_assets() (function)
A read-only AuraVault function that returns the current total number of underlying tokens held by the vault, including both deposited principal and all compounded yield. This value is the numerator in the exchange rate calculation. It does not modify any state.

*See also:* [Total Assets (state)](#total-assets-state), [Exchange Rate](#exchange-rate)

---

### Total Assets (state)
The internal storage variable tracking the total amount of underlying tokens the vault is responsible for. It increases on deposits and harvests, and decreases on withdrawals. Together with `total_shares`, it defines the current exchange rate for all vault shares.

*See also:* [total_assets() (function)](#total_assets-function), [Total Shares](#total-shares), [Exchange Rate](#exchange-rate)

---

### Total Shares
The running sum of all vault shares currently in existence, stored in the vault's internal state. New shares are minted on deposit and burned on withdrawal; `harvest()` never changes this value. Together with `total_assets`, it determines how many underlying tokens each share can be redeemed for.

*See also:* [Total Assets (state)](#total-assets-state), [Vault Share](#vault-share), [Exchange Rate](#exchange-rate)

---

### Underlying Token
The single SEP-41-compatible token that AuraVault accepts for deposit and distributes on withdrawal. The underlying token contract address is set once during `initialize()` and cannot be changed. All vault accounting — share ratios, total assets, harvest amounts — is denominated in this token.

*See also:* [SEP-41](#sep-41), [AuraVault](#auravault), [initialize()](#initialize)

---

### unpause()
An admin-only AuraVault function that clears the paused flag, restoring normal operation of `deposit()`, `withdraw()`, and `harvest()`. It is the counterpart to `pause()` and should only be called after the emergency condition that triggered the pause has been investigated and resolved.

*See also:* [pause()](#pause), [is_paused()](#is_paused), [VaultPaused](#vaultpaused)

---

### UpgradeUnauthorized
A `VaultError` (code 9) returned when an account other than the configured admin attempts to upgrade the contract's WASM binary. Contract upgrades are highly privileged operations because they can change any behavior of the vault; restricting them to the admin prevents unauthorized parties from deploying malicious code.

*See also:* [VaultError](#vaulterror), [StorageLayoutMismatch](#storagelayoutmismatch), [Multi-sig (Multi-signature)](#multi-sig-multi-signature)

---

### Vault Share
A unit of ownership in the AuraVault, minted when a user deposits and burned when a user withdraws. Vault shares are not transferable tokens in the current implementation — they are balance entries stored in the vault's own persistent storage keyed by address. The redemption value of each share rises over time as yield is harvested and compounded into `total_assets`.

*See also:* [Share Token](#share-token), [Exchange Rate](#exchange-rate), [balance_of()](#balance_of)

---

### VaultError
The Rust enum that enumerates all error conditions the AuraVault contract can return. Each variant is assigned a numeric code (1–15) that is surfaced to callers. Using a typed error enum rather than raw integers makes the contract's failure modes self-documenting and easier to handle in client code.

*See also:* [BalanceMismatch](#balancemismatch), [VaultPaused](#vaultpaused), [MathOverflow](#mathoverflow)

---

### VaultPaused
A `VaultError` (code 11) returned when a mutating function (`deposit`, `withdraw`, or `harvest`) is called while the vault is in a paused state. The admin can pause the vault in emergencies to prevent further activity while an issue is investigated. Read-only functions remain available while paused.

*See also:* [VaultError](#vaulterror), [pause()](#pause), [is_paused()](#is_paused)

---

### withdraw()
The AuraVault function that burns a specified number of vault shares belonging to the caller and transfers the proportional amount of underlying tokens back to them. The redemption amount equals `floor(shares × total_assets / total_shares)`. The function checks that the caller holds enough shares, that the vault holds enough tokens, and runs the flash loan guard before executing the transfer.

*See also:* [Vault Share](#vault-share), [Exchange Rate](#exchange-rate), [Flash Loan Guard](#flash-loan-guard)

---

### ZeroShares
A `VaultError` (code 8) returned when `harvest()` is called on a vault that has no outstanding shares — i.e., no depositors. Injecting yield into an empty vault would be meaningless (there is no one to benefit) and would also break the share ratio math for the first subsequent depositor. This guard ensures harvests only occur when there is an active user base.

*See also:* [VaultError](#vaulterror), [harvest()](#harvest-1), [Total Shares](#total-shares)
