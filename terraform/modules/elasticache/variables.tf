variable "cluster_name" {
  description = "Name / replication group ID of the ElastiCache Redis cluster."
  type        = string
}

variable "node_type" {
  description = "ElastiCache node instance type (e.g., cache.r6g.large, cache.t4g.medium)."
  type        = string
  default     = "cache.r6g.large"
}

variable "num_shards" {
  description = "Number of shards (node groups) in the Redis cluster."
  type        = number
  default     = 3
}

variable "replicas_per_node_group" {
  description = "Number of replica nodes per shard."
  type        = number
  default     = 1
}

variable "engine_version" {
  description = "Redis engine version."
  type        = string
  default     = "7.0"
}

variable "vpc_id" {
  description = "VPC ID where the ElastiCache security group will be created."
  type        = string
}

variable "subnet_ids" {
  description = "List of private subnet IDs for the ElastiCache subnet group."
  type        = list(string)
}

variable "allowed_security_group_ids" {
  description = "List of backend service security group IDs allowed to connect on port 6379."
  type        = list(string)
}

variable "environment" {
  description = "Deployment environment name (e.g., prod, staging)."
  type        = string
}

variable "snapshot_retention_limit" {
  description = "Number of days for which ElastiCache retains automatic snapshots."
  type        = number
  default     = 7
}

variable "alarm_sns_topic_arn" {
  description = "Optional SNS topic ARN for CloudWatch alarm notifications."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Additional tags to apply to all resources."
  type        = map(string)
  default     = {}
}
