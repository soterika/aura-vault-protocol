# ElastiCache Redis 7 Cluster Module

Provisions a production-grade AWS ElastiCache Redis 7 cluster in cluster mode with Multi-AZ, automatic failover, encryption at rest and in transit, restricted security group ingress, and CloudWatch alerting.

## Features

- **Engine**: Redis 7 (`redis7` parameter group family)
- **Topology**: 3 shards with 1 replica per shard (6 nodes total) by default
- **High Availability**: Multi-AZ enabled with automatic failover
- **Memory Policy**: `maxmemory-policy = allkeys-lru`
- **Security**:
  - Encryption at rest and in transit enabled
  - Security group restricts ingress on port `6379` to specified backend service security groups
- **Monitoring**: CloudWatch alarms for:
  - `CPUUtilization > 70%`
  - `CurrConnections > 1000`
  - `Evictions > 0`

## Usage Example

```hcl
module "elasticache" {
  source = "../../modules/elasticache"

  cluster_name               = "aura-vault-redis-prod"
  node_type                  = "cache.r6g.large"
  num_shards                 = 3
  environment                = "prod"
  vpc_id                     = data.terraform_remote_state.root.outputs.vpc_id
  subnet_ids                 = data.terraform_remote_state.root.outputs.private_subnet_ids
  allowed_security_group_ids = [data.terraform_remote_state.root.outputs.backend_security_group_id]
  alarm_sns_topic_arn        = data.terraform_remote_state.root.outputs.alerts_sns_topic_arn
}
```

## Inputs

| Name | Description | Type | Default | Required |
|------|-------------|------|---------|----------|
| `cluster_name` | Name / replication group ID of the ElastiCache Redis cluster | `string` | n/a | yes |
| `node_type` | ElastiCache node instance type | `string` | `"cache.r6g.large"` | no |
| `num_shards` | Number of shards (node groups) | `number` | `3` | no |
| `replicas_per_node_group` | Number of replicas per shard | `number` | `1` | no |
| `engine_version` | Redis engine version | `string` | `"7.0"` | no |
| `vpc_id` | VPC ID for the security group | `string` | n/a | yes |
| `subnet_ids` | Private subnet IDs for the subnet group | `list(string)` | n/a | yes |
| `allowed_security_group_ids` | Backend service security group IDs allowed on port 6379 | `list(string)` | n/a | yes |
| `environment` | Deployment environment name | `string` | n/a | yes |
| `snapshot_retention_limit` | Automatic snapshot retention days | `number` | `7` | no |
| `alarm_sns_topic_arn` | SNS topic ARN for CloudWatch alarms | `string` | `""` | no |
| `tags` | Additional resource tags | `map(string)` | `{}` | no |

## Outputs

| Name | Description |
|------|-------------|
| `cluster_endpoint` | Configuration endpoint address for the Redis cluster |
| `reader_endpoint` | Reader endpoint address for read-only Redis traffic |
| `port` | Port on which the Redis cluster accepts connections (`6379`) |
| `security_group_id` | ID of the ElastiCache security group |
