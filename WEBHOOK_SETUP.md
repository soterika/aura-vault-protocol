# Aura Vault - Webhook Setup & Event Monitoring

## Overview

Monitor Aura Vault events by indexing contract transactions and trigger webhooks for key operations:
- Deposits
- Withdrawals  
- Harvests
- Admin upgrades

## Event Tracking Architecture

### Option 1: Stellar Horizon + Custom Indexer

Index contract invocations and maintain event state:

```python
# webhook_indexer.py
from stellar_sdk import AdjustmentFlag, Memo, Account, TransactionBuilder, Server
import requests
import time

class VaultEventIndexer:
    def __init__(self, contract_id, webhook_url):
        self.contract_id = contract_id
        self.webhook_url = webhook_url
        self.server = Server('https://horizon-testnet.stellar.org')
        self.cursor = 'now'
    
    def start_polling(self, interval=10):
        """Poll for new transactions"""
        while True:
            try:
                self.poll_transactions()
                time.sleep(interval)
            except Exception as e:
                print(f'Polling error: {e}')
                time.sleep(5)
    
    def poll_transactions(self):
        """Fetch and process recent transactions"""
        txs = self.server.transactions() \
            .for_account(self.contract_id) \
            .cursor(self.cursor) \
            .order(desc=False) \
            .limit(100) \
            .call()
        
        for tx in txs['_embedded']['records']:
            self.process_transaction(tx)
            self.cursor = tx['paging_token']
    
    def process_transaction(self, tx):
        """Extract and send events"""
        if tx['result_code'] != 'tx_success':
            return
        
        # Parse operations
        ops = tx['operations']
        for op in ops:
            if op['type'] == 'invoke_host_function':
                self.handle_vault_operation(tx, op)
    
    def handle_vault_operation(self, tx, op):
        """Route to appropriate webhook"""
        # Simplified: in production, parse XDR envelope
        function_name = self.extract_function_name(op)
        
        event_data = {
            'timestamp': tx['created_at'],
            'tx_hash': tx['hash'],
            'function': function_name,
            'success': True,
        }
        
        self.send_webhook(event_data)
    
    def extract_function_name(self, op):
        # Parse XDR to get function name
        # Returns: 'deposit', 'withdraw', 'harvest', etc.
        return 'unknown'
    
    def send_webhook(self, event_data):
        """POST to webhook URL"""
        try:
            requests.post(
                self.webhook_url,
                json=event_data,
                headers={'Content-Type': 'application/json'},
                timeout=5
            )
            print(f'Webhook sent: {event_data}')
        except Exception as e:
            print(f'Webhook failed: {e}')

# Usage
indexer = VaultEventIndexer('CABC...', 'https://your-server.com/webhooks/vault')
indexer.start_polling(interval=10)
```

### Option 2: Webhook Receiver (Your Backend)

```python
# webhook_receiver.py
from flask import Flask, request, jsonify
import hmac
import hashlib
import json

app = Flask(__name__)
WEBHOOK_SECRET = 'your-webhook-secret'

def verify_webhook(payload, signature):
    """Verify webhook authenticity using HMAC"""
    expected = hmac.new(
        WEBHOOK_SECRET.encode(),
        payload,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)

@app.route('/webhooks/vault', methods=['POST'])
def vault_webhook():
    signature = request.headers.get('X-Signature')
    payload = request.get_data()
    
    # Verify signature
    if not verify_webhook(payload, signature):
        return jsonify({'error': 'Invalid signature'}), 401
    
    event = request.json
    
    # Route to handlers
    handlers = {
        'deposit': handle_deposit,
        'withdraw': handle_withdraw,
        'harvest': handle_harvest,
        'upgrade': handle_upgrade,
    }
    
    handler = handlers.get(event['function'])
    if handler:
        handler(event)
        return jsonify({'status': 'processed'}), 200
    
    return jsonify({'error': 'Unknown function'}), 400

def handle_deposit(event):
    print(f'Deposit detected: TX={event["tx_hash"]}')
    # Update database, send notifications, etc.

def handle_withdraw(event):
    print(f'Withdrawal detected: TX={event["tx_hash"]}')

def handle_harvest(event):
    print(f'Harvest detected: TX={event["tx_hash"]}')

def handle_upgrade(event):
    print(f'Contract upgraded: TX={event["tx_hash"]}')

if __name__ == '__main__':
    app.run(port=5000)
```

