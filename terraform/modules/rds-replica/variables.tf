/**
 * Input variables for the rds-replica module.
 *
 * All variables marked as required (no default) MUST be supplied by the
 * calling environment configuration.
 */

# ---------------------------------------------------------------------------
# Required — must be set by the caller
# ---------------------------------------------------------------------------

variable "primary_instance_id" {
  description = "Identifier of the primary RDS instance to replicate from (e.g. aura-vault-db-staging)."
  type        = string

  validation {
    condition     = length(var.primary_instance_id) > 0
    error_message = "primary_instance_id must not be empty."
  }
}

variable "primary_instance_arn" {
  description = "Optional ARN of a source DB instance in another AWS region. When set, the module creates a cross-region replica from this ARN."
  type        = string
  default     = ""
}

variable "primary_instance_class" {
  description = "Source DB instance class used when primary_instance_arn is set and instance_class is empty."
  type        = string
  default     = "db.t3.medium"
}

variable "kms_key_id" {
  description = "Destination-region KMS key ARN or ID for an encrypted cross-region replica."
  type        = string
  default     = ""
}

variable "environment" {
  description = "Deployment environment name: dev | staging | prod. Used in resource names and tags."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

# ---------------------------------------------------------------------------
# Optional — sensible defaults provided
# ---------------------------------------------------------------------------

variable "instance_class" {
  description = "RDS instance class for the replica (e.g. db.t3.medium, db.r6g.large). Leave empty to inherit from the primary."
  type        = string
  default     = ""
}

variable "availability_zone" {
  description = "Availability zone in which the replica will be launched. Should differ from the primary AZ for resilient reads."
  type        = string
  default     = ""
}

variable "monitoring_role_arn" {
  description = "IAM role ARN for RDS Enhanced Monitoring. If empty, enhanced monitoring is disabled."
  type        = string
  default     = ""
  sensitive   = false
}

variable "performance_insights_enabled" {
  description = "Enable RDS Performance Insights on the replica for query-level analytics."
  type        = bool
  default     = true
}

variable "extra_tags" {
  description = "Additional AWS resource tags to merge onto the replica instance."
  type        = map(string)
  default     = {}
}
