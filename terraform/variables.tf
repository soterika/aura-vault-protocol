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

variable "cost_center" {
  description = "Team or budget owner used for AWS Cost Explorer allocation."
  type        = string
  default     = "platform"
  validation {
    condition     = length(trimspace(var.cost_center)) > 0
    error_message = "cost_center must be a non-empty team value."
  }
}

variable "default_component" {
  description = "Fallback cost allocation component for AWS resources without a more specific component tag."
  type        = string
  default     = "networking"
  validation {
    condition     = contains(["backend", "frontend", "database", "cache", "monitoring", "networking"], var.default_component)
    error_message = "default_component must be one of backend, frontend, database, cache, monitoring, or networking."
  }
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

variable "canary_enabled" {
  description = "Provision the isolated canary backend ASG and target group attachment."
  type        = bool
  default     = false
}

variable "canary_ami_id" {
  description = "Immutable AMI containing the release to canary. Required when canary_enabled is true."
  type        = string
  default     = ""
}

variable "canary_weight" {
  description = "Percent of HTTPS listener traffic sent to the canary target group (0-100)."
  type        = number
  default     = 0

  validation {
    condition     = var.canary_weight >= 0 && var.canary_weight <= 100
    error_message = "canary_weight must be between 0 and 100."
  }
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

variable "dr_alb_dns_name" {
  description = "Public DNS name of the healthy application ALB deployed in the disaster-recovery region. Failover DNS stays disabled until configured."
  type        = string
  default     = ""
}

variable "dr_alb_zone_id" {
  description = "Route53 hosted-zone ID for the disaster-recovery ALB. Required together with dr_alb_dns_name to enable API failover records."
  type        = string
  default     = ""
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
