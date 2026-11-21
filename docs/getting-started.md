# Getting Started with Aura Vault

This guide takes a new contributor from a clean machine to a running local stack, a deployed contract, and a first frontend deposit. The expected setup time is under 30 minutes.

For deeper setup details, see [DEVELOPMENT_SETUP.md](../DEVELOPMENT_SETUP.md). For runtime problems, see [troubleshooting.md](troubleshooting.md).

---

## Table of Contents

1. [Developer prerequisites](#developer-prerequisites)
2. [Install Rust and the WASM target](#1-install-rust-and-the-wasm-target)
3. [Install the Stellar CLI and configure testnet](#2-install-the-stellar-cli-and-configure-testnet)
4. [Create and fund a test keypair](#3-create-and-fund-a-test-keypair)
5. [Configure and run the local stack](#4-configure-and-run-the-local-stack)
6. [Seed the database](#5-seed-the-local-database)
7. [Deploy the contract](#6-deploy-the-contract)
8. [Make the first frontend deposit](#7-make-the-first-deposit)
9. [Troubleshooting the five common setup errors](#troubleshooting-the-five-common-setup-errors)
10. [Using the frontend and wallet](#using-the-frontend-and-wallet)
11. [Understanding vault shares](#understanding-vault-shares)
12. [FAQ](#faq)

---

## Review status

This guide is ready for an independent developer review. Approval must come from a team member who did not author the change. The reviewer should record the date and environment here in the PR before merge:

```text
Reviewed by: <name>
Review date: <YYYY-MM-DD>
Environment: <OS / Node / Rust / Stellar CLI / Docker>
Result: Approved
```

---

## Developer prerequisites

Run every command from the repository root unless a section says otherwise.

| Tool | Minimum version | Purpose |
|---|---:|---|
| Git | 2.40+ | Source control |
| Node.js | 22+ | Backend and frontend |
| npm | 10+ | JavaScript dependencies |
| Rust | 1.78+ | Soroban contract |
| `cargo` | 1.78+ | Rust builds and tests |
| Docker Engine or Docker Desktop | 27+ | PostgreSQL, Redis, and optional local sandbox |
| Docker Compose | 2.24+ | Multi-container development stack |
| Stellar CLI | 21.3.0+ | Testnet/local network and contract deployment |
| PostgreSQL client (optional) | 16+ | Database checks |
| jq | 1.6+ | Parse deployment script output |
| Chrome, Edge, or Firefox | Current | Frontend and Freighter |

### Verify prerequisites

```bash
git --version
node --version
npm --version
rustc --version
cargo --version
docker --version
docker compose version
stellar --version
```

Each command must succeed before continuing. Node must print `v22` or newer.

---

## 1. Install Rust and the WASM target

### macOS and Linux

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustup toolchain install stable
rustup default stable
rustup target add wasm32-unknown-unknown
rustc --version
rustup target list --installed | grep wasm32-unknown-unknown
```

### Windows 11

Use WSL2 with Ubuntu 22.04 or newer. Run these commands inside WSL, not in PowerShell:

```bash
wsl --install -d Ubuntu-22.04
```

After Ubuntu starts, run:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustup toolchain install stable
rustup default stable
rustup target add wasm32-unknown-unknown
```

---

## 2. Install the Stellar CLI and configure testnet

Install the CLI with Rust on macOS, Linux, or WSL:

```bash
cargo install --locked stellar-cli --features opt
stellar --version
```

Configure the Testnet network and verify it:

```bash
stellar network add testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"

stellar network ls
stellar network info testnet
```

---

## 3. Create and fund a test keypair

Create a local named keypair for development:

```bash
stellar keys generate dev-key --network testnet
DEV_ADDRESS="$(stellar keys address dev-key)"
echo "$DEV_ADDRESS"
```

The address starts with `G` and is safe to share.

Fund it from Friendbot:

```bash
curl --fail --show-error --location "https://friendbot.stellar.org?addr=${DEV_ADDRESS}"
stellar keys fund dev-key --network testnet
```

Verify the account and preserve the address for the remaining steps:

```bash
curl --fail --show-error "https://horizon-testnet.stellar.org/accounts/${DEV_ADDRESS}" |
  python3 -c 'import json,sys; data=json.load(sys.stdin); print("\n".join(f"{b[\"balance\"]} {b[\"asset_type\"]}" for b in data["balances"]))'
```

Never commit the generated secret key or a seed phrase.

### Configure Freighter

1. Install Freighter from [freighter.app](https://www.freighter.app).
2. Create or import a wallet, then unlock it.
3. Open Freighter settings and select **Test SDF Network / Sep 2015**.
4. Import the dev key only if you want to sign deposits with the same account. Otherwise, create a separate Freighter testnet account and fund it the same way.

To fund a Freighter address:

```bash
FREIGHTER_ADDRESS="<your-G-address>"
curl --fail --show-error --location "https://friendbot.stellar.org?addr=${FREIGHTER_ADDRESS}"
```

---

## 4. Configure and run the local stack

Start PostgreSQL and Redis with the repository's test-compose file:

```bash
docker compose -f docker-compose.test.yml up -d postgres redis
docker compose -f docker-compose.test.yml ps
docker compose -f docker-compose.test.yml exec postgres pg_isready -U postgres -d aura_vault_test
docker compose -f docker-compose.test.yml exec redis redis-cli ping
```

Install dependencies:

```bash
npm install
npm install --prefix backend
npm install --prefix frontend
npm install --prefix ui
npm install --prefix contracts
```

Create the backend environment file:

```bash
cat > backend/.env.local <<EOF
PORT=3001
NODE_ENV=development
JWT_SECRET=$(openssl rand -hex 64)
UNSUBSCRIBE_SECRET=$(openssl rand -hex 32)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aura_vault_test
DATABASE_REPLICA_URL=postgresql://postgres:postgres@localhost:5432/aura_vault_test
REDIS_URL=redis://localhost:6379
HORIZON_URL=https://horizon-testnet.stellar.org
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
VAULT_CONTRACT_ID=
EOF
```

Create the frontend environment file:

```bash
cat > frontend/.env.local <<'EOF'
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
EOF
```

Run the backend and frontend in two terminals.

Terminal 1:

```bash
cd backend
set -a
source .env.local
set +a
npm run dev
```

Terminal 2:

```bash
cd frontend
npm run dev
```

Verify both services:

```bash
curl --fail http://localhost:3001/api/health
curl --fail --head http://localhost:3000
```

Open [http://localhost:3000](http://localhost:3000).

---

## 5. Seed the local database

With PostgreSQL running, apply migrations and seed development data:

```bash
cd backend
set -a
source .env.local
set +a
npm run migrate:up
npm run seed
npm run migrate:status
```

The seed command adds sample vaults, positions, referrals, yield calculations, jobs, and contract events. Re-running it is safe.

---

## 6. Deploy the contract

### Option A: local sandbox (recommended for contract development)

Start the local Stellar container:

```bash
stellar container start local
stellar network add local \
  --rpc-url http://localhost:8000/soroban/rpc \
  --network-passphrase "Standalone Network ; September 2015"
stellar keys generate local-dev --network local
LOCAL_ADDRESS="$(stellar keys address local-dev)"
echo "$LOCAL_ADDRESS"
```

Build and deploy:

```bash
cargo build --manifest-path aura-vault/Cargo.toml --target wasm32-unknown-unknown --release

WASM_HASH="$(stellar contract upload \
  --wasm aura-vault/target/wasm32-unknown-unknown/release/aura_vault.wasm \
  --source local-dev --network local --output json |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["wasm_id"])')"

CONTRACT_ID="$(stellar contract deploy \
  --wasm-hash "$WASM_HASH" \
  --source local-dev --network local --output json |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["contract_id"])')"

SIGNERS="[\"${LOCAL_ADDRESS}\",\"${LOCAL_ADDRESS}\",\"${LOCAL_ADDRESS}\",\"${LOCAL_ADDRESS}\",\"${LOCAL_ADDRESS}\"]"

stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source local-dev \
  --network local \
  -- initialize \
  --admin "$LOCAL_ADDRESS" \
  --underlying_token "<SEP41_TOKEN_CONTRACT_ID>" \
  --signers "$SIGNERS" \
  --decimals 7

echo "CONTRACT_ID=$CONTRACT_ID"
```

Set `VAULT_CONTRACT_ID=$CONTRACT_ID` in `backend/.env.local`, then restart the backend. Replace `<SEP41_TOKEN_CONTRACT_ID>` with a deployed local SEP-41 token contract; initialization requires a real contract address.

Stop the sandbox when finished:

```bash
stellar container stop local
```

### Option B: Testnet

From the repository root, run the tested quick-deploy script:

```bash
bash scripts/testnet-quick-deploy.sh --skip-tests
```

The script creates and funds a deployer key, uploads the Wasm, deploys the vault, initializes it, and writes deployment metadata under `/tmp`. Review the returned contract ID and set `VAULT_CONTRACT_ID` to that value in `backend/.env.local`, then restart the backend.

---

## 7. Make the first deposit

1. Open [http://localhost:3000](http://localhost:3000).
2. Switch Freighter to Testnet.
3. Click **Connect Wallet** and approve the request.
4. Confirm the orange **TESTNET** network badge is displayed.
5. Open **Deposit**.
6. Enter an amount greater than zero and review the share and fee preview.
7. Click **Deposit**, then approve the transaction in Freighter.
8. Wait for the success state and confirm that the share balance changes.

The on-chain deposit transfers the underlying SEP-41 token to the vault and mints vault shares. On a local sandbox, use the frontend only after configuring a local token and a wallet/Soroban signer supported by the app.

---

## Troubleshooting the five common setup errors

1. **`rustc` or `cargo` not found**
   Restart the terminal, run `source "$HOME/.cargo/env"`, and verify `rustup default stable`.

2. **`wasm32-unknown-unknown` target missing**
   ```bash
   rustup update stable
   rustup target add wasm32-unknown-unknown
   cargo build --manifest-path aura-vault/Cargo.toml --target wasm32-unknown-unknown --release
   ```

3. **Freighter shows the wrong network**
   Open Freighter settings and select **Test SDF Network / Sep 2015**. Refresh the frontend and reconnect.

4. **PostgreSQL or Redis is unavailable**
   ```bash
   docker compose -f docker-compose.test.yml up -d postgres redis
   docker compose -f docker-compose.test.yml logs postgres redis
   ```

5. **Friendbot funding or Testnet RPC times out**
   Retry the direct URL in a browser, then run:
   ```bash
   DEV_ADDRESS="$(stellar keys address dev-key)"
   curl --fail --retry 5 --retry-delay 3 --location "https://friendbot.stellar.org?addr=${DEV_ADDRESS}"
   stellar network info testnet
   ```

For additional project-specific failures, see [troubleshooting.md](troubleshooting.md).

---

## Using the frontend and wallet

### Step 1 — Install a Wallet

**Freighter** is the most widely supported browser extension wallet for Stellar.

### Installing Freighter

1. Visit [freighter.app](https://www.freighter.app) in Chrome, Firefox, or Edge.
2. Click **Add to Browser** (or your browser's equivalent install button).
3. Pin the extension to your toolbar for easy access.

### Creating a new wallet

1. Click the Freighter icon in your toolbar.
2. Click **Create New Wallet**.
3. Choose a strong password — this protects your wallet on this device.
4. Write down your **12-word seed phrase** on paper and store it somewhere safe offline.
   > ⚠️ Never photograph or type your seed phrase anywhere. Anyone who has it controls your funds.
5. Confirm the seed phrase when prompted.
6. Your wallet is ready. Your Stellar address starts with `G...`.

### Importing an existing wallet

1. Click **Import Wallet** and enter your 12 or 24-word seed phrase.
2. Choose a password for this device.

### Switching to Testnet (for practice)

1. Click the Freighter icon → Settings (⚙️) → Network.
2. Select **Test SDF Network / Sep 2015** (Testnet).
3. The Freighter header will show **TESTNET** in orange.

---

## Step 2 — Connect Your Wallet

1. Open the Aura Vault app in your browser.
2. Click **Connect Wallet** in the top-right corner.

   > *Screenshot placeholder: top-right Connect Wallet button highlighted*

3. A Freighter popup appears — review the site permission and click **Connect**.
4. Your wallet address (e.g. `GABC…XY`) appears in the header next to the network badge.

   > *Screenshot placeholder: connected wallet address and TESTNET badge in header*

### Troubleshooting connection

| Symptom | Fix |
|---|---|
| "Wrong Network" warning | Open Freighter → Settings → Network → switch to the correct network |
| Freighter popup never appears | Disable popup blockers for this site; make sure the extension is enabled |
| Address not appearing after click | Refresh the page and try again; check Freighter is unlocked |

---

## Step 3 — Make Your First Deposit

1. Once connected, the **Deposit** panel appears on the main page.

   > *Screenshot placeholder: Deposit panel with amount field*

2. Enter the amount of tokens you want to deposit in the **Amount** field.
   - Minimum: any amount > 0, but deposits under ~10 tokens may round to 0 shares.
   - Start with a small amount while you are learning.

3. Click **Deposit**.

   > *Screenshot placeholder: Deposit button highlighted*

4. A transaction preview appears — review the details:
   - **Amount**: tokens you are depositing
   - **Estimated shares**: vault shares you will receive
   - **Network fee**: XLM cost (usually < 0.01 XLM)

5. Click **Approve** in the Freighter popup.

   > *Screenshot placeholder: Freighter approval popup*

6. Wait 5–10 seconds for the transaction to confirm on Stellar.
7. Your **Share Balance** updates below the form once confirmed.

   > *Screenshot placeholder: updated share balance after deposit*

### What happens on-chain

- Your tokens are transferred from your wallet to the vault contract.
- The vault mints vault shares proportional to your deposit and the current exchange rate.
- Your share balance is stored on the Stellar ledger.

---

## Step 4 — Monitor Your Portfolio

After connecting your wallet the **Portfolio** section shows:

| Field | What it means |
|---|---|
| **Total Vault Assets** | Total tokens held by the vault across all depositors |
| **Your Share Balance** | Number of vault shares you own |
| **Price Per Share** | Current value of one share in underlying tokens |
| **Your Underlying Value** | Your shares × price per share = your redeemable tokens |

> *Screenshot placeholder: portfolio section with all four fields labelled*

Click **Refresh** (🔄) at any time to fetch the latest on-chain data.

> *Screenshot placeholder: Refresh button*

The **Portfolio** section only appears when your wallet is connected. Disconnect and it disappears; reconnect and it comes back.

---

## Step 5 — Withdraw

1. Find the **Withdraw** panel on the main page.

   > *Screenshot placeholder: Withdraw panel*

2. Enter the number of **shares** you want to redeem.
   - You cannot enter more than your current share balance.
   - The app shows the estimated tokens you will receive before you confirm.

3. Click **Withdraw**.
4. Review and approve in Freighter.
5. Your underlying tokens arrive in your wallet within 5–10 seconds.

   > *Screenshot placeholder: wallet balance updated after withdrawal*

### Rounding note

The redemption formula uses integer division:

```
tokens_received = floor(shares × total_vault_assets / total_vault_shares)
```

You may receive 1 token less than the theoretical maximum due to rounding. The dust stays in the vault and benefits all remaining shareholders — this is expected and normal.

---

## Understanding Vault Shares

Think of vault shares like ownership units in a shared fund:

- The **vault pool** holds everyone's deposited tokens.
- You own a **percentage** of that pool, represented by your shares.
- When the vault earns yield (via a `harvest` operation), the pool grows — but the share count stays the same. Each share becomes worth more tokens.
- Depositing adds tokens to the pool and mints new shares. Withdrawing burns your shares and returns your proportion of the pool.

### Share pricing rules

| Scenario | Shares you receive |
|---|---|
| First ever deposit (empty vault) | Exactly equal to your deposit amount (1:1 seed) |
| Deposit after yield has accrued | Fewer shares — but each is worth more tokens |
| Deposit after another user deposited | Proportional to your fraction of the new pool |

### Worked example

| Event | Pool (tokens) | Total shares | Share price |
|---|---|---|---|
| Initial state | 0 | 0 | — |
| Alice deposits 1 000 | 1 000 | 1 000 | 1.000 |
| Yield harvest: +200 | 1 200 | 1 000 | 1.200 |
| Bob deposits 600 | 1 800 | 1 500 | 1.200 |
| Alice withdraws 500 shares | 1 200 | 1 000 | 1.200 |

Alice's 500 shares redeem for `500 × 1 200 / 1 000 = 600 tokens` — she earned 100 tokens of yield.

Bob receives `floor(600 / 1.200) = 500 shares` for his 600-token deposit, reflecting the higher share price at the time he joined.

---

## Fee Structure

Aura Vault uses two fee types, both configured by the vault admin in basis points (bps).

| Fee type | Unit | When collected | Example |
|---|---|---|---|
| **Performance fee** | bps of yield | Deducted from yield at harvest time | 200 bps = 2% of each yield injection |
| **Management fee** | bps per period | Applied periodically on total assets | 50 bps/year = 0.5% annualised |

> 1 basis point = 0.01%. Fees go to the vault treasury address set by the admin.

### How fees affect you

Fees are **deducted before yield is credited to the vault pool**, so they do not directly change your share balance. They reduce how much the pool grows per harvest, which slightly lowers the share price increase you would otherwise see.

To check the current fee rates:

- **In the app:** Navigate to Settings → Fee Info.
- **On-chain:** Call `get_fees()` on the contract (returns `(perf_fee_bps, mgmt_fee_bps)`).

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_fees
# returns: (200, 50)  → 2% performance fee, 0.5% management fee
```

---

## FAQ

**Q: Is there a minimum deposit?**  
A: Any amount > 0 is technically accepted. Deposits below ~10 tokens risk rounding to 0 shares and being rejected with a `ZeroAmount` error. Practically, deposits of 10 tokens or more work reliably.

**Q: Can I lose my deposit?**  
A: The vault is non-custodial — only you can withdraw your own shares. The primary risks are:
1. Smart contract bugs (the contract has been audited — see [AUDIT.md](../AUDIT.md))
2. The underlying token losing market value

Your shares cannot be seized, frozen, or transferred by the admin. The admin can only pause the vault in an emergency (see below).

**Q: What happens if the vault is paused?**  
A: The admin can pause the vault to protect funds during an emergency. While paused, deposits, withdrawals, and harvests are blocked. Your funds remain safe in the contract and your share ownership is unchanged. You can check pause state via `is_paused()`. The admin can unpause at any time.

**Q: Why did I receive fewer shares than I expected?**  
A: If you deposited after yield had accrued, the share price is higher than 1.0 so your tokens buy fewer shares. This is correct — each share you hold is worth more tokens than when the vault was first seeded. Your total value is preserved; only the number of shares differs.

**Q: Why did I receive fewer tokens than I deposited when I withdrew?**  
A: Two possible reasons:
1. The share price was below 1.0 (unlikely — would require negative yield).
2. Integer rounding took 1 token less than the theoretical maximum — this is normal. The dust benefits remaining shareholders.

**Q: How often does yield compound?**  
A: Yield is injected by a keeper wallet calling `harvest`. The frequency depends on the vault operator. The vault itself does not impose a schedule — compounding can happen as often as needed.

**Q: How do I see my transaction history?**  
A: The **Transaction History** panel on the dashboard shows your recent deposits and withdrawals. You can also look up your wallet address on [Stellar Expert](https://stellar.expert) or [Horizon](https://horizon.stellar.org) for full on-chain history.

**Q: What wallets are supported?**  
A: Freighter is the primary supported wallet. Other Stellar wallets that expose a compatible API may work but are not officially tested.

**Q: Is there a video walkthrough?**  
A: A video walkthrough is in production. Check the repository README for the latest link once it is published.

**Q: How do I report a bug or get help?**  
A: Open an issue on the [GitHub repository](https://github.com/soterika/aura-vault-protocol). For urgent security issues, follow the responsible disclosure process in [SECURITY.md](../SECURITY.md).

**Q: Are there other languages available?**  
A: The app UI is available in English, Spanish (`es`), French (`fr`), Arabic (`ar`), German (`de`), and Chinese Simplified (`zh`). Use the language switcher in the top-right corner. This guide will be translated to match.
