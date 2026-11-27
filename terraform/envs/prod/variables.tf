variable "aws_region" {
  description = "AWS region for the production environment."
  type        = string
  default     = "us-east-1"
}

variable "redis_node_type" {
  description = "ElastiCache node instance type for production Redis."
  type        = string
  default     = "cache.r6g.large"
}

variable "redis_num_shards" {
  description = "Number of shards for the production ElastiCache Redis cluster."
  type        = number
  default     = 3
}