## Event Schema

### Deposit Event
```json
{
  "timestamp": "2024-06-25T03:48:19Z",
  "tx_hash": "abc123...",
  "function": "deposit",
  "caller": "GUSER...",
  "amount": 1000000,
  "shares_minted": 1000000,
  "success": true
}
```

### Withdrawal Event
```json
{
  "timestamp": "2024-06-25T03:48:19Z",
  "tx_hash": "abc123...",
  "function": "withdraw",
  "caller": "GUSER...",
  "shares_burned": 500000,
  "tokens_redeemed": 500000,
  "success": true
}
```

### Harvest Event
```json
{
  "timestamp": "2024-06-25T03:48:19Z",
  "tx_hash": "abc123...",
  "function": "harvest",
  "keeper": "GKEEPER...",
  "yield_amount": 100000,
  "success": true
}
```

### Upgrade Event
```json
{
  "timestamp": "2024-06-25T03:48:19Z",
  "tx_hash": "abc123...",
  "function": "upgrade",
  "admin": "GADMIN...",
  "new_wasm_hash": "abcd...",
  "success": true
}
```

## Webhook Configuration

Store in environment variables:

```bash
# .env
VAULT_WEBHOOK_URL=https://your-server.com/webhooks/vault
VAULT_WEBHOOK_SECRET=your-secure-secret
VAULT_CONTRACT_ID=CABC123...
VAULT_NETWORK=testnet
```

## Retry Logic

Implement exponential backoff for webhook failures:

```python
import time

def send_webhook_with_retry(event_data, max_retries=3):
    for attempt in range(max_retries):
        try:
            response = requests.post(
                WEBHOOK_URL,
                json=event_data,
                timeout=5
            )
            if response.status_code == 200:
                return True
            
            # Exponential backoff: 1s, 2s, 4s
            wait_time = 2 ** attempt
            print(f'Retry {attempt + 1} after {wait_time}s')
            time.sleep(wait_time)
        
        except requests.RequestException as e:
            print(f'Attempt {attempt + 1} failed: {e}')
    
    # Log to dead-letter queue
    log_failed_event(event_data)
    return False
```

## Monitoring Dashboard

Track vault activity:

```python
# dashboard.py
from flask import Flask, render_template
import json

app = Flask(__name__)

# In-memory event log (use database in production)
events = []

@app.route('/dashboard')
def dashboard():
    stats = {
        'total_deposits': len([e for e in events if e['function'] == 'deposit']),
        'total_withdrawals': len([e for e in events if e['function'] == 'withdraw']),
        'total_harvests': len([e for e in events if e['function'] == 'harvest']),
        'recent_events': sorted(events, key=lambda x: x['timestamp'], reverse=True)[:10],
    }
    return render_template('dashboard.html', stats=stats)

if __name__ == '__main__':
    app.run(port=8080)
```

## Testing Webhooks Locally

Use ngrok to expose local endpoint:

```bash
# Terminal 1: Run your receiver
python webhook_receiver.py

# Terminal 2: Expose to internet
ngrok http 5000

# Terminal 3: Test webhook delivery
curl -X POST https://your-ngrok-url.ngrok.io/webhooks/vault \
  -H "Content-Type: application/json" \
  -d '{
    "timestamp": "2024-06-25T03:48:19Z",
    "tx_hash": "test123",
    "function": "deposit",
    "caller": "GUSER...",
    "amount": 1000000,
    "shares_minted": 1000000,
    "success": true
  }'
```

## Production Checklist

- [ ] Webhook receiver deployed on HTTPS
- [ ] HMAC signatures implemented and verified
- [ ] Retry logic with exponential backoff configured
- [ ] Dead-letter queue for failed events
- [ ] Rate limiting configured
- [ ] Webhook payload logging for audits
- [ ] Monitoring/alerting on delivery failures
- [ ] Database persistence for events
- [ ] Timestamp validation against clock skew
