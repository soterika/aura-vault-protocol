variable "aws_region" {
  description = "AWS region for the production disaster-recovery replica."
  type        = string
  default     = "eu-west-1"
}

variable "replica_instance_class" {
  description = "RDS instance class for the production read replica. Use a larger class than staging."
  type        = string
  default     = "db.r6g.large"
}

variable "replica_availability_zone" {
  description = "Optional availability zone for the production DR replica. Leave empty to let AWS select one in eu-west-1."
  type        = string
  default     = ""
}

variable "pagerduty_integration_key" {
  description = "Optional PagerDuty Events API v2 integration key for the RDS replica-lag alarm. Configure through a secret variable."
  type        = string
  sensitive   = true
  default     = ""
}
