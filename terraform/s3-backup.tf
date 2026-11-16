# =============================================================================
# S3 Backup Bucket — PostgreSQL encrypted backups with 30-day lifecycle
#
# Resources:
#   - aws_s3_bucket.postgres_backup          — private bucket, versioning enabled
#   - aws_s3_bucket_lifecycle_configuration  — STANDARD_IA → GLACIER_IR → expire@30d
#   - aws_s3_bucket_server_side_encryption   — SSE-KMS with dedicated backup key
#   - aws_kms_key.backup                     — CMK for S3 SSE-KMS
#   - aws_iam_policy.backup_s3               — allow CronJob SA to put/get objects
# =============================================================================

# ── KMS key for backup encryption ────────────────────────────────────────────
resource "aws_kms_key" "backup" {
  description             = "${var.project_name}-${var.environment} PostgreSQL backup encryption key"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name        = "${var.project_name}-backup-key-${var.environment}"
    Project     = var.project_name
    Environment = local.cost_environment
    ManagedBy   = "terraform"
  }
}

resource "aws_kms_alias" "backup" {
  name          = "alias/${var.project_name}-backup-${var.environment}"
  target_key_id = aws_kms_key.backup.key_id
}

# ── S3 Bucket ─────────────────────────────────────────────────────────────────
resource "aws_s3_bucket" "postgres_backup" {
  bucket = "${var.project_name}-db-backups-${var.environment}"

  tags = {
    Name        = "${var.project_name}-db-backups-${var.environment}"
    Project     = var.project_name
    Environment = local.cost_environment
    ManagedBy   = "terraform"
    Purpose     = "postgresql-backups"
  }
}

# Block all public access — this bucket must never be public
resource "aws_s3_bucket_public_access_block" "postgres_backup" {
  bucket = aws_s3_bucket.postgres_backup.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Enable versioning so accidental deletes are recoverable within retention window
resource "aws_s3_bucket_versioning" "postgres_backup" {
  bucket = aws_s3_bucket.postgres_backup.id

  versioning_configuration {
    status = "Enabled"
  }
}

# SSE-KMS with the dedicated backup key
resource "aws_s3_bucket_server_side_encryption_configuration" "postgres_backup" {
  bucket = aws_s3_bucket.postgres_backup.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.backup.arn
    }
    bucket_key_enabled = true  # reduces KMS API call costs
  }
}

# ── Lifecycle: STANDARD → STANDARD_IA (7d) → GLACIER_IR (14d) → expire (30d)
resource "aws_s3_bucket_lifecycle_configuration" "postgres_backup" {
  # Versioning must be enabled before lifecycle rules can reference noncurrent versions
  depends_on = [aws_s3_bucket_versioning.postgres_backup]

  bucket = aws_s3_bucket.postgres_backup.id

  # Rule 1: Main retention policy for backup objects
  rule {
    id     = "postgres-backup-30day-retention"
    status = "Enabled"

    filter {
      prefix = "postgres-backups/"
    }

    # Move to STANDARD_IA after 7 days (objects accessed < once/month)
    transition {
      days          = 7
      storage_class = "STANDARD_IA"
    }

    # Move to GLACIER Instant Retrieval after 14 days
    transition {
      days          = 14
      storage_class = "GLACIER_IR"
    }

    # Hard-delete after 30 days
    expiration {
      days = 30
    }

    # Clean up old non-current versions within 7 days
    noncurrent_version_expiration {
      noncurrent_days = 7
    }

    # Abort incomplete multipart uploads within 1 day
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  # Rule 2: Clean up orphaned delete markers
  rule {
    id     = "delete-expired-delete-markers"
    status = "Enabled"

    filter {
      prefix = "postgres-backups/"
    }

    expiration {
      expired_object_delete_marker = true
    }
  }
}

# Enforce TLS-only access
resource "aws_s3_bucket_policy" "postgres_backup" {
  bucket = aws_s3_bucket.postgres_backup.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyNonTLSRequests"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.postgres_backup.arn,
          "${aws_s3_bucket.postgres_backup.arn}/*"
        ]
        Condition = {
          Bool = { "aws:SecureTransport" = "false" }
        }
      },
      {
        Sid       = "AllowBackupJobRole"
        Effect    = "Allow"
        Principal = { AWS = aws_iam_role.backup_job.arn }
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:GetObjectAttributes"
        ]
        Resource = [
          aws_s3_bucket.postgres_backup.arn,
          "${aws_s3_bucket.postgres_backup.arn}/*"
        ]
      }
    ]
  })
}

