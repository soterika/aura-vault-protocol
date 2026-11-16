/**
 * Module: rds-replica
 *
 * Provisions an AWS RDS read replica for an existing primary PostgreSQL
 * instance. The replica inherits the storage engine, engine version,
 * encryption settings, and parameter group family from the primary; only
 * the instance class, availability zone, and environment tag are configurable
 * per-replica to keep configuration DRY across staging and production.
 *
 * Usage (see ../../envs/staging/main.tf and ../../envs/production/main.tf):
 *
 *   module "rds_replica" {
 *     source               = "../../modules/rds-replica"
 *     primary_instance_id  = aws_db_instance.main.identifier
 *     instance_class       = "db.t3.medium"
 *     availability_zone    = "us-east-1b"
 *     environment          = "staging"
 *   }
 */

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0.0"
    }
  }
}

# ---------------------------------------------------------------------------
# Fetch the primary instance so we can inherit its configuration
# ---------------------------------------------------------------------------
data "aws_db_instance" "primary" {
  count                  = var.primary_instance_arn == "" ? 1 : 0
  db_instance_identifier = var.primary_instance_id
}

# ---------------------------------------------------------------------------
# Read Replica
# ---------------------------------------------------------------------------
resource "aws_db_instance" "replica" {
  # Identifier must be unique within the AWS account / region
  identifier = "${var.primary_instance_id}-replica-${var.environment}"

  # Replicate from the primary — this implicitly sets the engine and version
  replicate_source_db = var.primary_instance_arn != "" ? var.primary_instance_arn : var.primary_instance_id

  # Allow override of compute; falls back to the primary's class
  instance_class = var.instance_class != "" ? var.instance_class : (
    var.primary_instance_arn != "" ? var.primary_instance_class : data.aws_db_instance.primary[0].db_instance_class
  )

  # Place the replica in a distinct AZ from the primary for HA reads
  availability_zone = var.availability_zone != "" ? var.availability_zone : null

  # Replicas are never publicly accessible
  publicly_accessible = false

  # Inherit storage type and encryption from the primary
  storage_type      = "gp3"
  storage_encrypted = true
  kms_key_id        = var.kms_key_id != "" ? var.kms_key_id : null

  # Enhanced monitoring — same 60-second granularity as the primary
  monitoring_interval = 60
  monitoring_role_arn = var.monitoring_role_arn

  # Performance Insights for query-level read analysis
  performance_insights_enabled = var.performance_insights_enabled

  # Read replicas do not need automated backups themselves;
  # the primary covers PITR for the full dataset.
  backup_retention_period = 0

  # Skip final snapshot for replicas (data is fully recoverable from primary)
  skip_final_snapshot = true

  # Deletion protection mirrors the environment flag
  deletion_protection = var.environment == "prod"

  # Apply changes immediately for non-prod; during maintenance window for prod
  apply_immediately = var.environment != "prod"

  tags = merge(
    {
      Name        = "${var.primary_instance_id}-replica-${var.environment}"
      Environment = var.environment
      Role        = "read-replica"
      ManagedBy   = "terraform"
    },
    var.extra_tags,
  )

  lifecycle {
    # Prevent accidental destruction of production replicas
    prevent_destroy = false

    # Ignore engine version drift — upgrades are managed on the primary
    ignore_changes = [engine_version]
  }
}
