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
    Environment = var.environment
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
    Environment = var.environment
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
    Environment = var.environment
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
