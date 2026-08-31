## Webhook Signature Verification

Every webhook POST request sent by Aura Vault is signed with **HMAC-SHA256** using the secret you provided when registering the endpoint. You should always verify this signature before processing a webhook payload to ensure the request genuinely came from Aura Vault and was not tampered with in transit.

### How It Works

When Aura Vault delivers a webhook, it computes:

```
HMAC-SHA256(secret, raw_request_body)
```

and sends the result in the `X-Aura-Signature` header as a hex-encoded string prefixed with `sha256=`:

```
X-Aura-Signature: sha256=<hex digest>
```

To verify, compute the same HMAC on your side using the **raw request body bytes** (before any JSON parsing) and compare with a timing-safe equality function to prevent timing attacks.

### Request Headers

| Header | Description |
|---|---|
| `X-Aura-Signature` | `sha256=<hex>` — HMAC-SHA256 of the raw request body, signed with your webhook secret |
| `X-Aura-Event` | The event type that triggered the delivery (e.g. `deposit`, `withdraw`, `harvest`, `pause`, `unpause`, `upgrade`, `suspicious`) |
| `X-Aura-Delivery` | A unique UUID identifying this specific delivery attempt |

### Verification Examples

#### JavaScript (Node.js)

```js
const crypto = require('crypto');

function verifySignature(secret, rawBody, signature) {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Express example — use express.raw() to capture the raw body bytes
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-aura-signature'];
  if (!verifySignature(process.env.WEBHOOK_SECRET, req.body, signature)) {
    return res.status(401).send('Invalid signature');
  }
  const event = JSON.parse(req.body.toString());
  // process event...
  res.sendStatus(200);
});
```

#### Python

```python
import hmac
import hashlib

def verify_signature(secret: str, raw_body: bytes, signature: str) -> bool:
    expected = 'sha256=' + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)

# Flask example — use request.get_data() for the raw body
from flask import Flask, request, abort
app = Flask(__name__)

@app.route('/webhook', methods=['POST'])
def webhook():
    signature = request.headers.get('X-Aura-Signature', '')
    raw_body = request.get_data()
    if not verify_signature(os.environ['WEBHOOK_SECRET'], raw_body, signature):
        abort(401)
    event = request.get_json()
    # process event...
    return '', 200
```

#### Ruby

```ruby
require 'openssl'

def verify_signature(secret, raw_body, signature)
  expected = 'sha256=' + OpenSSL::HMAC.hexdigest('SHA256', secret, raw_body)
  ActiveSupport::SecurityUtils.secure_compare(expected, signature)
end

# Rails example
class WebhooksController < ApplicationController
  skip_before_action :verify_authenticity_token

  def receive
    raw_body = request.body.read
    signature = request.headers['X-Aura-Signature']
    unless verify_signature(ENV['WEBHOOK_SECRET'], raw_body, signature)
      render json: { error: 'Invalid signature' }, status: :unauthorized and return
    end
    event = JSON.parse(raw_body)
    # process event...
    head :ok
  end
end
```

### Testing Your Receiver

Use the `/api/webhooks/test` endpoint to send a real signed POST to your receiver URL without waiting for an actual vault event. This is useful for verifying that your endpoint is reachable and that your signature verification code works correctly.

**Endpoint:** `POST /api/webhooks/test`

**Authentication:** Requires a valid Bearer token in the `Authorization` header.

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `url` | string | Yes | The receiver URL to send the test delivery to |
| `secret` | string | Yes | The HMAC secret to sign the payload with |
| `payload` | object | No | Custom JSON payload. Defaults to `{ "test": true, "timestamp": "<ISO 8601>" }` |

**Example request:**

```bash
curl -X POST https://your-backend/api/webhooks/test \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-receiver.example.com/webhook",
    "secret": "your-webhook-secret"
  }'
```

**Success response (`200 OK`):**

```json
{
  "delivered": true,
  "statusCode": 200
}
```

**Failure response (`200 OK` with `delivered: false`):**

```json
{
  "delivered": false,
  "error": "connect ECONNREFUSED 127.0.0.1:9999"
}
```

**Validation error (`400 Bad Request`):**

```json
{ "error": "url is required" }
```

### Important: Use the Raw Body

Always capture the **raw request body bytes** before parsing JSON. If you parse JSON first and then re-serialize to compute the HMAC, the byte representation may differ (key ordering, whitespace) and verification will fail.

- **Node.js/Express:** Use `express.raw({ type: 'application/json' })` on the route, not `express.json()`.
- **Python/Flask:** Use `request.get_data()` before `request.get_json()`.
- **Ruby/Rails:** Use `request.body.read` before any parsing.
