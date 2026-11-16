# CloudWatch Alarm for DNS Health Check
resource "aws_cloudwatch_metric_alarm" "dns_health_check" {
  count = var.domain_name != "" ? 1 : 0
  
  alarm_name          = "${var.project_name}-dns-health-check-${var.environment}"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "HealthCheckStatus"
  namespace           = "AWS/Route53"
  period              = "300"
  statistic           = "Minimum"
  threshold           = "1"
  alarm_description   = "DNS health check is failing"
  alarm_actions       = var.alert_email != "" ? [aws_sns_topic.alerts.arn] : []
  
  dimensions = {
    HealthCheckId = aws_route53_health_check.alb[0].id
  }
}

# CloudWatch Alarm for Certificate Expiry
resource "aws_cloudwatch_metric_alarm" "cert_expiry" {
  count = var.domain_name != "" ? 1 : 0
  
  alarm_name          = "${var.project_name}-cert-expiry-${var.environment}"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = "1"
  metric_name         = "DaysToExpiry"
  namespace           = "AWS/CertificateManager"
  period              = 86400
  statistic           = "Minimum"
  threshold           = "30"
  alarm_description   = "SSL certificate will expire in less than 30 days"
  alarm_actions       = var.alert_email != "" ? [aws_sns_topic.alerts.arn] : []
  
  dimensions = {
    DomainName = var.domain_name
  }
}

# CloudWatch Dashboard for DNS Monitoring
resource "aws_cloudwatch_dashboard" "dns" {
  count = var.domain_name != "" ? 1 : 0
  
  dashboard_name = "${var.project_name}-dns-dashboard-${var.environment}"
  
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
            ["AWS/Route53", "HealthCheckStatus", "HealthCheckId", aws_route53_health_check.alb[0].id]
          ]
          period = 300
          stat   = "Minimum"
          region = var.aws_region
          title  = "DNS Health Check Status"
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
            ["AWS/CertificateManager", "DaysToExpiry", "DomainName", var.domain_name]
          ]
          period = 86400
          stat   = "Minimum"
          region = var.aws_region
          title  = "SSL Certificate Days to Expiry"
        }
      },
      {
        type   = "text"
        x      = 0
        y      = 6
        width  = 24
        height = 3
        
        properties = {
          markdown = "# ${var.project_name} DNS Monitoring\n\nMonitoring dashboard for DNS and SSL certificate health"
        }
      }
    ]
  })
}

# Lambda Function for DNS Propagation Check
resource "aws_lambda_function" "dns_check" {
  count = var.domain_name != "" ? 1 : 0
  
  function_name = "${var.project_name}-dns-check-${var.environment}"
  role          = aws_iam_role.dns_check[0].arn
  handler       = "dns_check.handler"
  runtime       = "python3.11"
  
  timeout     = 60
  memory_size = 128
  
  s3_bucket = aws_s3_bucket.lambda_code.id
  s3_key    = aws_s3_object.lambda_dns_code.key
  
  environment {
    variables = {
      DOMAIN_NAME = var.domain_name
      EXPECTED_IP = aws_lb.main.dns_name
    }
  }
  
  tags = {
    Name = "${var.project_name}-dns-check-${var.environment}"
  }
  
  depends_on = [aws_cloudwatch_log_group.dns_check]
}

# CloudWatch Log Group for DNS Check Lambda
resource "aws_cloudwatch_log_group" "dns_check" {
  count = var.domain_name != "" ? 1 : 0
  
  name              = "/aws/lambda/${var.project_name}-dns-check-${var.environment}"
  retention_in_days = 7
}

# IAM Role for DNS Check Lambda
resource "aws_iam_role" "dns_check" {
  count = var.domain_name != "" ? 1 : 0
  
  name = "${var.project_name}-dns-check-${var.environment}"
  
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
    Name = "${var.project_name}-dns-check-${var.environment}"
  }
}

# IAM Policy for DNS Check Lambda
resource "aws_iam_role_policy" "dns_check" {
  count = var.domain_name != "" ? 1 : 0
  
  name = "${var.project_name}-dns-check-policy-${var.environment}"
  role = aws_iam_role.dns_check[0].id
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "route53:ListHostedZones",
          "route53:GetRecord",
          "route53:ListResourceRecordSets"
        ]
        Resource = "*"
      }
    ]
  })
}

# EventBridge Rule for Scheduled DNS Checks
resource "aws_cloudwatch_event_rule" "dns_check_schedule" {
  count = var.domain_name != "" ? 1 : 0
  
  name                = "${var.project_name}-dns-check-schedule-${var.environment}"
  description         = "Trigger DNS propagation check every hour"
  schedule_expression = "rate(1 hour)"
  
  tags = {
    Name = "${var.project_name}-dns-check-schedule-${var.environment}"
  }
}

# EventBridge Target for DNS Check
resource "aws_cloudwatch_event_target" "dns_check_target" {
  count = var.domain_name != "" ? 1 : 0
  
  rule      = aws_cloudwatch_event_rule.dns_check_schedule[0].name
  target_id = "lambda-dns-check"
  arn       = aws_lambda_function.dns_check[0].arn
}

# Lambda Permission for EventBridge
resource "aws_lambda_permission" "allow_dns_check_eventbridge" {
  count = var.domain_name != "" ? 1 : 0
  
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.dns_check[0].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.dns_check_schedule[0].arn
}

# S3 Object for Lambda DNS Code
resource "aws_s3_object" "lambda_dns_code" {
  count = var.domain_name != "" ? 1 : 0
  
  bucket = aws_s3_bucket.lambda_code.id
  key    = "dns-check.zip"
  source = "${path.module}/lambda/dns-check.zip"
  
  # Placeholder - needs actual deployment package
}
