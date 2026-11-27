output "cluster_endpoint" {
  description = "Configuration endpoint address for the Redis cluster."
  value       = aws_elasticache_replication_group.this.configuration_endpoint_address
}

output "reader_endpoint" {
  description = "Reader endpoint address for read-only Redis traffic."
  value       = aws_elasticache_replication_group.this.reader_endpoint_address
}

output "port" {
  description = "Port on which the Redis cluster accepts connections."
  value       = aws_elasticache_replication_group.this.port
}

output "security_group_id" {
  description = "ID of the security group attached to the ElastiCache cluster."
  value       = aws_security_group.this.id
}
