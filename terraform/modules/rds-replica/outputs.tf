/**
 * Outputs for the rds-replica module.
 *
 * Callers use these outputs to wire the replica endpoint into application
 * secrets / configuration (e.g. DATABASE_REPLICA_URL in AWS Secrets Manager).
 */

output "replica_endpoint" {
  description = "Connection endpoint (host:port) for the RDS read replica."
  value       = aws_db_instance.replica.endpoint
  sensitive   = true
}

output "replica_arn" {
  description = "ARN of the RDS read-replica instance."
  value       = aws_db_instance.replica.arn
}

output "replica_identifier" {
  description = "DB instance identifier of the read replica."
  value       = aws_db_instance.replica.identifier
}

output "replica_address" {
  description = "Hostname of the read replica (without port)."
  value       = aws_db_instance.replica.address
  sensitive   = true
}
