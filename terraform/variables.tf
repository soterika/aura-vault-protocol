variable "aws_region" {
  description = "AWS region for deployment"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
  default     = "aura-vault"
}

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "Availability zones for multi-AZ deployment"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b", "us-east-1c"]
}

variable "domain_name" {
  description = "Domain name for the application"
  type        = string
  default     = ""
}

variable "eks_oidc_issuer_url" {
  description = "OIDC issuer URL for the EKS cluster (used for IRSA). Format: https://oidc.eks.<region>.amazonaws.com/id/<ID>"
  type        = string
  default     = ""
}

variable "backend_instance_type" {
  description = "EC2 instance type for backend"
  type        = string
  default     = "t3.medium"
}

variable "asg_min_size" {
  description = "Minimum number of instances in auto-scaling group"
  type        = number
  default     = 2
}

variable "asg_max_size" {
  description = "Maximum number of instances in auto-scaling group"
  type        = number
  default     = 10
}

variable "asg_desired_capacity" {
  description = "Desired number of instances in auto-scaling group"
  type        = number
  default     = 2
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.medium"
}

variable "db_allocated_storage" {
  description = "Allocated storage for RDS in GB"
  type        = number
  default     = 20
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "auravault"
}

variable "db_username" {
  description = "Database master username"
  type        = string
  sensitive   = true
}

variable "db_password" {
  description = "Deprecated. Database passwords are generated and rotated through AWS Secrets Manager."
  type        = string
  sensitive   = true
  default     = null
}

variable "secrets_rotation_lambda_arn" {
  description = "Lambda ARN used by AWS Secrets Manager to rotate application API credentials."
  type        = string
  default     = ""
}

variable "secret_recovery_window_days" {
  description = "Recovery window before deleted secrets are permanently removed."
  type        = number
  default     = 30
}

variable "enable_cloudfront" {
  description = "Enable CloudFront CDN"
  type        = bool
  default     = true
}

variable "ssh_public_key" {
  description = "SSH public key for instance access"
  type        = string
  sensitive   = true
}

variable "alert_email" {
  description = "Email address for alert notifications"
  type        = string
  default     = ""
}

variable "monthly_budget_limit" {
  description = "Monthly budget limit in USD"
  type        = number
  default     = 500
}

# DNS Configuration Variables
variable "create_subdomain_zone" {
  description = "Create a separate hosted zone for subdomain"
  type        = bool
  default     = false
}

variable "subdomain_name" {
  description = "Subdomain name (e.g., 'app' for app.example.com)"
  type        = string
  default     = "app"
}

variable "verification_token" {
  description = "Verification token for domain ownership"
  type        = string
  default     = ""
}

variable "enable_dns_failover" {
  description = "Enable DNS failover configuration"
  type        = bool
  default     = true
}

variable "enable_email_forwarding" {
  description = "Enable email forwarding with SES"
  type        = bool
  default     = false
}

variable "email_forwarding_recipients" {
  description = "Email addresses to receive forwarded emails"
  type        = list(string)
  default     = []
}

variable "email_forwarding_destinations" {
  description = "Destination email addresses for forwarding"
  type        = list(string)
  default     = []
}
