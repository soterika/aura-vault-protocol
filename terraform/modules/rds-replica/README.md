# Module: `rds-replica`

Provisions an AWS RDS PostgreSQL **read replica** for an existing primary instance.

The replica inherits the engine version, storage encryption, and multi-AZ topology from the primary. Only the instance class, availability zone, and environment label need to be customised per environment.

---

## Usage

```hcl
module "rds_replica" {
  source = "../../modules/rds-replica"

  # Required
  primary_instance_id = aws_db_instance.main.identifier
  environment         = "staging"

  # Optional overrides
  instance_class    = "db.t3.medium"
  availability_zone = "us-east-1b"

  monitoring_role_arn          = aws_iam_role.rds_monitoring.arn
  performance_insights_enabled = true

  extra_tags = {
    CostCenter = "platform"
  }
}
```

After applying, wire the replica endpoint into your application configuration:

```hcl
resource "aws_secretsmanager_secret_version" "app_config" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    DATABASE_URL         = "postgresql://...@${aws_db_instance.main.endpoint}/auravault"
    DATABASE_REPLICA_URL = "postgresql://...@${module.rds_replica.replica_endpoint}/auravault"
  })
}
```

The backend reads `DATABASE_REPLICA_URL` for all read-only queries and falls back to `DATABASE_URL` when the variable is absent (`backend/src/db.ts`).

---

## Inputs

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `primary_instance_id` | `string` | ✓ | — | Identifier of the RDS primary instance |
| `environment` | `string` | ✓ | — | `dev` \| `staging` \| `prod` |
| `instance_class` | `string` | | `""` (inherit from primary) | RDS instance class, e.g. `db.t3.medium` |
| `availability_zone` | `string` | | `""` (AWS-chosen) | AZ for the replica — should differ from primary |
| `monitoring_role_arn` | `string` | | `""` (disabled) | IAM role ARN for Enhanced Monitoring |
| `performance_insights_enabled` | `bool` | | `true` | Enable Performance Insights |
| `extra_tags` | `map(string)` | | `{}` | Additional tags to merge |

---

## Outputs

| Name | Sensitive | Description |
|---|---|---|
| `replica_endpoint` | ✓ | `host:port` connection string |
| `replica_arn` | | Full ARN of the replica instance |
| `replica_identifier` | | DB instance identifier |
| `replica_address` | ✓ | Hostname without port |

---

## Notes

- **Backup retention** is set to `0` on the replica — point-in-time recovery is handled by the primary's automated backups.
- **Deletion protection** is automatically enabled when `environment = "prod"`.
- **Engine version drift** is ignored via `lifecycle.ignore_changes`; upgrades must be applied to the primary first, which automatically propagates to replicas.
- The module requires **Terraform ≥ 1.5.0** and **AWS provider ≥ 5.0**.

---

## Environment Configs

| Environment | Config path |
|---|---|
| Staging | `terraform/envs/staging/main.tf` |
| Production | `terraform/envs/production/main.tf` |