# ── IAM role for the K8s backup CronJob (IRSA) ───────────────────────────────
resource "aws_iam_role" "backup_job" {
  name        = "${var.project_name}-backup-job-${var.environment}"
  description = "IRSA role for the postgres-backup CronJob in K8s"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/${local.eks_oidc_issuer}"
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${local.eks_oidc_issuer}:sub" = "system:serviceaccount:aura-vault:postgres-backup"
          "${local.eks_oidc_issuer}:aud" = "sts.amazonaws.com"
        }
      }
    }]
  })

  tags = {
    Name        = "${var.project_name}-backup-job-${var.environment}"
    Project     = var.project_name
    Environment = local.cost_environment
    ManagedBy   = "terraform"
  }
}

# Inline policy: allow reading/writing backup objects and using the KMS key
resource "aws_iam_role_policy" "backup_job_s3" {
  name = "backup-s3-access"
  role = aws_iam_role.backup_job.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowS3BackupAccess"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:GetObjectAttributes"
        ]
        Resource = [
          aws_s3_bucket.postgres_backup.arn,
          "${aws_s3_bucket.postgres_backup.arn}/postgres-backups/*"
        ]
      },
      {
        Sid    = "AllowKMSForBackup"
        Effect = "Allow"
        Action = [
          "kms:GenerateDataKey",
          "kms:Decrypt",
          "kms:DescribeKey"
        ]
        Resource = aws_kms_key.backup.arn
      }
    ]
  })
}

# ── Data sources ──────────────────────────────────────────────────────────────
data "aws_caller_identity" "current" {}

# EKS OIDC issuer — adjust this local to match your EKS cluster
locals {
  # Strip the https:// prefix for OIDC provider ARN construction
  eks_oidc_issuer = replace(
    var.eks_oidc_issuer_url,
    "https://",
    ""
  )
}

# ── Outputs ───────────────────────────────────────────────────────────────────
output "backup_bucket_name" {
  description = "Name of the S3 backup bucket — set as BACKUP_BUCKET in K8s ConfigMap"
  value       = aws_s3_bucket.postgres_backup.id
}

output "backup_bucket_arn" {
  description = "ARN of the S3 backup bucket"
  value       = aws_s3_bucket.postgres_backup.arn
}

output "backup_kms_key_arn" {
  description = "ARN of the KMS key used for backup SSE"
  value       = aws_kms_key.backup.arn
}

output "backup_job_role_arn" {
  description = "IAM role ARN for IRSA — annotate K8s ServiceAccount with this"
  value       = aws_iam_role.backup_job.arn
}

# =============================================================================
# Cross-Region S3 Replication — Issue #961
#
# Replicates all objects from the primary backup bucket (us-east-1) to a
# secondary bucket in us-west-2 for disaster-recovery compliance.
#
# Resources added:
#   - aws_s3_bucket.postgres_backup_replica       — destination bucket (us-west-2)
#   - aws_kms_key.backup_replica                  — CMK for destination SSE-KMS
#   - aws_s3_bucket_replication_configuration     — CRR rule on source bucket
#   - aws_iam_role.backup_replication             — IAM role for S3 replication
#   - aws_cloudwatch_metric_alarm.replication_lag — fires if lag > 1 hour
# =============================================================================

# ── Replica KMS key (us-west-2) ───────────────────────────────────────────────
resource "aws_kms_key" "backup_replica" {
  provider                = aws.replica
  description             = "${var.project_name}-${var.environment} PostgreSQL backup replica encryption key (us-west-2)"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name        = "${var.project_name}-backup-replica-key-${var.environment}"
    Project     = var.project_name
    Environment = local.cost_environment
    ManagedBy   = "terraform"
    Region      = "us-west-2"
  }
}

resource "aws_kms_alias" "backup_replica" {
  provider      = aws.replica
  name          = "alias/${var.project_name}-backup-replica-${var.environment}"
  target_key_id = aws_kms_key.backup_replica.key_id
}

