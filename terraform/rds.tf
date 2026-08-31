# RDS Subnet Group
resource "aws_db_subnet_group" "main" {
  name       = "${var.project_name}-db-subnet-group-${var.environment}"
  subnet_ids = aws_subnet.private[*].id
  
  tags = {
    Name = "${var.project_name}-db-subnet-group-${var.environment}"
  }
}

# RDS Parameter Group
resource "aws_db_parameter_group" "main" {
  name   = "${var.project_name}-db-param-group-${var.environment}"
  family = "postgres15"
  
  parameter {
    name  = "max_connections"
    value = "100"
  }
  
  parameter {
    name  = "shared_buffers"
    value = "256MB"
  }
  
  parameter {
    name  = "effective_cache_size"
    value = "1GB"
  }
  
  tags = {
    Name = "${var.project_name}-db-param-group-${var.environment}"
  }
}

# RDS Instance
resource "aws_db_instance" "main" {
  identifier = "${var.project_name}-db-${var.environment}"
  
  engine         = "postgres"
  engine_version = "15.4"
  instance_class = var.db_instance_class
  
  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_allocated_storage * 2
  storage_type          = "gp3"
  storage_encrypted     = true
  
  db_name  = var.db_name
  username = var.db_username
  password = random_password.db_master.result
  
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  
  multi_az               = true
  publicly_accessible    = false
  
  backup_retention_period = 7
  backup_window          = "03:00-04:00"
  maintenance_window     = "Mon:04:00-Mon:05:00"
  
  performance_insights_enabled = true
  monitoring_interval          = 60
  monitoring_role_arn          = aws_iam_role.rds_monitoring.arn
  
  deletion_protection = var.environment == "prod"
  
  skip_final_snapshot = var.environment != "prod"
  final_snapshot_identifier = var.environment == "prod" ? "${var.project_name}-db-final-${var.environment}" : ""
  
  tags = {
    Name = "${var.project_name}-db-${var.environment}"
  }
  
  depends_on = [aws_iam_role_policy_attachment.rds_monitoring]
}

# S3 Bucket for Database Backups
resource "aws_s3_bucket" "backups" {
  bucket = "${var.project_name}-db-backups-${var.environment}-${random_id.backup_suffix.hex}"
  
  tags = {
    Name = "${var.project_name}-db-backups-${var.environment}"
  }
}

# S3 Bucket Versioning for Backups
resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id
  versioning_configuration {
    status = "Enabled"
  }
}

# S3 Bucket Server-Side Encryption for Backups
resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# S3 Bucket Lifecycle Policy for Backups
resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  
  rule {
    id     = "backup-retention"
    status = "Enabled"
    
    expiration {
      days = 90
    }
    
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
    
    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }
    
    transition {
      days          = 60
      storage_class = "GLACIER"
    }
  }
}

# S3 Bucket Public Access Block for Backups
resource "aws_s3_bucket_public_access_block" "backups" {
  bucket = aws_s3_bucket.backups.id
  
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# IAM Role for RDS Monitoring
resource "aws_iam_role" "rds_monitoring" {
  name = "${var.project_name}-rds-monitoring-${var.environment}"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "rds.amazonaws.com"
        }
      }
    ]
  })
  
  tags = {
    Name = "${var.project_name}-rds-monitoring-${var.environment}"
  }
}

# IAM Policy for RDS Monitoring
resource "aws_iam_role_policy" "rds_monitoring" {
  name = "${var.project_name}-rds-monitoring-policy-${var.environment}"
  role = aws_iam_role.rds_monitoring.id
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams"
        ]
        Resource = "*"
      }
    ]
  })
}

# IAM Role Policy Attachment
resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

# Lambda Function for Automated Backups
resource "aws_lambda_function" "db_backup" {
  function_name = "${var.project_name}-db-backup-${var.environment}"
  role          = aws_iam_role.lambda_backup.arn
  handler       = "backup.handler"
  runtime       = "python3.11"
  
  timeout     = 300
  memory_size = 256
  
  s3_bucket = aws_s3_bucket.lambda_code.id
  s3_key    = aws_s3_object.lambda_code.key
  
  environment {
    variables = {
      DB_IDENTIFIER = aws_db_instance.main.identifier
      BACKUP_BUCKET = aws_s3_bucket.backups.id
      AWS_REGION    = var.aws_region
    }
  }
  
  tags = {
    Name = "${var.project_name}-db-backup-${var.environment}"
  }
  
  depends_on = [aws_cloudwatch_log_group.lambda_backup]
}

# CloudWatch Log Group for Lambda
resource "aws_cloudwatch_log_group" "lambda_backup" {
  name              = "/aws/lambda/${var.project_name}-db-backup-${var.environment}"
  retention_in_days = 7
}

# EventBridge Rule for Scheduled Backups
resource "aws_cloudwatch_event_rule" "daily_backup" {
  name                = "${var.project_name}-daily-backup-${var.environment}"
  description         = "Trigger daily database backup"
  schedule_expression = "cron(0 3 * * ? *)"
  
  tags = {
    Name = "${var.project_name}-daily-backup-${var.environment}"
  }
}

# EventBridge Target
resource "aws_cloudwatch_event_target" "daily_backup" {
  rule      = aws_cloudwatch_event_rule.daily_backup.name
  target_id = "lambda-backup"
  arn       = aws_lambda_function.db_backup.arn
}

# Lambda Permission for EventBridge
resource "aws_lambda_permission" "allow_eventbridge" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.db_backup.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily_backup.arn
}

# IAM Role for Lambda Backup
resource "aws_iam_role" "lambda_backup" {
  name = "${var.project_name}-lambda-backup-${var.environment}"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
  
  tags = {
    Name = "${var.project_name}-lambda-backup-${var.environment}"
  }
}

# IAM Policy for Lambda Backup
resource "aws_iam_role_policy" "lambda_backup" {
  name = "${var.project_name}-lambda-backup-policy-${var.environment}"
  role = aws_iam_role.lambda_backup.id
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "rds:DescribeDBInstances",
          "rds:CreateDBSnapshot",
          "rds:DescribeDBSnapshots",
          "rds:DeleteDBSnapshot"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.backups.arn,
          "${aws_s3_bucket.backups.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "*"
      }
    ]
  })
}

# S3 Bucket for Lambda Code
resource "aws_s3_bucket" "lambda_code" {
  bucket = "${var.project_name}-lambda-code-${var.environment}"
  
  tags = {
    Name = "${var.project_name}-lambda-code-${var.environment}"
  }
}

# Lambda Code (placeholder - needs actual deployment package)
resource "aws_s3_object" "lambda_code" {
  bucket = aws_s3_bucket.lambda_code.id
  key    = "backup.zip"
  source = "${path.module}/lambda/backup.zip"
  
  # This is a placeholder - you need to package the lambda function
  # For now, we'll skip this and let the user provide the package
}

# Random ID for backup bucket naming
resource "random_id" "backup_suffix" {
  byte_length = 4
}
