# Incident Response Playbook

## Severity Levels

| Level | Description | Response Time | Example |
|---|---|---|---|
| P0 | Complete outage, data loss risk | 15 min | Vault inaccessible, DB down |
| P1 | Major feature broken | 30 min | Withdrawals failing |
| P2 | Degraded performance | 2 hours | High latency, partial errors |
| P3 | Minor issue | Next business day | Cosmetic bug |

## Response Steps

### 1. Acknowledge (< 15 min for P0/P1)
- Acknowledge in PagerDuty
- Post in `#incidents` Slack channel: "Investigating [brief description]"

### 2. Assess
```bash
# Check service health
curl https://api.aura-vault.xyz/health

# Check ECS tasks
aws ecs list-tasks --cluster aura-vault-prod --desired-status RUNNING

# Check RDS
aws rds describe-db-instances --db-instance-identifier aura-vault-prod \
  --query 'DBInstances[0].DBInstanceStatus'

# Check recent CloudWatch errors
aws logs filter-log-events \
  --log-group-name /ecs/aura-vault-backend \
  --start-time $(date -d '30 minutes ago' +%s000) \
  --filter-pattern ERROR
```

### 3. Mitigate
- **If DB unreachable**: follow `runbook.md` restore procedure
- **If high error rate**: rollback ECS task definition to previous revision
  ```bash
  aws ecs update-service --cluster aura-vault-prod --service backend \
    --task-definition aura-vault-backend:<previous-revision>
  ```
- **If vault contract issue**: call `pause()` via admin keypair, notify users

### 4. Communicate
- Update status page (statuspage.io) within 30 min of P0
- Send user email within 1 hour using template below
- Post bridge update every 30 min in `#incidents`

### 5. Resolve & Post-mortem
- Mark incident resolved in PagerDuty
- File post-mortem within 48 hours: timeline, root cause, action items

---

## Communication Templates

### Status Page — Incident Detected
```
Title: Service Disruption — [Service Name]
Status: Investigating
Body: We are currently investigating reports of [brief description].
Our team has been alerted and is actively investigating.
We will provide an update within 30 minutes.
```

### Status Page — Resolved
```
Title: Service Disruption — Resolved
Status: Resolved
Body: The issue affecting [service] has been resolved as of [time UTC].
Root cause: [1 sentence]. All systems are operating normally.
```

### User Email — Major Incident
```
Subject: [Action Required / FYI] Aura Vault Service Disruption

We experienced a service disruption from [start time] to [end time] UTC
affecting [what was impacted].

Your funds are safe. [If true: No user data or funds were lost.]

What happened: [1–2 sentences]
What we did: [1–2 sentences]
What we're doing to prevent recurrence: [1 sentence]

We apologize for the inconvenience.
— Aura Vault Team
```

### Slack — Initial Alert
```
🚨 *P[0/1] Incident: [Title]*
• Impact: [who/what is affected]
• Started: [time UTC]
• Incident commander: @[name]
• Bridge: [link]
• Status page: [link]
```