# ── Replica bucket (us-west-2) ────────────────────────────────────────────────
resource "aws_s3_bucket" "postgres_backup_replica" {
  provider = aws.replica
  bucket   = "${var.project_name}-db-backups-replica-${var.environment}"

  tags = {
    Name        = "${var.project_name}-db-backups-replica-${var.environment}"
    Project     = var.project_name
    Environment = local.cost_environment
    ManagedBy   = "terraform"
    Purpose     = "postgresql-backups-dr-replica"
    Region      = "us-west-2"
  }
}

resource "aws_s3_bucket_public_access_block" "postgres_backup_replica" {
  provider = aws.replica
  bucket   = aws_s3_bucket.postgres_backup_replica.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Versioning must be enabled on the destination for CRR
resource "aws_s3_bucket_versioning" "postgres_backup_replica" {
  provider = aws.replica
  bucket   = aws_s3_bucket.postgres_backup_replica.id

  versioning_configuration {
    status = "Enabled"
  }
}

# SSE-KMS with the replica-region CMK
resource "aws_s3_bucket_server_side_encryption_configuration" "postgres_backup_replica" {
  provider = aws.replica
  bucket   = aws_s3_bucket.postgres_backup_replica.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.backup_replica.arn
    }
    bucket_key_enabled = true
  }
}

# Enforce TLS-only access on the replica bucket
resource "aws_s3_bucket_policy" "postgres_backup_replica" {
  provider = aws.replica
  bucket   = aws_s3_bucket.postgres_backup_replica.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyNonTLSRequests"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.postgres_backup_replica.arn,
          "${aws_s3_bucket.postgres_backup_replica.arn}/*"
        ]
        Condition = {
          Bool = { "aws:SecureTransport" = "false" }
        }
      }
    ]
  })
}

# Mirror the same lifecycle on the replica bucket (30-day retention)
resource "aws_s3_bucket_lifecycle_configuration" "postgres_backup_replica" {
  provider   = aws.replica
  depends_on = [aws_s3_bucket_versioning.postgres_backup_replica]

  bucket = aws_s3_bucket.postgres_backup_replica.id

  rule {
    id     = "postgres-backup-30day-retention-replica"
    status = "Enabled"

    filter {
      prefix = "postgres-backups/"
    }

    transition {
      days          = 7
      storage_class = "STANDARD_IA"
    }

    transition {
      days          = 14
      storage_class = "GLACIER_IR"
    }

    expiration {
      days = 30
    }

    noncurrent_version_expiration {
      noncurrent_days = 7
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# ── IAM role for S3 Cross-Region Replication ─────────────────────────────────
resource "aws_iam_role" "backup_replication" {
  name        = "${var.project_name}-backup-replication-${var.environment}"
  description = "Allows S3 to replicate backup objects from us-east-1 to us-west-2"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "s3.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = {
    Name        = "${var.project_name}-backup-replication-${var.environment}"
    Project     = var.project_name
    Environment = local.cost_environment
    ManagedBy   = "terraform"
  }
}

resource "aws_iam_role_policy" "backup_replication" {
  name = "backup-replication-policy"
  role = aws_iam_role.backup_replication.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SourceBucketRead"
        Effect = "Allow"
        Action = [
          "s3:GetReplicationConfiguration",
          "s3:ListBucket"
        ]
        Resource = aws_s3_bucket.postgres_backup.arn
      },
      {
        Sid    = "SourceObjectRead"
        Effect = "Allow"
        Action = [
          "s3:GetObjectVersionForReplication",
          "s3:GetObjectVersionAcl",
          "s3:GetObjectVersionTagging"
        ]
        Resource = "${aws_s3_bucket.postgres_backup.arn}/*"
      },
      {
        Sid    = "DestinationBucketWrite"
        Effect = "Allow"
        Action = [
          "s3:ReplicateObject",
          "s3:ReplicateDelete",
          "s3:ReplicateTags"
        ]
        Resource = "${aws_s3_bucket.postgres_backup_replica.arn}/*"
      },
      {
        Sid    = "SourceKMSDecrypt"
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:DescribeKey"
        ]
        Resource = aws_kms_key.backup.arn
        Condition = {
          StringLike = {
            "kms:ViaService"            = "s3.us-east-1.amazonaws.com"
            "kms:EncryptionContext:aws:s3:arn" = "${aws_s3_bucket.postgres_backup.arn}/*"
          }
        }
      },
      {
        Sid    = "DestinationKMSEncrypt"
        Effect = "Allow"
        Action = [
          "kms:GenerateDataKey",
          "kms:DescribeKey"
        ]
        Resource = aws_kms_key.backup_replica.arn
        Condition = {
          StringLike = {
            "kms:ViaService"            = "s3.us-west-2.amazonaws.com"
            "kms:EncryptionContext:aws:s3:arn" = "${aws_s3_bucket.postgres_backup_replica.arn}/*"
          }
        }
      }
    ]
  })
}

