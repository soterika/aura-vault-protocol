# Aura Vault - Python Integration

## Installation

```bash
pip install stellar-sdk
```

## Setup Client

```python
from stellar_sdk import (
    Keypair, 
    Network, 
    SorobanServer, 
    TransactionBuilder,
    Address,
    Soroban,
)

CONTRACT_ID = 'CABC...'  # Your deployed contract
TOKEN_ID = 'CAEF...'     # SEP-41 token contract
ADMIN_SECRET = 'S...'
USER_SECRET = 'S...'

admin_keypair = Keypair.from_secret(ADMIN_SECRET)
user_keypair = Keypair.from_secret(USER_SECRET)

server = SorobanServer('https://soroban-testnet.stellar.org')
network = Network.testnet_network()
```

## Initialize Vault

```python
def initialize_vault(admin_keypair, token_id):
    admin = Address(admin_keypair.public_key)
    token = Address(token_id)
    
    soroban = Soroban(CONTRACT_ID)
    call_op = soroban.call('initialize', admin, token)
    
    account = server.get_account(admin_keypair.public_key)
    tx = (
        TransactionBuilder(account, network, base_fee=100000)
        .add_text_memo('Initialize Aura Vault')
        .append_operation(call_op)
        .set_timeout(300)
        .build()
    )
    
    tx.sign(admin_keypair)
    resp = server.submit_transaction(tx)
    print(f'Init TX: {resp.get("hash")}')
    return resp

# Usage
initialize_vault(admin_keypair, TOKEN_ID)
```

## Deposit into Vault

```python
def deposit(user_keypair, amount):
    caller = Address(user_keypair.public_key)
    
    soroban = Soroban(CONTRACT_ID)
    call_op = soroban.call('deposit', caller, amount)
    
    account = server.get_account(user_keypair.public_key)
    tx = (
        TransactionBuilder(account, network, base_fee=100000)
        .add_text_memo(f'Deposit {amount} tokens')
        .append_operation(call_op)
        .set_timeout(300)
        .build()
    )
    
    tx.sign(user_keypair)
    resp = server.submit_transaction(tx)
    print(f'Deposit TX: {resp.get("hash")}')
    return resp

# Usage
deposit(user_keypair, 1000000)
```

## Withdraw from Vault

```python
def withdraw(user_keypair, shares):
    caller = Address(user_keypair.public_key)
    
    soroban = Soroban(CONTRACT_ID)
    call_op = soroban.call('withdraw', caller, shares)
    
    account = server.get_account(user_keypair.public_key)
    tx = (
        TransactionBuilder(account, network, base_fee=100000)
        .add_text_memo(f'Withdraw {shares} shares')
        .append_operation(call_op)
        .set_timeout(300)
        .build()
    )
    
    tx.sign(user_keypair)
    resp = server.submit_transaction(tx)
    print(f'Withdraw TX: {resp.get("hash")}')
    return resp

# Usage
withdraw(user_keypair, 500000)
```

## Harvest Yield

```python
def harvest(keeper_keypair, yield_amount):
    caller = Address(keeper_keypair.public_key)
    
    soroban = Soroban(CONTRACT_ID)
    call_op = soroban.call('harvest', caller, yield_amount)
    
    account = server.get_account(keeper_keypair.public_key)
    tx = (
        TransactionBuilder(account, network, base_fee=100000)
        .add_text_memo(f'Harvest {yield_amount} tokens')
        .append_operation(call_op)
        .set_timeout(300)
        .build()
    )
    
    tx.sign(keeper_keypair)
    resp = server.submit_transaction(tx)
    print(f'Harvest TX: {resp.get("hash")}')
    return resp

# Usage
harvest(keeper_keypair, 100000)
```

## Query Total Assets

