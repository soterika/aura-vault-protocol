# SES Domain Identity
resource "aws_ses_domain_identity" "main" {
  count = var.domain_name != "" && var.enable_email_forwarding ? 1 : 0
  
  domain = var.domain_name
  
  tags = {
    Name = "${var.project_name}-ses-domain-${var.environment}"
  }
}

# SES Domain DKIM Verification
resource "aws_ses_domain_dkim" "main" {
  count = var.domain_name != "" && var.enable_email_forwarding ? 1 : 0
  
  domain = aws_ses_domain_identity.main[0].domain
}

# Route53 Records for DKIM
resource "aws_route53_record" "dkim" {
  count = var.domain_name != "" && var.enable_email_forwarding ? 3 : 0
  
  zone_id = aws_route53_zone.main[0].zone_id
  name    = "${element(aws_ses_domain_dkim.main[0].dkim_tokens, count.index)}._domainkey"
  type    = "CNAME"
  ttl     = 600
  records = ["${element(aws_ses_domain_dkim.main[0].dkim_tokens, count.index)}.dkim.amazonses.com"]
}

# SES Domain Verification Record
resource "aws_route53_record" "ses_verification" {
  count = var.domain_name != "" && var.enable_email_forwarding ? 1 : 0
  
  zone_id = aws_route53_zone.main[0].zone_id
  name    = "_amazonses.${var.domain_name}"
  type    = "TXT"
  ttl     = 600
  records = [aws_ses_domain_identity.main[0].verification_token]
}

# SES Receipt Rule Set
resource "aws_ses_receipt_rule_set" "main" {
  count = var.domain_name != "" && var.enable_email_forwarding ? 1 : 0
  
  rule_set_name = "${var.project_name}-receipt-rule-set-${var.environment}"
}

# SES Receipt Rule for Email Forwarding
resource "aws_ses_receipt_rule" "forwarding" {
  count = var.domain_name != "" && var.enable_email_forwarding ? 1 : 0
  
  name          = "${var.project_name}-forwarding-rule-${var.environment}"
  rule_set_name = aws_ses_receipt_rule_set.main[0].rule_set_name
  enabled       = true
  
  recipients = var.email_forwarding_recipients
  
  s3_action {
    bucket_name = aws_s3_bucket.email_storage[0].id
    position    = 1
  }
  
  lambda_action {
    function_arn    = aws_lambda_function.email_forwarder[0].arn
    invocation_type = "Event"
    position        = 2
  }
  
  depends_on = [aws_ses_receipt_rule_set.main]
}

# S3 Bucket for Email Storage
resource "aws_s3_bucket" "email_storage" {
  count = var.domain_name != "" && var.enable_email_forwarding ? 1 : 0
  
  bucket = "${var.project_name}-email-storage-${var.environment}-${random_id.email_suffix.hex}"
  
  tags = {
    Name = "${var.project_name}-email-storage-${var.environment}"
  }
}

# S3 Bucket Versioning for Email Storage
resource "aws_s3_bucket_versioning" "email_storage" {
  count = var.domain_name != "" && var.enable_email_forwarding ? 1 : 0
  
  bucket = aws_s3_bucket.email_storage[0].id
  versioning_configuration {
    status = "Enabled"
  }
}

# S3 Bucket Server-Side Encryption for Email Storage
resource "aws_s3_bucket_server_side_encryption_configuration" "email_storage" {
  count = var.domain_name != "" && var.enable_email_forwarding ? 1 : 0
  
  bucket = aws_s3_bucket.email_storage[0].id
  
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# S3 Bucket Lifecycle for Email Storage
resource "aws_s3_bucket_lifecycle_configuration" "email_storage" {
  count = var.domain_name != "" && var.enable_email_forwarding ? 1 : 0
  
  bucket = aws_s3_bucket.email_storage[0].id
  
  rule {
    id     = "email-retention"
    status = "Enabled"
    
    expiration {
      days = 30
    }
  }
}

# Lambda Function for Email Forwarding
resource "aws_lambda_function" "email_forwarder" {
  count = var.domain_name != "" && var.enable_email_forwarding ? 1 : 0
  
  function_name = "${var.project_name}-email-forwarder-${var.environment}"
  role          = aws_iam_role.email_forwarder[0].arn
  handler       = "index.handler"
  runtime       = "python3.11"
  
  timeout     = 60
  memory_size = 128
  
  s3_bucket = aws_s3_bucket.lambda_code.id
  s3_key    = aws_s3_object.lambda_email_code.key
  
  environment {
    variables = {
      FORWARD_TO_ADDRESSES = join(",", var.email_forwarding_destinations)
      EMAIL_STORAGE_BUCKET = aws_s3_bucket.email_storage[0].id
    }
  }
  
  tags = {
    Name = "${var.project_name}-email-forwarder-${var.environment}"
  }
  
  depends_on = [aws_cloudwatch_log_group.email_forwarder]
}

# CloudWatch Log Group for Email Forwarder Lambda
resource "aws_cloudwatch_log_group" "email_forwarder" {
  count = var.domain_name != "" && var.enable_email_forwarding ? 1 : 0
  
  name              = "/aws/lambda/${var.project_name}-email-forwarder-${var.environment}"
  retention_in_days = 7
}

# IAM Role for Email Forwarder Lambda
resource "aws_iam_role" "email_forwarder" {
  count = var.domain_name != "" && var.enable_email_forwarding ? 1 : 0
  
  name = "${var.project_name}-email-forwarder-${var.environment}"
  
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
    Name = "${var.project_name}-email-forwarder-${var.environment}"
  }
}

# IAM Policy for Email Forwarder Lambda
resource "aws_iam_role_policy" "email_forwarder" {
  count = var.domain_name != "" && var.enable_email_forwarding ? 1 : 0
  
  name = "${var.project_name}-email-forwarder-policy-${var.environment}"
  role = aws_iam_role.email_forwarder[0].id
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ses:SendEmail",
          "ses:SendRawEmail"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject"
        ]
        Resource = [
          aws_s3_bucket.email_storage[0].arn,
          "${aws_s3_bucket.email_storage[0].arn}/*"
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

# Lambda Permission for SES
resource "aws_lambda_permission" "allow_ses" {
  count = var.domain_name != "" && var.enable_email_forwarding ? 1 : 0
  
  statement_id  = "AllowExecutionFromSES"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.email_forwarder[0].function_name
  principal     = "ses.amazonaws.com"
  source_arn    = aws_ses_receipt_rule_set.main[0].arn
}

# S3 Object for Lambda Email Code
resource "aws_s3_object" "lambda_email_code" {
  count = var.domain_name != "" && var.enable_email_forwarding ? 1 : 0
  
  bucket = aws_s3_bucket.lambda_code.id
  key    = "email-forwarder.zip"
  source = "${path.module}/lambda/email-forwarder.zip"
  
  # Placeholder - needs actual deployment package
}

# Random ID for email bucket naming
resource "random_id" "email_suffix" {
  byte_length = 4
}

# Variables for Email Configuration
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
