# Secrets Management and Key Rotation Procedures

This document describes how Aura Vault manages, stores, and rotates secrets in production. All secrets are managed through AWS Secrets Manager. Secret values must never be committed to source code, Terraform variable files, Docker images, CI environment variables, or ticket attachments.

---

## Table of Contents

1. [Secrets Inventory](#secrets-inventory)
2. [Storage Locations and ARNs](#storage-locations-and-arns)
3. [Rotation Schedule and Procedures](#rotation-schedule-and-procedures)
4. [Emergency Revocation Procedure](#emergency-revocation-procedure)
5. [Least-Privilege IAM Policy](#least-privilege-iam-policy)
6. [Audit Logging](#audit-logging)
7. [Local Development](#local-development)
8. [Creating and Updating Secret Values](#creating-and-updating-secret-values)

---

## Secrets Inventory

The table below lists every secret managed by the platform. Values are never shown here; only key names and purpose.

### Application Secrets (`aura-vault/{env}/app`)

| Key Name | Type | Purpose | Rotated |
|---|---|---|---|
| `SENDGRID_API_KEY` | API key | Transactional email delivery via SendGrid | Yes — 30 days |
| `MAILGUN_API_KEY` | API key | Transactional email delivery via Mailgun (failover) | Yes — 30 days |
| `MAILGUN_DOMAIN` | String | Mailgun sending domain (e.g. `mail.aura-vault.xyz`) | No (not a secret, but co-located) |
| `JWT_SECRET` | 256-bit random | Signs and verifies JWT session tokens | Yes — 30 days |
| `UNSUBSCRIBE_SECRET` | 256-bit random | Signs unsubscribe link tokens in emails | Yes — 30 days |
| `WEBHOOK_SIGNING_KEYS` | JSON array of strings | HMAC keys for outbound webhook signing; multiple keys support key rollover | Yes — 30 days |

### Database Secrets (`aura-vault/{env}/database/master`)

| Key Name | Type | Purpose | Rotated |
|---|---|---|---|
| `username` | String | PostgreSQL master username | No (static, managed by RDS) |
| `password` | 32-char random | PostgreSQL master password | Yes — 30 days |
| `engine` | String | Always `postgres` | No |
| `host` | String | RDS instance endpoint | No (changes only on failover) |
| `port` | Integer | Database port (default 5432) | No |
| `dbname` | String | Database name | No |

### Secrets Not in Secrets Manager (managed separately)

| Secret | Location | Notes |
|---|---|---|
| Stellar admin keypair | Hardware Security Module or KMS | Controls contract `pause`, `upgrade`, and governance admin functions; never stored in Secrets Manager |
| Stellar governance signers | Each signer's own custody | Multisig keys; not centrally stored |
| AWS IAM access keys | EC2 instance profile (no static keys) | Backend uses instance profile — no static `AWS_ACCESS_KEY_ID` |
| TLS/SSL certificates | AWS Certificate Manager | Managed by ACM; auto-renewed |

---

## Storage Locations and ARNs

Each environment has isolated secrets with the following naming convention:

```
arn:aws:<region>:<account-id>:secret:aura-vault/<env>/app-<suffix>
arn:aws:<region>:<account-id>:secret:aura-vault/<env>/database/master-<suffix>
```

| Environment | App Secret Path | DB Secret Path |
|---|---|---|
| dev | `aura-vault/dev/app` | `aura-vault/dev/database/master` |
| staging | `aura-vault/staging/app` | `aura-vault/staging/database/master` |
| prod | `aura-vault/prod/app` | `aura-vault/prod/database/master` |

To look up the full ARN for the current environment:

```bash
aws secretsmanager describe-secret \
  --secret-id aura-vault/prod/app \
  --query 'ARN' \
  --output text
```

The backend never receives secret values directly in environment variables. It receives only the ARN and fetches values at runtime:

| Env Var | Value | Secret? |
|---|---|---|
| `SECRETS_PROVIDER` | `aws` | No |
| `APP_SECRETS_ID` | ARN of the app secret | No (ARN is not a secret) |
| `DB_SECRET_ID` | ARN of the database secret | No |
| `AWS_REGION` | e.g. `us-east-1` | No |

---

## Rotation Schedule and Procedures

### Automated Rotation

All app and database secrets rotate automatically every 30 days via an AWS Lambda rotation function. Rotation is configured in `infrastructure/terraform/secrets-rotation/main.tf` and `terraform/secrets.tf`.

| Secret | Rotation Period | Rotation Lambda |
|---|---|---|
| `aura-vault/{env}/app` | 30 days | `aura-vault-secrets-rotation-{env}` |
| `aura-vault/{env}/database/master` | 30 days | `aura-vault-secrets-rotation-{env}` |

The rotation Lambda follows the four-step Secrets Manager rotation pattern: `createSecret` → `setSecret` → `testSecret` → `finishSecret`.

### Manual Rotation — Standard Procedure

Use this procedure when you need to rotate a secret outside the automatic schedule (e.g., after a suspected exposure, before an audit, or after a staff change).

**Prerequisites**

- Access to the `aura-vault-ops` AWS role or the production break-glass role
- MFA enabled on your IAM user
- An incident or change-request ticket number

**Steps**

1. Open a change-request ticket with reason, affected secret name, environment, and expected duration.

2. Confirm the rotation Lambda has the required provider-specific permissions:
   ```bash
   aws lambda get-function-configuration \
     --function-name aura-vault-secrets-rotation-prod \
     --query 'Role'
   ```

3. Trigger immediate rotation:
   ```bash
   aws secretsmanager rotate-secret \
     --secret-id aura-vault/prod/app \
     --rotate-immediately
   ```

4. Monitor the rotation status:
   ```bash
   aws secretsmanager describe-secret \
     --secret-id aura-vault/prod/app \
     --query '{RotationEnabled: RotationEnabled, LastRotatedDate: LastRotatedDate, RotationRules: RotationRules}'
   ```

5. Watch backend logs for successful secret re-fetch (look for `secret_access` events with `result: "miss"` followed by `result: "hit"` on the next request):
   ```bash
   aws logs filter-log-events \
     --log-group-name /aws/aura-vault/prod/secrets-audit \
     --filter-pattern "secret_access"
   ```

6. Verify no authentication or email delivery errors in the 5 minutes following rotation.

7. Close the change-request ticket with a note confirming successful rotation and attaching the relevant log excerpt.

### Rotation for `WEBHOOK_SIGNING_KEYS`

Webhook signing keys are stored as a JSON array to support key rollover (the backend accepts any key in the array). When rotating:

1. Add the new key to the array **before** removing the old one. This prevents webhook delivery failures during rollover.
2. Update the secret with the two-key array.
3. Wait until all in-flight webhooks have been delivered (typically < 5 minutes).
4. Remove the old key from the array and update the secret again.

### Rotation for `JWT_SECRET`

JWT rotation invalidates all active sessions. Coordinate with the team before rotating in production:

1. Announce a maintenance window (sessions will be invalidated).
2. Rotate the secret.
3. All users will be logged out and must re-authenticate.
4. Monitor for any abnormal session error rates in Grafana.

---

## Emergency Revocation Procedure

Use this procedure when a secret is known or suspected to be compromised.

### Severity: Confirmed Exposure

**Act within 15 minutes.**

1. **Disable the compromised credential at the provider level** (do not wait for Secrets Manager):
   - For `SENDGRID_API_KEY`: revoke in the SendGrid dashboard immediately.
   - For `MAILGUN_API_KEY`: revoke in the Mailgun dashboard immediately.
   - For `JWT_SECRET` or `UNSUBSCRIBE_SECRET`: proceed to step 3 — invalidation is via rotation only.
   - For database password: change it in the RDS console immediately.

2. **Trigger immediate rotation** in Secrets Manager:
   ```bash
   aws secretsmanager rotate-secret \
     --secret-id aura-vault/prod/<secret-name> \
     --rotate-immediately
   ```

3. **Invalidate affected sessions / tokens**:
   - For `JWT_SECRET`: all active JWTs are invalid after the rotation. Users must re-authenticate.
   - For `UNSUBSCRIBE_SECRET`: previously sent email unsubscribe links become invalid. Acceptable for a security event.
   - For `WEBHOOK_SIGNING_KEYS`: rotating keys requires webhook consumers to accept the new signature immediately — notify downstream consumers.

4. **Redeploy affected services** to force a cache flush:
   ```bash
   # The backend caches secrets for up to 5 minutes (SECRETS_CACHE_TTL_MS)
   # Restart pods to clear the in-memory cache immediately
   kubectl rollout restart deployment/backend -n aura-vault
   ```

5. **Open a security incident** in the incident management system with:
   - Which secret was exposed
   - How it was exposed (if known)
   - Time of suspected exposure
   - Actions taken and timestamps
   - Impact assessment

6. **Preserve CloudWatch audit logs** from the `/aws/aura-vault/prod/secrets-audit` log group for the window of suspected exposure. Do not delete them.

7. **Rotate any other secrets that shared access** with the compromised credential (e.g., if a developer's IAM session was compromised, rotate all secrets that session could access).

### Severity: Suspected Exposure (Unconfirmed)

1. Open an incident ticket.
2. Pull audit logs to determine if the secret was accessed by an unexpected principal:
   ```bash
   aws logs filter-log-events \
     --log-group-name /aws/aura-vault/prod/secrets-audit \
     --filter-pattern "GetSecretValue" \
     --start-time <epoch-ms-of-suspected-window>
   ```
3. If any unexpected `GetSecretValue` calls are found, escalate to Confirmed Exposure above.
4. If logs are clean, document the investigation and close with no action, or rotate as a precaution if the exposure vector cannot be ruled out.

---

## Least-Privilege IAM Policy

The backend EC2 instance profile is granted only the minimum permissions needed to read secrets. The full policy is defined in `terraform/secrets.tf`.

### Backend Instance Policy (principle of least privilege)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadAppAndDatabaseSecrets",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:DescribeSecret",
        "secretsmanager:GetSecretValue"
      ],
      "Resource": [
        "arn:aws:<region>:<account>:secret:aura-vault/<env>/app-*",
        "arn:aws:<region>:<account>:secret:aura-vault/<env>/database/master-*"
      ]
    }
  ]
}
```

### What the backend is NOT allowed to do

| Action | Reason for exclusion |
|---|---|
| `secretsmanager:CreateSecret` | Secrets are created by Terraform, not the application |
| `secretsmanager:DeleteSecret` | Prevents accidental or malicious deletion |
| `secretsmanager:PutSecretValue` | Application should not write secrets |
| `secretsmanager:RotateSecret` | Rotation is triggered by scheduled Lambda, not the app |
| `secretsmanager:ListSecrets` | Application only needs specific ARNs |

### Human Access Roles

| Role | Environment | Access Level | MFA Required |
|---|---|---|---|
| `aura-vault-developer` | dev, staging | Read-only on dev/staging secrets | Yes |
| `aura-vault-ops` | staging | Read + rotate on staging secrets | Yes |
| `aura-vault-ops-prod` | prod | Read + rotate on prod secrets | Yes + approval |
| `aura-vault-break-glass` | prod | Full access for incident response | Yes + audit log |

Break-glass role access must be logged in the incident management system. Role assumption without an open incident is a policy violation.

### Rotation Lambda Policy

The rotation Lambda has an additional permission to update secret versions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "RotationPermissions",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:DescribeSecret",
        "secretsmanager:GetSecretValue",
        "secretsmanager:PutSecretValue",
        "secretsmanager:UpdateSecretVersionStage"
      ],
      "Resource": [
        "arn:aws:<region>:<account>:secret:aura-vault/<env>/app-*",
        "arn:aws:<region>:<account>:secret:aura-vault/<env>/database/master-*"
      ]
    }
  ]
}
```

---

## Audit Logging

All Secrets Manager API calls are captured in two ways:

### 1. CloudWatch EventBridge (via CloudTrail)

CloudTrail records every `GetSecretValue`, `DescribeSecret`, `RotateSecret`, and `UpdateSecretVersionStage` call. EventBridge forwards these to the log group:

```
/aws/aura-vault/<env>/secrets-audit
```

Log retention is 90 days. Logs are encrypted with the default CloudWatch KMS key.

### 2. Application-Level Audit Events

The backend (`backend/src/secrets.ts`) emits a structured JSON audit event on every secret access:

```json
{
  "event": "secret_access",
  "provider": "aws",
  "secretId": "aura-vault/prod/app",
  "result": "hit",
  "timestamp": "2026-08-24T22:00:00.000Z"
}
```

`result` values:
- `hit` — value served from the in-process cache (5-minute TTL)
- `miss` — fresh value fetched from Secrets Manager
- `error` — fetch failed (look for subsequent error logs)

These events flow into the application log stream and are visible in Grafana's log aggregation dashboard.

---

## Local Development

For local development, the backend supports reading secrets from the process environment:

1. Copy the example file:
   ```bash
   cp backend/.env.example backend/.env.local
   ```

2. Populate `backend/.env.local` with placeholder values (real keys are not required for most local work — mock values are sufficient).

3. Set `SECRETS_PROVIDER=env` in your local `.env.local`. The backend will read directly from the process environment.

The root `.gitignore` blocks `.env` and `.env.*` patterns while preserving checked-in `.env.example` files. Never add a real value to any `.env.example` file.

**Production guard**: The backend will refuse to start with `SECRETS_PROVIDER=env` if `NODE_ENV=production`. This prevents accidental production deployments that bypass Secrets Manager.

---

## Creating and Updating Secret Values

Seed secret values out-of-band so Terraform state never contains actual API keys.

### Initial Seeding

```bash
# 1. Create a temporary JSON file with the actual values (do not commit this file)
cat > /tmp/secrets.prod.json <<'EOF'
{
  "SENDGRID_API_KEY": "<actual-value>",
  "MAILGUN_DOMAIN": "<actual-value>",
  "MAILGUN_API_KEY": "<actual-value>",
  "JWT_SECRET": "<actual-value>",
  "UNSUBSCRIBE_SECRET": "<actual-value>",
  "WEBHOOK_SIGNING_KEYS": "[\"<key-1>\",\"<key-2>\"]"
}
EOF

# 2. Upload to Secrets Manager
aws secretsmanager put-secret-value \
  --secret-id aura-vault/prod/app \
  --secret-string file:///tmp/secrets.prod.json

# 3. Delete the local file immediately
shred -u /tmp/secrets.prod.json
```

### Updating a Single Key

To update a single key without affecting others:

```bash
# Fetch current value
CURRENT=$(aws secretsmanager get-secret-value \
  --secret-id aura-vault/prod/app \
  --query SecretString \
  --output text)

# Merge the updated key (requires jq)
UPDATED=$(echo "$CURRENT" | jq --arg v "<new-value>" '.SENDGRID_API_KEY = $v')

# Write back
aws secretsmanager put-secret-value \
  --secret-id aura-vault/prod/app \
  --secret-string "$UPDATED"

unset CURRENT UPDATED
```

Never print secret values to the terminal in a shared session. Pipe directly to the next command or use process substitution.
