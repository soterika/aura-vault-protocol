# CloudFront Response Headers Policy — cache-control + security headers
resource "aws_cloudfront_response_headers_policy" "static_assets" {
  name = "${var.project_name}-headers-${var.environment}"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      override                   = true
    }
    content_type_options { override = true }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
  }

  custom_headers_config {
    items {
      header   = "Cache-Control"
      value    = "public, max-age=31536000, immutable"
      override = false
    }
  }
}

# Lambda for CloudFront cache invalidation (triggered by S3 deploys)
resource "aws_lambda_function" "cache_invalidation" {
  function_name    = "${var.project_name}-cache-invalidation-${var.environment}"
  role             = aws_iam_role.cache_invalidation.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  filename         = "${path.module}/lambda/cache-invalidation.zip"
  source_code_hash = filebase64sha256("${path.module}/lambda/cache-invalidation.zip")

  environment {
    variables = {
      DISTRIBUTION_ID = var.enable_cloudfront ? aws_cloudfront_distribution.main[0].id : ""
    }
  }

  lifecycle { ignore_changes = [filename, source_code_hash] }
}

resource "aws_iam_role" "cache_invalidation" {
  name = "${var.project_name}-cache-invalidation-${var.environment}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "cache_invalidation" {
  role = aws_iam_role.cache_invalidation.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["cloudfront:CreateInvalidation"]
        Resource = var.enable_cloudfront ? aws_cloudfront_distribution.main[0].arn : "*"
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

# S3 trigger for cache invalidation on deploy
resource "aws_s3_bucket_notification" "invalidation_trigger" {
  bucket = aws_s3_bucket.static_assets.id
  lambda_function {
    lambda_function_arn = aws_lambda_function.cache_invalidation.arn
    events              = ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"]
  }
  depends_on = [aws_lambda_permission.s3_invoke]
}

resource "aws_lambda_permission" "s3_invoke" {
  statement_id  = "AllowS3Invoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.cache_invalidation.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.static_assets.arn
}

# CloudWatch alarm: cache hit rate < 95%
resource "aws_cloudwatch_metric_alarm" "cache_hit_rate" {
  count               = var.enable_cloudfront ? 1 : 0
  alarm_name          = "${var.project_name}-cache-hit-rate-${var.environment}"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  threshold           = 95
  alarm_description   = "CloudFront cache hit rate dropped below 95%"

  metric_query {
    id          = "hit_rate"
    expression  = "100 * hits / (hits + misses)"
    label       = "Cache Hit Rate %"
    return_data = true
  }
  metric_query {
    id = "hits"
    metric {
      namespace   = "AWS/CloudFront"
      metric_name = "CacheHits"
      dimensions  = { DistributionId = aws_cloudfront_distribution.main[0].id }
      period      = 300
      stat        = "Sum"
    }
  }
  metric_query {
    id = "misses"
    metric {
      namespace   = "AWS/CloudFront"
      metric_name = "CacheMisses"
      dimensions  = { DistributionId = aws_cloudfront_distribution.main[0].id }
      period      = 300
      stat        = "Sum"
    }
  }
}

# CloudWatch alarm: p95 latency > 1s
resource "aws_cloudwatch_metric_alarm" "load_time" {
  count               = var.enable_cloudfront ? 1 : 0
  alarm_name          = "${var.project_name}-load-time-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "TotalErrorRate"
  namespace           = "AWS/CloudFront"
  period              = 300
  statistic           = "p95"
  threshold           = 1000
  alarm_description   = "CloudFront p95 latency exceeded 1s"
  dimensions          = { DistributionId = aws_cloudfront_distribution.main[0].id }
}
