# S3 Bucket for ALB Logs
resource "aws_s3_bucket" "alb_logs" {
  bucket = "${var.project_name}-alb-logs-${var.environment}-${random_id.logs_suffix.hex}"
  
  tags = {
    Name = "${var.project_name}-alb-logs-${var.environment}"
  }
}

# S3 Bucket Lifecycle for ALB Logs
resource "aws_s3_bucket_lifecycle_configuration" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id
  
  rule {
    id     = "log-retention"
    status = "Enabled"
    
    expiration {
      days = 30
    }
    
    transition {
      days          = 7
      storage_class = "STANDARD_IA"
    }
  }
}

# S3 Bucket Public Access Block for ALB Logs
resource "aws_s3_bucket_public_access_block" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id
  
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# CloudWatch Dashboard
resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${var.project_name}-dashboard-${var.environment}"
  
  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        
        properties = {
          metrics = [
            ["AWS/EC2", "CPUUtilization", "AutoScalingGroupName", aws_autoscaling_group.backend.name],
            [".", "NetworkIn", ".", "."],
            [".", "NetworkOut", ".", "."]
          ]
          period = 300
          stat   = "Average"
          region = var.aws_region
          title  = "EC2 Instances"
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        
        properties = {
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", "LoadBalancerName", aws_lb.main.name_suffix],
            [".", "TargetResponseTime", ".", "."],
            [".", "HTTPCode_Target_5XX_Count", ".", "."],
            [".", "HTTPCode_Target_4XX_Count", ".", "."]
          ]
          period = 300
          stat   = "Sum"
          region = var.aws_region
          title  = "ALB Metrics"
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        
        properties = {
          metrics = [
            ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", aws_db_instance.main.identifier],
            [".", "DatabaseConnections", ".", "."],
            [".", "ReadLatency", ".", "."],
            [".", "WriteLatency", ".", "."]
          ]
          period = 300
          stat   = "Average"
          region = var.aws_region
          title  = "RDS Metrics"
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        
        properties = {
          metrics = [
            ["AWS/CloudFront", "Requests", "DistributionId", var.enable_cloudfront ? aws_cloudfront_distribution.main[0].id : ""],
            [".", "BytesDownloaded", ".", "."],
            [".", "4xxErrorRate", ".", "."],
            [".", "5xxErrorRate", ".", "."]
          ]
          period = 300
          stat   = "Sum"
          region = var.aws_region
          title  = "CloudFront Metrics"
        }
      },
      {
        type   = "text"
        x      = 0
        y      = 12
        width  = 24
        height = 3
        
        properties = {
          markdown = "# ${var.project_name} - ${var.environment} Dashboard\n\nMonitoring dashboard for Aura Vault Protocol infrastructure"
        }
      }
    ]
  })
}

# CloudWatch Alarm - ALB 5XX Errors
resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "${var.project_name}-alb-5xx-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = "300"
  statistic           = "Sum"
  threshold           = "10"
  alarm_description   = "ALB 5XX error rate is too high"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  
  dimensions = {
    LoadBalancerName = aws_lb.main.name_suffix
  }
}

# CloudWatch Alarm - RDS CPU High
resource "aws_cloudwatch_metric_alarm" "rds_cpu_high" {
  alarm_name          = "${var.project_name}-rds-cpu-high-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = "300"
  statistic           = "Average"
  threshold           = "80"
  alarm_description   = "RDS CPU utilization is too high"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  
  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.identifier
  }
}

# CloudWatch Alarm - RDS Connection Count
resource "aws_cloudwatch_metric_alarm" "rds_connections" {
  alarm_name          = "${var.project_name}-rds-connections-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "DatabaseConnections"
  namespace           = "AWS/RDS"
  period              = "300"
  statistic           = "Average"
  threshold           = "80"
  alarm_description   = "RDS connection count is too high"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  
  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.identifier
  }
}

# SNS Topic for Alerts
resource "aws_sns_topic" "alerts" {
  name = "${var.project_name}-alerts-${var.environment}"
  
  tags = {
    Name = "${var.project_name}-alerts-${var.environment}"
  }
}

