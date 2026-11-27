/**
 * ElastiCache Redis 7 Cluster Module
 *
 * Provisions a production-grade Redis 7 cluster on AWS ElastiCache with:
 * - Cluster mode enabled (3 shards, 1 replica per shard = 6 nodes by default)
 * - Multi-AZ with automatic failover
 * - Custom parameter group with maxmemory-policy = allkeys-lru
 * - Encryption at rest and in transit
 * - Dedicated security group allowing ingress on 6379 only from backend SGs
 * - CloudWatch alarms for CPU > 70%, connections > 1000, and evictions > 0
 */

resource "aws_elasticache_parameter_group" "this" {
  name        = "${var.cluster_name}-params"
  family      = "redis7"
  description = "Redis 7 parameter group for ${var.cluster_name}"

  parameter {
    name  = "maxmemory-policy"
    value = "allkeys-lru"
  }

  tags = merge(
    {
      Name        = "${var.cluster_name}-params"
      Environment = var.environment
      ManagedBy   = "terraform"
    },
    var.tags
  )
}

resource "aws_elasticache_subnet_group" "this" {
  name        = "${var.cluster_name}-subnet-group"
  description = "Subnet group for ${var.cluster_name} ElastiCache cluster"
  subnet_ids  = var.subnet_ids

  tags = merge(
    {
      Name        = "${var.cluster_name}-subnet-group"
      Environment = var.environment
      ManagedBy   = "terraform"
    },
    var.tags
  )
}

resource "aws_security_group" "this" {
  name        = "${var.cluster_name}-sg"
  description = "Security group for ${var.cluster_name} ElastiCache Redis cluster"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Allow Redis access from backend service security groups"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = var.allowed_security_group_ids
  }

  egress {
    description = "Allow all outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(
    {
      Name        = "${var.cluster_name}-sg"
      Environment = var.environment
      ManagedBy   = "terraform"
    },
    var.tags
  )
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id = var.cluster_name
  description          = "ElastiCache Redis 7 cluster (${var.cluster_name})"

  engine               = "redis"
  engine_version       = var.engine_version
  node_type            = var.node_type
  port                 = 6379
  parameter_group_name = aws_elasticache_parameter_group.this.name
  subnet_group_name    = aws_elasticache_subnet_group.this.name
  security_group_ids   = [aws_security_group.this.id]

  num_node_groups            = var.num_shards
  replicas_per_node_group    = var.replicas_per_node_group
  automatic_failover_enabled = true
  multi_az_enabled           = true

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  auto_minor_version_upgrade = true
  snapshot_retention_limit   = var.snapshot_retention_limit
  snapshot_window            = "03:00-05:00"
  maintenance_window         = "sun:05:00-sun:07:00"

  tags = merge(
    {
      Name        = var.cluster_name
      Environment = var.environment
      ManagedBy   = "terraform"
    },
    var.tags
  )
}

# ---------------------------------------------------------------------------
# CloudWatch Alarms
# ---------------------------------------------------------------------------
locals {
  alarm_actions = var.alarm_sns_topic_arn != "" ? [var.alarm_sns_topic_arn] : []
}

resource "aws_cloudwatch_metric_alarm" "cpu_utilization" {
  alarm_name          = "${var.cluster_name}-high-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Average"
  threshold           = 70
  alarm_description   = "ElastiCache Redis CPU utilization exceeded 70% for ${var.cluster_name}"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    ReplicationGroupId = aws_elasticache_replication_group.this.id
  }

  tags = merge(
    {
      Name        = "${var.cluster_name}-high-cpu"
      Environment = var.environment
      ManagedBy   = "terraform"
    },
    var.tags
  )
}

resource "aws_cloudwatch_metric_alarm" "curr_connections" {
  alarm_name          = "${var.cluster_name}-high-connections"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CurrConnections"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Average"
  threshold           = 1000
  alarm_description   = "ElastiCache Redis current connections exceeded 1000 for ${var.cluster_name}"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    ReplicationGroupId = aws_elasticache_replication_group.this.id
  }

  tags = merge(
    {
      Name        = "${var.cluster_name}-high-connections"
      Environment = var.environment
      ManagedBy   = "terraform"
    },
    var.tags
  )
}

resource "aws_cloudwatch_metric_alarm" "evictions" {
  alarm_name          = "${var.cluster_name}-evictions"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Evictions"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "ElastiCache Redis key evictions detected (> 0) for ${var.cluster_name}"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    ReplicationGroupId = aws_elasticache_replication_group.this.id
  }

  tags = merge(
    {
      Name        = "${var.cluster_name}-evictions"
      Environment = var.environment
      ManagedBy   = "terraform"
    },
    var.tags
  )
}
