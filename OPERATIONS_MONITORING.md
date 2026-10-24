# Operations & Monitoring Guide

## Loki log-based alerts

`monitoring/loki/rules.yaml` defines Loki Ruler alerts for route-level backend
error spikes, invalid-token bursts, PostgreSQL connection refusals, Horizon
timeouts, and BullMQ job failures. Promtail normalizes Pino's numeric log
levels before Loki evaluates the rules. Loki sends warning alerts to Slack and
critical alerts to both Slack and PagerDuty through Alertmanager. Configure
`SLACK_WEBHOOK_URL` and `PAGERDUTY_ROUTING_KEY` as deployment secrets before
enabling production notifications. The Compose configuration reads the same
variables from the environment.

Before deploying Loki to Kubernetes, publish the rule file as the ConfigMap
mounted by `k8s/loki-deployment.yaml`:

```bash
kubectl create configmap loki-alert-rules -n monitoring \
  --from-file=aura-alerts.yaml=monitoring/loki/rules.yaml \
  --dry-run=client -o yaml | kubectl apply -f -
```

The rule thresholds are intentionally independent of Prometheus metrics so
log-only failures can page the operations channel before metric collection
catches up. To validate them, inject representative structured log records in
a staging environment and confirm the corresponding alert appears in
Alertmanager and reaches the configured receivers. Do not perform this
injection against production. GitHub issues cannot be assigned directly to a
team; Terraform drift issues receive the `devops` and `infrastructure` labels
so the DevOps team can subscribe to that queue.

## Terraform drift checks

`.github/workflows/terraform-drift-check.yml` runs daily at 06:00 UTC and can
also be started manually. It runs refresh-only plans against staging and
production, uploads the plan output, and creates or comments on one open issue
per environment when it detects drift. Drift issues include a plan excerpt
capped at 4,000 characters and carry `devops` and `infrastructure` labels. The
workflow is report-only; it never applies a plan. It assumes the
`TF_CI_ROLE_ARN` GitHub Actions secret trusts the repository's OIDC provider.

Comprehensive monitoring and alerting setup for Aura Vault Protocol production deployment.

## Overview

Production monitoring tracks:
- Contract state health
- Transaction success rates
- User activity metrics
- System performance
- Security events

## Monitoring Infrastructure

### 1. Stellar Expert (Free)

Dashboard: https://mainnet.steexp.com/contract/{CONTRACT_ID}

Provides:
- Transaction history
- Event logs
- Account balances
- Gas costs

**Setup**: Just bookmark your contract ID URL.

### 2. Prometheus + Grafana (Recommended)

#### Deploy Prometheus

```bash
# docker-compose.monitoring.yml
version: '3.8'
services:
  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    ports:
      - "9090:9090"
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    volumes:
      - grafana_data:/var/lib/grafana
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin

volumes:
  prometheus_data:
  grafana_data:
```

Start:
```bash
docker-compose -f docker-compose.monitoring.yml up -d
```

Access:
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3000 (admin/admin)

#### Configure Prometheus Scraper

Create `monitoring/prometheus.yml`:

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'aura-vault-api'
    static_configs:
      - targets: ['localhost:8080']
    metrics_path: '/metrics'
    scrape_interval: 30s

  - job_name: 'stellar-ledger'
    static_configs:
      - targets: ['soroban-mainnet.stellar.org:443']
```

### 3. Monitoring Backend Service

Create `backend/monitoring.ts`:

```typescript
import express from 'express';
import { SorobanClient } from '@stellar/js-sdk';

const app = express();
const client = new SorobanClient({
  network: 'mainnet',
  rpcUrl: 'https://soroban-mainnet.stellar.org'
});

interface VaultMetrics {
  totalAssets: bigint;
  totalShares: bigint;
  exchangeRate: number;
  lastHarvest: number;
  paused: boolean;
  ledgerVersion: number;
  timestamp: number;
}

