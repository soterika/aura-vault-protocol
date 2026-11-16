variable "aws_region" {
  description = "AWS region for the staging environment."
  type        = string
  default     = "us-east-1"
}

variable "replica_instance_class" {
  description = "RDS instance class for the staging read replica."
  type        = string
  default     = "db.t3.medium"
}

variable "replica_availability_zone" {
  description = "Availability zone for the staging read replica. Should differ from the primary AZ."
  type        = string
  default     = "us-east-1b"
}
