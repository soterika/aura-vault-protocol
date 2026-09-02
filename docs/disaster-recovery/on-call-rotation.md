# On-Call Rotation

## Schedule
Weekly rotation, Monday 09:00 UTC handoff.

| Week | Primary | Secondary | Escalation |
|---|---|---|---|
| Template | Engineer A | Engineer B | Engineering Lead |

Configure actual rotation in PagerDuty: `aura-vault-oncall` schedule.

## Handoff Checklist
- [ ] Review open incidents and ongoing mitigations
- [ ] Confirm PagerDuty alerts route to your number
- [ ] Verify access to: AWS Console, PagerDuty, Grafana, Slack `#incidents`
- [ ] Review last 7 days of alerts in Grafana

## Escalation Path
1. On-call engineer (immediate)
2. Secondary on-call (after 15 min no ack)
3. Engineering Lead (after 30 min P0/P1 unresolved)
4. CTO (after 60 min P0 unresolved)

## Required Access
- AWS IAM role: `aura-vault-oncall-readonly` (read) + `aura-vault-incident-response` (break-glass)
- Grafana: viewer role minimum
- PagerDuty: responder role
- Secrets: emergency access via `aws sts assume-role --role-arn arn:aws:iam::<account>:role/aura-vault-break-glass`
