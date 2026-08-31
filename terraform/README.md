# Aura Vault Protocol — AWS Infrastructure

Terraform configuration for the full Aura Vault Protocol AWS stack. All resources are tagged, least-privilege, and designed for multi-AZ high availability.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Module Reference](#module-reference)
  - [VPC & Networking](#vpc--networking)
  - [Security Groups](#security-groups)
  - [Application Load Balancer](#application-load-balancer)
  - [Auto Scaling Group (EC2)](#auto-scaling-group-ec2)
  - [RDS PostgreSQL](#rds-postgresql)
  - [CloudFront CDN](#cloudfront-cdn)
  - [S3 Storage](#s3-storage)
  - [Secrets Manager](#secrets-manager)
  - [CloudWatch Monitoring](#cloudwatch-monitoring)
  - [DNS & Route 53](#dns--route-53)
  - [Backup](#backup)
- [Input Variables](#input-variables)
- [Outputs](#outputs)
- [Cost Estimate](#cost-estimate)
- [Quick Start](#quick-start)
- [Operational Runbook](#operational-runbook)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                               Internet Users                                │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │ HTTPS
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         AWS CloudFront (CDN)                                │
│             Global edge locations • OAC → S3  •  Gzip/Brotli               │
│             Price Class: US/EU/AP  •  TLS 1.2+  •  HSTS                    │
└──────────────────┬──────────────────────────────┬───────────────────────────┘
                   │ /api/*  (dynamic)             │ /* (static)
                   ▼                               ▼
┌──────────────────────────────┐    ┌──────────────────────────────────────────┐
│  Application Load Balancer   │    │     S3 Bucket (static-assets)            │
│  (HTTPS :443 → HTTP :3000)   │    │     Versioning ON • SSE-S3 • OAC-only    │
│  Access logs → S3            │    └──────────────────────────────────────────┘
└──────┬───────────────────────┘
       │  Target group (port 3000)
       │  Health check: GET /api/health
       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           VPC  10.0.0.0/16                                  │
│                                                                             │
│  ┌──────────────── Public Subnets ──────────────────────────────────────┐   │
│  │  us-east-1a  10.0.0.0/24   │  us-east-1b  10.0.1.0/24              │   │
│  │  us-east-1c  10.0.2.0/24                                            │   │
│  │  NAT GW (×3) · Internet GW · ALB nodes                              │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌──────────────── Private Subnets ─────────────────────────────────────┐   │
│  │  us-east-1a  10.0.3.0/24   │  us-east-1b  10.0.4.0/24              │   │
│  │  us-east-1c  10.0.5.0/24                                            │   │
│  │                                                                      │   │
│  │  ┌────────────────────────────────────────────────────────────────┐  │   │
│  │  │          Auto Scaling Group  (2–10 × t3.medium)                │  │   │
│  │  │  EC2 instances run Docker · Node 20 · TypeScript/Express       │  │   │
│  │  │  CPU scaling: +1 at 70%, -1 at 30%                             │  │   │
│  │  └────────────────────────────────────────────────────────────────┘  │   │
│  │                                                                      │   │
│  │  ┌────────────────────────────────────────────────────────────────┐  │   │
│  │  │          RDS PostgreSQL 15  (db.t3.medium, Multi-AZ)           │  │   │
│  │  │  20 GB gp3 · encrypted · 7-day automated backups              │  │   │
│  │  │  Parameter group: max_connections=100, shared_buffers=256MB    │  │   │
│  │  └────────────────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  VPC Endpoints: S3 (Gateway) — avoids NAT GW charges for S3 traffic        │
└─────────────────────────────────────────────────────────────────────────────┘
          │                                        │
          ▼                                        ▼
┌──────────────────────┐              ┌──────────────────────────────────────┐
│  AWS Secrets Manager │              │  CloudWatch                          │
│  db_master secret    │              │  Dashboard · Alarms · Cost Budget    │
│  app_api_key secret  │              │  Logs: ALB · Lambda · App            │
│  Auto-rotation ready │              └──────────────────────────────────────┘
└──────────────────────┘

S3 Buckets (all private, SSE-S3):
  aura-vault-static-assets-{env}-{suffix}   — frontend build output
  aura-vault-backups-{env}-{suffix}         — RDS dumps, DR exports
  aura-vault-logs-{env}-{suffix}            — ALB & CloudFront access logs
```

### Data Flow

```
Browser ──HTTPS──► CloudFront
                      │
          ┌───────────┴───────────┐
         /api/*                   /*
          │                       │
          ▼                       ▼
         ALB                  S3 (static)
          │
    Health checked
          │
      EC2 (ASG)          ──reads creds──► Secrets Manager
          │
      PostgreSQL (RDS)
          │
      S3 backups (VPC endpoint, no NAT cost)
```

---

## Module Reference

> All resources live in the flat `terraform/` directory. There are no Terraform module subdirectories; every `.tf` file is a logical grouping of related resources.

### VPC & Networking

**File:** `vpc.tf`

Creates a fully routable, multi-AZ VPC:

| Resource | Description |
|---|---|
| `aws_vpc.main` | VPC with DNS support/hostnames enabled |
| `aws_internet_gateway.main` | Public internet access |
| `aws_subnet.public[0-2]` | Public subnets in each AZ (10.0.0-2.0/24) |
| `aws_subnet.private[0-2]` | Private subnets in each AZ (10.0.3-5.0/24) |
| `aws_nat_gateway.main[0-2]` | Per-AZ NAT Gateways for private egress |
| `aws_eip.nat[0-2]` | Elastic IPs attached to each NAT GW |
| `aws_route_table.public` | Default route via Internet GW |
| `aws_route_table.private[0-2]` | Per-AZ default route via NAT GW |
| `aws_vpc_endpoint.s3` | Gateway endpoint — S3 traffic stays on AWS backbone |

**Subnet CIDR allocation (VPC: 10.0.0.0/16):**

| Subnet | CIDR | AZ | Type |
|---|---|---|---|
| public[0] | 10.0.0.0/24 | us-east-1a | Public |
| public[1] | 10.0.1.0/24 | us-east-1b | Public |
| public[2] | 10.0.2.0/24 | us-east-1c | Public |
| private[0] | 10.0.3.0/24 | us-east-1a | Private |
| private[1] | 10.0.4.0/24 | us-east-1b | Private |
| private[2] | 10.0.5.0/24 | us-east-1c | Private |

---

### Security Groups

**File:** `security_groups.tf`

Least-privilege rules — each tier only accepts traffic from the tier above it.

| Security Group | Inbound | Outbound |
|---|---|---|
| `sg_alb` | 80, 443 from 0.0.0.0/0 | All to EC2 sg |
| `sg_backend` | 3000 from ALB sg only | 5432 to RDS sg; 443 to 0.0.0.0/0 (HTTPS) |
| `sg_rds` | 5432 from backend sg only | None |

---

### Application Load Balancer

**File:** `alb.tf`

| Resource | Description |
|---|---|
| `aws_lb.main` | Internet-facing ALB in public subnets |
| `aws_lb_listener.https` | HTTPS :443, forwards to target group |
| `aws_lb_listener.http` | HTTP :80 → 301 redirect to HTTPS |
| `aws_lb_target_group.backend` | Port 3000, health check `GET /api/health` (2xx) |

Access logs are delivered to `s3://aura-vault-logs-{env}/alb/`.

---

### Auto Scaling Group (EC2)

**File:** `autoscaling.tf`

| Parameter | Default | Description |
|---|---|---|
| Instance type | `t3.medium` | 2 vCPU, 4 GB RAM |
| Min size | `2` | Always-on floor across AZs |
| Max size | `10` | Hard cap during traffic spikes |
| Desired | `2` | Normal operating count |
| Scale-out trigger | CPU ≥ 70% for 2 periods | Adds 1 instance |
| Scale-in trigger | CPU ≤ 30% for 2 periods | Removes 1 instance |
| AMI | Latest Amazon Linux 2023 | Fetched via `aws_ssm_parameter` |
| User data | `user-data.sh` | Installs Docker, pulls & runs app image |

Instances run in private subnets. The ALB registers instances automatically via the target group. SSH key is injected via `aws_key_pair` (set `ssh_public_key` variable).

---

### RDS PostgreSQL

**File:** `rds.tf`

| Parameter | Value |
|---|---|
| Engine | PostgreSQL 15.4 |
| Instance class | `db.t3.medium` |
| Storage | 20 GB gp3, encrypted (AES-256) |
| Max auto-storage | 40 GB |
| Multi-AZ | `true` (standby in separate AZ) |
| Automated backups | 7-day retention, 02:00 UTC window |
| Parameter group | `postgres15` family |
| `max_connections` | 100 |
| `shared_buffers` | 256 MB |
| `effective_cache_size` | 1 GB |
| Deletion protection | `true` in prod |
| Performance Insights | Enabled |

Credentials are stored in and sourced from AWS Secrets Manager (`aura-vault/prod/db_master`). The `db_password` Terraform variable is deprecated; do not set it in new deployments.

---

### CloudFront CDN

**File:** `cloudfront.tf`

| Parameter | Value |
|---|---|
| Origin | S3 static-assets bucket via OAC (Origin Access Control) |
| Price class | `PriceClass_100` (US, EU) |
| Viewer protocol | Redirect HTTP → HTTPS |
| Minimum TLS | TLSv1.2_2021 |
| Caching | Default TTL 86400 s; compress gzip/br |
| Custom error | 404 → `/index.html` 200 (SPA routing) |
| Alternate domain | Set via `domain_name` variable + ACM cert |
| Logging | Enabled → `s3://aura-vault-logs-{env}/cloudfront/` |

The S3 bucket policy grants access only to the CloudFront service principal. All public access is blocked at the bucket level.

---

### S3 Storage

**File:** `s3.tf`

Three buckets are provisioned:

| Bucket | Purpose | Versioning | Lifecycle |
|---|---|---|---|
| `static-assets` | Frontend build output, served by CloudFront | Enabled | Expire non-current after 30 days |
| `backups` | RDS dumps, Lambda exports | Enabled | IA after 30 d; Glacier after 90 d; delete after 365 d |
| `logs` | ALB + CloudFront access logs | Disabled | Delete after 90 days |

All buckets: public access blocked, SSE-S3 encryption, `force_destroy = false`.

---

### Secrets Manager

**File:** `secrets.tf`

| Secret | Path | Description |
|---|---|---|
| DB master credentials | `aura-vault/{env}/db_master` | `{"username":"…","password":"…","host":"…","port":5432}` |
| Application API key | `aura-vault/{env}/app` | `{"api_key":"…","jwt_secret":"…"}` |

Secrets are referenced in the EC2 user-data script at launch time. Rotation is supported via `secrets_rotation_lambda_arn` variable. Recovery window defaults to 30 days.

---

### CloudWatch Monitoring

**File:** `cloudwatch.tf`

| Resource | Description |
|---|---|
| `aws_cloudwatch_dashboard.main` | Unified dashboard: ALB 5xx, CPU, RDS connections, DB storage |
| `aws_cloudwatch_metric_alarm.high_cpu` | Triggers SNS when average CPU > 80% for 5 min |
| `aws_cloudwatch_metric_alarm.alb_5xx` | Triggers SNS when 5XX count > 10 in 5 min |
| `aws_cloudwatch_metric_alarm.db_storage` | Triggers SNS when free RDS storage < 2 GB |
| `aws_budgets_budget.monthly` | Monthly cost alert at `monthly_budget_limit` USD (default $500) |
| `aws_sns_topic.alerts` | Alert fan-out; email subscription if `alert_email` set |

---

### DNS & Route 53

**Files:** `dns.tf`, `dns-monitoring.tf`

| Resource | Description |
|---|---|
| `aws_route53_zone.main` | Public hosted zone for `domain_name` (optional) |
| `aws_route53_record.apex` | A record (alias) → ALB |
| `aws_route53_record.www` | CNAME → ALB |
| `aws_route53_record.cloudfront` | A record (alias) → CloudFront |
| `aws_acm_certificate.main` | ACM cert in us-east-1 for CloudFront (DNS validated) |
| `aws_route53_health_check.alb` | HTTP health check on ALB DNS + alarm |
| `aws_route53_record.failover_*` | Optional DNS failover if `enable_dns_failover = true` |

DNS setup is optional. Omit `domain_name` to use the raw ALB DNS name.

---

### Backup

**File:** `backup.tf`, `lambda/backup.py`

| Resource | Description |
|---|---|
| `aws_backup_plan.main` | AWS Backup plan: daily (7-day retention), weekly (30-day), monthly (1-year) |
| `aws_backup_selection.rds` | Backs up the RDS instance |
| `aws_backup_vault.main` | Encrypted vault in same region |
| Lambda `backup.py` | Triggered weekly; exports RDS snapshot to S3 backups bucket |
| Lambda `restore-test.py` | Monthly restore verification; see DR runbook |

---

## Input Variables

| Variable | Type | Default | Required | Description |
|---|---|---|---|---|
| `aws_region` | string | `us-east-1` | No | Deployment region |
| `environment` | string | `dev` | No | `dev`, `staging`, or `prod` |
| `project_name` | string | `aura-vault` | No | Prefix for all resource names |
| `vpc_cidr` | string | `10.0.0.0/16` | No | VPC CIDR block |
| `availability_zones` | list(string) | `["us-east-1a","us-east-1b","us-east-1c"]` | No | AZs for multi-AZ deployment |
| `backend_instance_type` | string | `t3.medium` | No | EC2 instance type for backend |
| `asg_min_size` | number | `2` | No | ASG minimum instance count |
| `asg_max_size` | number | `10` | No | ASG maximum instance count |
| `asg_desired_capacity` | number | `2` | No | ASG desired instance count |
| `db_instance_class` | string | `db.t3.medium` | No | RDS instance class |
| `db_allocated_storage` | number | `20` | No | Initial RDS storage in GB |
| `db_name` | string | `auravault` | No | PostgreSQL database name |
| `db_username` | string | — | **Yes** | RDS master username |
| `db_password` | string | `null` | No | **Deprecated** — use Secrets Manager |
| `enable_cloudfront` | bool | `true` | No | Enable CloudFront distribution |
| `ssh_public_key` | string | — | **Yes** | SSH public key for EC2 instances |
| `domain_name` | string | `""` | No | Custom domain (leave empty to skip DNS) |
| `alert_email` | string | `""` | No | Email for CloudWatch alert subscriptions |
| `monthly_budget_limit` | number | `500` | No | Monthly AWS budget alert threshold (USD) |
| `enable_dns_failover` | bool | `true` | No | Route 53 DNS failover health checks |
| `enable_email_forwarding` | bool | `false` | No | SES email forwarding |
| `secrets_rotation_lambda_arn` | string | `""` | No | Lambda ARN for Secrets Manager rotation |
| `secret_recovery_window_days` | number | `30` | No | Days before deleted secrets are purged |

### Minimal `terraform.tfvars` for a new deployment

```hcl
environment  = "prod"
db_username  = "auravault"
ssh_public_key = "ssh-ed25519 AAAA..."
alert_email  = "ops@yourteam.example"
domain_name  = "app.yourteam.example"   # optional
monthly_budget_limit = 600
```

---

## Outputs

| Output | Sensitive | Description |
|---|---|---|
| `vpc_id` | No | VPC resource ID |
| `public_subnet_ids` | No | List of public subnet IDs |
| `private_subnet_ids` | No | List of private subnet IDs |
| `alb_dns_name` | No | ALB DNS name (use as CNAME target) |
| `alb_zone_id` | No | ALB hosted zone ID (for Route 53 alias) |
| `cloudfront_distribution_id` | No | CloudFront distribution ID |
| `cloudfront_domain_name` | No | CloudFront *.cloudfront.net domain |
| `rds_endpoint` | **Yes** | RDS connection string (host:port) |
| `s3_bucket_name` | No | Static assets bucket name |
| `s3_backup_bucket_name` | No | Backups bucket name |
| `route53_zone_id` | No | Route 53 hosted zone ID (if domain set) |
| `acm_certificate_arn` | No | ACM certificate ARN (if domain set) |
| `app_secret_arn` | No | Application secrets ARN |
| `db_master_secret_arn` | **Yes** | DB master credentials secret ARN |

---

## Cost Estimate

Estimates are for `us-east-1`, standard on-demand pricing, minimum viable production configuration (2 EC2 instances, 1 RDS Multi-AZ, 3 NAT GWs). Actual costs depend on traffic and data transfer.

| Service | Config | Est. Monthly (USD) |
|---|---|---|
| EC2 (×2 t3.medium) | On-demand, 730 hrs | ~$60 |
| RDS (db.t3.medium, Multi-AZ) | 20 GB gp3, 730 hrs | ~$100 |
| NAT Gateway (×3) | 730 hrs + data processing | ~$100 |
| ALB | 730 hrs + LCUs | ~$25 |
| CloudFront | 10 TB/mo transfer out (US/EU) | ~$90 |
| S3 (all buckets) | 100 GB storage + requests | ~$5 |
| CloudWatch | Metrics, logs, dashboards | ~$15 |
| Secrets Manager | 2 secrets + API calls | ~$1 |
| Route 53 | 1 hosted zone + queries | ~$1 |
| **Total (estimated)** | | **~$397 / month** |

**Cost levers:**
- Switch EC2 to Reserved Instances (1-year, no upfront) → ~40% saving on compute
- Reduce `asg_min_size` to 1 in dev/staging
- Use `PriceClass_All` → higher CloudFront costs; `PriceClass_100` (default) is most economical
- NAT GWs are the second-largest cost center; the S3 VPC endpoint eliminates S3-related NAT charges

Use the [AWS Pricing Calculator](https://calculator.aws/) with the outputs above for a precise quote.

---

## Quick Start

### Prerequisites

- AWS CLI ≥ 2.x configured (`aws configure`)
- Terraform ≥ 1.5.0
- An SSH key pair (for EC2 access)

### 1. Bootstrap remote state (one-time)

```bash
aws s3api create-bucket \
  --bucket aura-vault-terraform-state \
  --region us-east-1

aws s3api put-bucket-versioning \
  --bucket aura-vault-terraform-state \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket aura-vault-terraform-state \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

aws dynamodb create-table \
  --table-name aura-vault-terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

### 2. Configure variables

```bash
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars — at minimum: db_username, ssh_public_key
```

### 3. Initialize, plan, apply

```bash
terraform init
terraform plan -out=tfplan
terraform apply tfplan
```

### 4. Verify deployment

```bash
# ALB health
curl https://$(terraform output -raw alb_dns_name)/api/health

# CloudFront
curl -I https://$(terraform output -raw cloudfront_domain_name)/
```

---

## Operational Runbook

### Scale instances manually

```bash
aws autoscaling set-desired-capacity \
  --auto-scaling-group-name aura-vault-asg-prod \
  --desired-capacity 4
```

### Rotate a secret immediately

```bash
aws secretsmanager rotate-secret \
  --secret-id aura-vault/prod/app
```

### Invalidate CloudFront cache

```bash
aws cloudfront create-invalidation \
  --distribution-id $(terraform output -raw cloudfront_distribution_id) \
  --paths "/*"
```

### Promote RDS read replica after failover

```bash
# RDS Multi-AZ handles failover automatically (typically < 60 s).
# To verify active endpoint after failover:
aws rds describe-db-instances \
  --db-instance-identifier aura-vault-db-prod \
  --query 'DBInstances[0].Endpoint.Address'
```

### Destroy (non-production only)

```bash
terraform destroy
# Note: S3 backend bucket and DynamoDB lock table are NOT deleted by this command.
```