```python
def get_total_assets():
    soroban = Soroban(CONTRACT_ID)
    result = server.soroban_rpc_call(
        'simulateTransaction',
        {
            'transaction': soroban.call('total_assets').to_xdr()
        }
    )
    
    # Extract and parse result
    total_assets = parse_int_from_result(result)
    print(f'Total assets in vault: {total_assets}')
    return total_assets

# Usage
total = get_total_assets()
```

## Query Share Balance

```python
def get_balance(address):
    user_addr = Address(address)
    
    soroban = Soroban(CONTRACT_ID)
    result = server.soroban_rpc_call(
        'simulateTransaction',
        {
            'transaction': soroban.call('balance_of', user_addr).to_xdr()
        }
    )
    
    # Extract and parse result
    balance = parse_int_from_result(result)
    print(f'User shares: {balance}')
    return balance

# Usage
shares = get_balance(user_keypair.public_key)
```

## Helper Functions

```python
def parse_int_from_result(result):
    """Extract i128 value from Soroban RPC result"""
    try:
        return int(result['result']['retval']['i128']['value'])
    except (KeyError, TypeError):
        raise ValueError('Failed to parse result')

def get_exchange_rate():
    """Calculate current share exchange rate"""
    total_assets = get_total_assets()
    total_shares = get_total_shares()  # Implement if needed
    
    if total_shares == 0:
        return 1.0
    
    return total_assets / total_shares
```

## Error Handling

```python
ERROR_CODES = {
    1: 'NotInitialized',
    2: 'AlreadyInitialized',
    3: 'InsufficientShares',
    4: 'InsufficientUnderlying',
    5: 'ZeroAmount',
    6: 'MathOverflow',
    7: 'InvalidAddress',
    8: 'ZeroShares',
    9: 'UpgradeUnauthorized',
    10: 'StorageLayoutMismatch',
}

def deposit_with_error_handling(user_keypair, amount):
    try:
        result = deposit(user_keypair, amount)
        return result
    except Exception as e:
        error_msg = str(e)
        # Parse error code from message
        for code, name in ERROR_CODES.items():
            if name in error_msg:
                print(f'Error {code}: {name}')
                return None
        print(f'Unknown error: {error_msg}')
        return None
```

## Complete Client Class

```python
class AuraVaultClient:
    def __init__(self, contract_id, server_url='https://soroban-testnet.stellar.org'):
        self.contract_id = contract_id
        self.server = SorobanServer(server_url)
        self.network = Network.testnet_network()
    
    def deposit(self, keypair, amount):
        return deposit(keypair, amount)
    
    def withdraw(self, keypair, shares):
        return withdraw(keypair, shares)
    
    def harvest(self, keeper_keypair, yield_amount):
        return harvest(keeper_keypair, yield_amount)
    
    def get_total_assets(self):
        return get_total_assets()
    
    def get_balance(self, address):
        return get_balance(address)
    
    def get_exchange_rate(self):
        return get_exchange_rate()

# Usage
vault = AuraVaultClient('CABC...')
vault.deposit(user_keypair, 1000000)
balance = vault.get_balance(user_keypair.public_key)
print(f'Your shares: {balance}')
```

## Example: Monitor and Harvest

```python
import time

def monitor_and_harvest(keeper_keypair, check_interval=3600):
    """Periodically harvest yield every check_interval seconds"""
    while True:
        try:
            total_assets = get_total_assets()
            print(f'[{time.strftime("%Y-%m-%d %H:%M:%S")}] Total assets: {total_assets}')
            
            # Simulate finding yield (in real scenario, query yield source)
            yield_found = total_assets * 0.01  # 1% yield
            if yield_found > 0:
                harvest(keeper_keypair, int(yield_found))
                print(f'Harvested: {yield_found} tokens')
            
            time.sleep(check_interval)
        except Exception as e:
            print(f'Error in harvest loop: {e}')
            time.sleep(60)  # Retry after 1 minute

# Usage (runs in background)
# monitor_and_harvest(keeper_keypair)
```
