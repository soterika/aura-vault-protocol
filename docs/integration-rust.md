# Rust integration

This guide covers calling an Aura Vault contract from a Rust application with
Stellar RPC. The on-chain contract uses `soroban-sdk`; an off-chain application
uses the separate `soroban-client` crate.

## Requirements and dependencies

Install stable Rust. You only need the `wasm32-unknown-unknown` target when
building the contract itself. An application that calls an already deployed
contract does not need to compile the contract.

```toml
[dependencies]
soroban-client = "0.6.0"
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
anyhow = "1"
```

Set the network RPC URL and contract ID in your deployment configuration. Keep
the signing secret in a secret manager or environment injection; do not commit
it or print it in logs. Use a testnet funded account while developing.

## Create a client and simulate a read

The client crate builds Soroban contract calls and sends them to Stellar RPC.
This example uses the native Stellar Asset Contract to read the test account's
XLM balance. It is a complete executable example and does not submit a
transaction.

```rust,no_run
use anyhow::Result;
use soroban_client::account::Account;
use soroban_client::address::{Address, AddressTrait};
use soroban_client::contract::{ContractBehavior, Contracts};
use soroban_client::keypair::{Keypair, KeypairBehavior};
use soroban_client::network::{NetworkPassphrase, Networks};
use soroban_client::transaction::{AccountBehavior, TransactionBuilderBehavior};
use soroban_client::transaction_builder::TransactionBuilder;
use soroban_client::xdr::{int128_helpers::i128_from_pieces, Int128Parts, ScVal};
use soroban_client::{Options, Server};

#[tokio::main]
async fn main() -> Result<()> {
    let rpc = Server::new("https://soroban-testnet.stellar.org", Options::default())?;
    let native_sac = Contracts::new(
        "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    ).unwrap();

    // For a read-only example, generate a temporary account and fund it on
    // testnet. Production signers should load a funded account securely.
    let keypair = Keypair::random().unwrap();
    let account_info = rpc.request_airdrop(&keypair.public_key()).await?;
    let mut account = Account::new(&keypair.public_key(), &account_info.sequence_number()).unwrap();
    let address = Address::new(&keypair.public_key()).unwrap();

    let transaction = TransactionBuilder::new(&mut account, Networks::testnet(), None)
        .fee(1000u32)
        .add_operation(native_sac.call("balance", Some(vec![address.to_sc_val().unwrap()])))
        .build();
    let simulation = rpc.simulate_transaction(&transaction, None).await?;

    if let Some((ScVal::I128(Int128Parts { hi, lo }), _auth)) = simulation.to_result() {
        println!("Balance in stroops: {}", i128_from_pieces(hi, lo));
    }
    Ok(())
}
```

Run it with `cargo run`. The example asks testnet Friendbot to create and fund a
temporary account. Applications with an existing account should use that
account instead.

## Submit a vault deposit

Aura Vault's `deposit` contract function takes the caller address and an `i128`
amount in the underlying token's smallest units. The contract also invokes the
underlying token transfer, so the transaction must authorize the caller and
include the token contract's required invocation. Do not treat a successful
simulation as a deposit: simulation does not change ledger state.

Load an existing secret seed with `Keypair::from_secret(&secret_seed)` where
`secret_seed` comes from an injected `STELLAR_SECRET_KEY` environment variable
or secret manager. Never use a testnet faucet or a generated throwaway key for
a production deposit.

Build the contract invocation with `Contracts::new(VAULT_ID)?.call("deposit",
Some(vec![caller.to_sc_val()?, ScVal::I128(amount.into())]))`, add it to a
transaction from the funded source account, and then:

1. Call `Server::prepare_transaction` to simulate and attach the required
   Soroban footprint and resource fees.
2. Sign the prepared transaction with the authorized keypair using
   `prepared_transaction.sign(&[keypair])`. Build the transaction with the
   passphrase for the target network (`Networks::testnet()` or
   `Networks::public()`).
3. Submit it with `Server::send_transaction`.
4. Poll `Server::get_transaction` or use `Server::wait_transaction` until the
   result is `SUCCESS` or `FAILED`.

The exact authorization entries depend on the token and signer setup. Build
them from the simulated invocation; do not hand-construct JSON-RPC payloads.
Before submitting, check the contract's decimals and convert user-facing token
amounts to integer base units. A first deposit mints shares one for one; later
deposits mint shares proportionally to the vault's assets and shares.

## Read vault state

For public getters such as `total_assets`, `total_shares`, and `balance_of`,
build an invocation with the getter name and its arguments, then call
`simulate_transaction`. Decode the returned `ScVal` using the type declared by
the contract (the three getters above return `i128`). Simulation is the
straightforward route for contract getters. `Server::get_contract_data` and
`Server::get_ledger_entries` read ledger entries directly when an application
knows the relevant storage key and durability.

## Subscribe to contract events

`Server::get_events` supports filters by contract and topic over a requested
ledger range. Persist the last processed ledger and event ID, advance the
ledger cursor after processing, and deduplicate by event ID because adjacent
polls may include the same event. RPC event retention is limited; a keeper or
indexer that needs durable history should persist events in its own database.

```rust,no_run
use soroban_client::soroban_rpc::EventType;
use soroban_client::{EventFilter, Pagination, Server};

async fn recent_events(rpc: &Server, vault_id: &str, start_ledger: u32) -> anyhow::Result<()> {
    let response = rpc
        .get_events(
            Pagination::From(start_ledger),
            vec![EventFilter::new(EventType::All).contract(vault_id)],
            100u32,
        )
        .await?;
    println!("{} events", response.events.len());
    Ok(())
}
```

## Keeper transactions and retries

A keeper follows the same simulate, prepare, sign, submit, and confirm sequence
as a user deposit. Make each job safe to retry: read current on-chain state
before submitting, use a durable job identifier, and record the transaction
hash before polling. Treat RPC timeouts as an unknown outcome and query the
transaction hash before creating another transaction. Retry transient network
errors with bounded exponential backoff and jitter; do not retry a confirmed
contract failure without addressing its cause. Keep signing keys outside the
worker's source tree and grant them only the permissions the keeper needs.

## Local verification

Run the executable example with a funded testnet environment using
`cargo run`. For contract-level behavior, use the repository's Soroban tests
and local test environment; RPC examples should not depend on mainnet state.