# ── Cross-Region Replication configuration on the source bucket ──────────────
resource "aws_s3_bucket_replication_configuration" "postgres_backup" {
  # Replication requires versioning to be enabled first
  depends_on = [aws_s3_bucket_versioning.postgres_backup]

  bucket = aws_s3_bucket.postgres_backup.id
  role   = aws_iam_role.backup_replication.arn

  rule {
    id     = "replicate-backups-to-us-west-2"
    status = "Enabled"

    filter {
      prefix = "postgres-backups/"
    }

    destination {
      bucket        = aws_s3_bucket.postgres_backup_replica.arn
      storage_class = "STANDARD_IA"

      # Re-encrypt with the destination region's KMS key
      encryption_configuration {
        replica_kms_key_id = aws_kms_key.backup_replica.arn
      }

      # Replicate object-level metrics for lag monitoring
      metrics {
        status = "Enabled"
        event_threshold {
          minutes = 15
        }
      }

      # Enable Replication Time Control (RTC) — guarantees 15-min replication
      replication_time {
        status = "Enabled"
        time {
          minutes = 15
        }
      }
    }

    # Replicate existing versions (delete markers)
    delete_marker_replication {
      status = "Enabled"
    }

    source_selection_criteria {
      sse_kms_encrypted_objects {
        status = "Enabled"
      }
    }
  }
}

# ── CloudWatch alarm: replication lag > 1 hour ───────────────────────────────
# S3 Replication Time Control emits OperationsFailedReplication / ReplicationLatency
# metrics to CloudWatch under the AWS/S3 namespace.
resource "aws_cloudwatch_metric_alarm" "replication_lag" {
  alarm_name          = "${var.project_name}-backup-replication-lag-${var.environment}"
  alarm_description   = "S3 backup replication lag exceeds 1 hour — DR RPO at risk"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "ReplicationLatency"
  namespace           = "AWS/S3"
  period              = 1800 # 30 minutes
  statistic           = "Maximum"
  threshold           = 3600 # 1 hour in seconds
  treat_missing_data  = "notBreaching"

  dimensions = {
    SourceBucket      = aws_s3_bucket.postgres_backup.id
    DestinationBucket = aws_s3_bucket.postgres_backup_replica.id
    RuleId            = "replicate-backups-to-us-west-2"
  }

  tags = {
    Name        = "${var.project_name}-backup-replication-lag-${var.environment}"
    Project     = var.project_name
    Environment = local.cost_environment
    ManagedBy   = "terraform"
  }
}

# ── AWS provider alias for us-west-2 (replica region) ────────────────────────
# Add to your provider.tf or root module:
#
#   provider "aws" {
#     alias  = "replica"
#     region = "us-west-2"
#   }
#
# This block documents the requirement; actual provider alias lives in provider.tf.

# ── Additional outputs ────────────────────────────────────────────────────────
output "backup_replica_bucket_name" {
  description = "Name of the S3 replica backup bucket in us-west-2"
  value       = aws_s3_bucket.postgres_backup_replica.id
}

output "backup_replica_bucket_arn" {
  description = "ARN of the S3 replica backup bucket in us-west-2"
  value       = aws_s3_bucket.postgres_backup_replica.arn
}

output "backup_replica_kms_key_arn" {
  description = "ARN of the KMS key in us-west-2 used for replica bucket SSE"
  value       = aws_kms_key.backup_replica.arn
}

output "backup_replication_role_arn" {
  description = "IAM role ARN used by S3 CRR"
  value       = aws_iam_role.backup_replication.arn
}