# SNS Topic Subscription (Email)
resource "aws_sns_topic_subscription" "email_alerts" {
  count     = var.alert_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

variable "alert_email" {
  description = "Email address for alert notifications"
  type        = string
  default     = ""
}

# =============================================================================
# CloudWatch Log Groups — tiered retention for cost optimisation
#
# Tier          | Retention | Rationale
# --------------|-----------|---------------------------------------------------
# application   | 30 days   | INFO-level operational logs
# error         | 90 days   | ERROR/WARN logs for post-incident analysis
# security      | 365 days  | Audit / security events for compliance
# debug         | 7 days    | DEBUG/TRACE — high volume, short-lived value
# =============================================================================

# Application logs (INFO level) — 30 days
resource "aws_cloudwatch_log_group" "application" {
  name              = "/aws/${var.project_name}/${var.environment}/application"
  retention_in_days = 30

  tags = {
    Name        = "${var.project_name}-application-logs-${var.environment}"
    LogTier     = "application"
    Environment = local.cost_environment
    ManagedBy   = "terraform"
  }
}

# Error logs — 90 days
resource "aws_cloudwatch_log_group" "error" {
  name              = "/aws/${var.project_name}/${var.environment}/error"
  retention_in_days = 90

  tags = {
    Name        = "${var.project_name}-error-logs-${var.environment}"
    LogTier     = "error"
    Environment = local.cost_environment
    ManagedBy   = "terraform"
  }
}

# Security / audit logs — 365 days
resource "aws_cloudwatch_log_group" "security" {
  name              = "/aws/${var.project_name}/${var.environment}/security"
  retention_in_days = 365

  tags = {
    Name        = "${var.project_name}-security-logs-${var.environment}"
    LogTier     = "security"
    Environment = local.cost_environment
    ManagedBy   = "terraform"
  }
}

# Debug logs — 7 days
resource "aws_cloudwatch_log_group" "debug" {
  name              = "/aws/${var.project_name}/${var.environment}/debug"
  retention_in_days = 7

  tags = {
    Name        = "${var.project_name}-debug-logs-${var.environment}"
    LogTier     = "debug"
    Environment = local.cost_environment
    ManagedBy   = "terraform"
  }
}

# CloudWatch Metric Alarm — log ingestion rate budget guard
# Triggers if total ingest bytes across all log groups exceeds threshold.
# Adjust threshold_bytes to match your cost budget (default: ~5 GB/day ≈ 150 GB/month).
variable "log_ingestion_budget_bytes" {
  description = "Daily log ingestion budget in bytes. Alarm fires when exceeded."
  type        = number
  default     = 5368709120 # 5 GiB/day
}

resource "aws_cloudwatch_metric_alarm" "log_ingestion_budget" {
  alarm_name          = "${var.project_name}-log-ingestion-budget-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "IncomingBytes"
  namespace           = "AWS/Logs"
  period              = 86400 # 24 hours
  statistic           = "Sum"
  threshold           = var.log_ingestion_budget_bytes
  alarm_description   = "Daily CloudWatch log ingestion has exceeded the cost budget threshold"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "notBreaching"

  tags = {
    Name        = "${var.project_name}-log-ingestion-budget-${var.environment}"
    Environment = local.cost_environment
    ManagedBy   = "terraform"
  }
}

# Budget for Cost Monitoring
resource "aws_budgets_budget" "monthly" {
  name              = "${var.project_name}-monthly-budget-${var.environment}"
  budget_type       = "COST"
  limit_amount      = var.monthly_budget_limit
  limit_unit        = "USD"
  time_period_end   = "2087-06-15_00:00"
  time_period_start = "2024-01-01_00:00"
  time_unit         = "MONTHLY"
  
  notification {
    comparison_operator        = "GREATER_THAN"
    notification_type           = "ACTUAL_COST"
    subscriber_email_addresses = var.alert_email != "" ? [var.alert_email] : []
    threshold_percentage       = 80
  }
  
  notification {
    comparison_operator        = "GREATER_THAN"
    notification_type           = "ACTUAL_COST"
    subscriber_email_addresses = var.alert_email != "" ? [var.alert_email] : []
    threshold_percentage       = 100
  }
}

variable "monthly_budget_limit" {
  description = "Monthly budget limit in USD"
  type        = number
  default     = 500
}

# Random ID for logs bucket naming
resource "random_id" "logs_suffix" {
  byte_length = 4
}
