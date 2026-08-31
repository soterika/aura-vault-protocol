output "vpc_id" {
  description = "ID of the VPC"
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "IDs of public subnets"
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "IDs of private subnets"
  value       = aws_subnet.private[*].id
}

output "alb_dns_name" {
  description = "DNS name of the load balancer"
  value       = aws_lb.main.dns_name
}

output "alb_zone_id" {
  description = "Zone ID of the load balancer"
  value       = aws_lb.main.zone_id
}

output "cloudfront_distribution_id" {
  description = "ID of the CloudFront distribution"
  value       = var.enable_cloudfront ? aws_cloudfront_distribution.main[0].id : null
}

output "cloudfront_domain_name" {
  description = "Domain name of the CloudFront distribution"
  value       = var.enable_cloudfront ? aws_cloudfront_distribution.main[0].domain_name : null
}

output "rds_endpoint" {
  description = "RDS instance endpoint"
  value       = aws_db_instance.main.endpoint
  sensitive   = true
}

output "s3_bucket_name" {
  description = "Name of the S3 bucket for static assets"
  value       = aws_s3_bucket.static_assets.id
}

output "s3_backup_bucket_name" {
  description = "Name of the S3 bucket for backups"
  value       = aws_s3_bucket.backups.id
}

# DNS Outputs
output "route53_zone_id" {
  description = "ID of the Route53 hosted zone"
  value       = var.domain_name != "" ? aws_route53_zone.main[0].id : null
}

output "acm_certificate_arn" {
  description = "ARN of the ACM certificate"
  value       = var.domain_name != "" ? aws_acm_certificate.main[0].arn : null
}

output "dns_health_check_id" {
  description = "ID of the DNS health check"
  value       = var.domain_name != "" ? aws_route53_health_check.alb[0].id : null
}

output "ses_domain_identity" {
  description = "SES domain identity"
  value       = var.domain_name != "" && var.enable_email_forwarding ? aws_ses_domain_identity.main[0].arn : null
}

output "app_secret_arn" {
  description = "Application secrets ARN for this environment"
  value       = aws_secretsmanager_secret.app.arn
}

output "db_master_secret_arn" {
  description = "Database master credentials secret ARN"
  value       = aws_secretsmanager_secret.db_master.arn
  sensitive   = true
}