app.get('/metrics', async (req, res) => {
  try {
    const metrics = await collectMetrics();
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function collectMetrics(): Promise<VaultMetrics> {
  const CONTRACT_ID = process.env.CONTRACT_ID;
  
  const totalAssets = await client.contractInvoke(CONTRACT_ID, 'total_assets');
  const isPaused = await client.contractInvoke(CONTRACT_ID, 'is_paused');
  const ledger = await client.getLedger();
  
  return {
    totalAssets: BigInt(totalAssets),
    totalShares: BigInt(0), // Query total_shares if exposed
    exchangeRate: Number(totalAssets) / 1e7,
    lastHarvest: Date.now(),
    paused: isPaused,
    ledgerVersion: ledger.sequence,
    timestamp: Date.now()
  };
}

app.listen(8080, () => console.log('Monitoring server on :8080'));
```

## Key Metrics to Monitor

### Contract Health

| Metric | Alert Threshold | Action |
|--------|------------------|--------|
| `total_assets` | Decreases unexpectedly | Investigate token transfer logs |
| `is_paused()` | Returns `true` | Check admin action, verify intentional |
| Exchange rate | Drops >5% | Review harvests and withdrawals |
| Failed deposits | >2% of attempts | Check token balance, allowances |

### Transaction Success

| Metric | Alert Threshold | Action |
|--------|------------------|--------|
| Deposit success rate | <95% | Monitor token contract |
| Harvest success rate | <90% | Check yield source |
| Withdrawal success rate | <98% | Verify vault has liquidity |
| Avg TX fee (stroops) | >50,000 | Network congestion |

### System Performance

| Metric | Alert Threshold | Action |
|--------|------------------|--------|
| RPC response time | >2s | Check RPC node health |
| Ledger close time | >5s | Stellar network issue |
| Contract state size | >10KB | Check data growth |
| Memory usage (backend) | >1GB | Restart service |

### Security Events

| Event | Response |
|-------|----------|
| Unauthorized deposit attempt | Page admin, log incident |
| Admin key rotation detected | Verify in governance votes |
| Mass withdrawal spike | Freeze deposits (if configured) |
| Balance mismatch detected | Trigger emergency procedures |

## Alert Configuration

### Grafana Alert Rules

```yaml
groups:
  - name: AuraVault
    interval: 30s
    rules:
      - alert: TotalAssetsDecreasing
        expr: rate(aura_total_assets[5m]) < 0
        for: 10m
        annotations:
          summary: "Vault assets decreasing"

      - alert: HighFailureRate
        expr: rate(aura_failed_deposits[5m]) > 0.05
        for: 5m
        annotations:
          summary: "Deposit failure rate > 5%"

      - alert: VaultPaused
        expr: aura_vault_paused == 1
        for: 1m
        annotations:
          summary: "Vault is paused - verify intent"
```

### Notification Channels

Configure in Grafana:

1. **Email** (admin alerts)
   - Vault paused
   - Balance mismatches
   - High failure rates

2. **Slack** (team channel)
   - All alerts
   - With @channel ping for critical

3. **PagerDuty** (on-call escalation)
   - Critical issues only
   - Auto-escalate after 15 min

## Logging Setup

### Structured Logging (Backend)

```typescript
import { createLogger, format, transports } from 'winston';

const logger = createLogger({
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()
  ),
  defaultMeta: { service: 'aura-vault' },
  transports: [
    new transports.File({ filename: 'error.log', level: 'error' }),
    new transports.File({ filename: 'combined.log' }),
    new transports.Console({
      format: format.simple()
    })
  ]
});

// Log contract events
logger.info('Deposit completed', {
  user: userAddress,
  amount: depositAmount,
  shares: sharesIssued,
  contractId: CONTRACT_ID
});
```

### Log Aggregation (ELK Stack)

Optional but recommended for production:

```yaml
# docker-compose.monitoring.yml addition
elasticsearch:
  image: docker.elastic.co/elasticsearch/elasticsearch:8.0.0
  environment:
    - discovery.type=single-node
    - xpack.security.enabled=false
  ports:
    - "9200:9200"

kibana:
  image: docker.elastic.co/kibana/kibana:8.0.0
  ports:
    - "5601:5601"
  depends_on:
    - elasticsearch
```

## Health Check Endpoints

Add to backend:

```typescript
app.get('/health', async (req, res) => {
  const checks = {
    database: await checkDatabase(),
    contract: await checkContract(),
    rpc: await checkRPC(),
    timestamp: new Date().toISOString()
  };

  const healthy = Object.values(checks).every(c => c === true);
  res.status(healthy ? 200 : 503).json(checks);
});

async function checkContract(): Promise<boolean> {
  try {
    const result = await client.contractInvoke(CONTRACT_ID, 'total_assets');
    return result !== undefined;
  } catch {
    return false;
  }
}
```

## Dashboard Setup

### Pre-built Grafana Dashboard

Import JSON:

```json
{
  "dashboard": {
    "title": "Aura Vault Mainnet",
    "panels": [
      {
        "title": "Total Assets",
        "targets": [{ "expr": "aura_total_assets" }]
      },
      {
        "title": "Daily Deposits",
        "targets": [{ "expr": "increase(aura_deposits[24h])" }]
      },
      {
        "title": "Success Rates",
        "targets": [
          { "expr": "rate(aura_successful_deposits[5m])" },
          { "expr": "rate(aura_successful_withdrawals[5m])" }
        ]
      }
    ]
  }
}
```

## On-Call Runbook

See INCIDENT_RESPONSE.md for detailed procedures.

Quick reference:

1. **Vault Paused** → Check admin governance votes
2. **High Failures** → Verify token contract status
3. **Balance Mismatch** → Activate emergency mode
4. **RPC Down** → Failover to backup RPC node

## Maintenance Schedule

- **Daily**: Review health dashboard
- **Weekly**: Check logs for anomalies
- **Monthly**: Verify alert thresholds are appropriate
- **Quarterly**: Update documentation, test failover

## Cost Estimate

- Stellar Expert: Free
- Prometheus + Grafana: Free (self-hosted)
- ELK Stack: ~$200/month (managed)
- PagerDuty: ~$50/month
- Total: $50-250/month depending on scale
