# S3 Bucket for Static Assets
resource "aws_s3_bucket" "static_assets" {
  bucket = "${var.project_name}-static-assets-${var.environment}-${random_id.bucket_suffix.hex}"
  
  tags = {
    Name = "${var.project_name}-static-assets-${var.environment}"
    Component = "frontend"
  }
}

# S3 Bucket Versioning
resource "aws_s3_bucket_versioning" "static_assets" {
  bucket = aws_s3_bucket.static_assets.id
  versioning_configuration {
    status = "Enabled"
  }
}

# S3 Bucket Server-Side Encryption
resource "aws_s3_bucket_server_side_encryption_configuration" "static_assets" {
  bucket = aws_s3_bucket.static_assets.id
  
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# S3 Bucket Public Access Block (for CloudFront OAI)
resource "aws_s3_bucket_public_access_block" "static_assets" {
  bucket = aws_s3_bucket.static_assets.id
  
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# S3 Bucket Policy for CloudFront OAI
resource "aws_s3_bucket_policy" "static_assets" {
  bucket = aws_s3_bucket.static_assets.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontServicePrincipal"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.static_assets.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.main[0].arn
          }
        }
      }
    ]
  })
}

# CloudFront Origin Access Control
resource "aws_cloudfront_origin_access_control" "main" {
  name                              = "${var.project_name}-oac-${var.environment}"
  description                       = "OAC for ${var.project_name} static assets"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# CloudFront Distribution
resource "aws_cloudfront_distribution" "main" {
  count = var.enable_cloudfront ? 1 : 0
  
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100" # Cost optimization - US/Europe
  
  origin {
    domain_name              = aws_s3_bucket.static_assets.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.main.id
    origin_id                = "S3-${aws_s3_bucket.static_assets.id}"
    
    s3_origin_config {
      origin_access_identity = "" # Using OAC instead of OAI
    }
  }
  
  # Custom origin for backend API
  dynamic "origin" {
    for_each = var.domain_name != "" ? [1] : []
    content {
      domain_name = var.domain_name
      origin_id   = "ALB-${aws_lb.main.id}"
      
      custom_origin_config {
        http_port              = 80
        https_port             = 443
        origin_protocol_policy = "https-only"
        origin_ssl_protocols   = ["TLSv1.2"]
      }
    }
  }
  
  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-${aws_s3_bucket.static_assets.id}"
    
    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
    
    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 86400
    max_ttl                = 31536000
    compress               = true
    
    # Cache policy for static assets
    cache_policy_id = aws_cloudfront_cache_policy.static_assets.id
  }
  
  # Cache behavior for API requests
  dynamic "ordered_cache_behavior" {
    for_each = var.domain_name != "" ? [1] : []
    content {
      path_pattern     = "/api/*"
      allowed_methods  = ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"]
      cached_methods   = ["GET", "HEAD"]
      target_origin_id = "ALB-${aws_lb.main.id}"
      
      forwarded_values {
        query_string = true
        headers      = ["Authorization", "Content-Type"]
        cookies {
          forward = "all"
        }
      }
      
      viewer_protocol_policy = "redirect-to-https"
      min_ttl                = 0
      default_ttl            = 0
      max_ttl                = 0
      compress               = false
      
      cache_policy_id = aws_cloudfront_cache_policy.api.id
    }
  }
  
  viewer_certificate {
    cloudfront_default_certificate = var.domain_name == ""
    acm_certificate_arn            = var.domain_name != "" ? aws_acm_certificate.main[0].arn : ""
    ssl_support_method            = "sni-only"
  }
  
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
  
  tags = {
    Name = "${var.project_name}-cloudfront-${var.environment}"
    Component = "frontend"
  }
}

# CloudFront Cache Policy for Static Assets
resource "aws_cloudfront_cache_policy" "static_assets" {
  name        = "${var.project_name}-static-assets-policy-${var.environment}"
  default_ttl = 86400
  max_ttl     = 31536000
  min_ttl     = 0
  
  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true
  }
}

# CloudFront Cache Policy for API
resource "aws_cloudfront_cache_policy" "api" {
  name        = "${var.project_name}-api-policy-${var.environment}"
  default_ttl = 0
  max_ttl     = 0
  min_ttl     = 0
  
  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "all"
    }
    headers_config {
      header_behavior = "whitelist"
      headers {
        items = ["Authorization", "Content-Type"]
      }
    }
    query_strings_config {
      query_string_behavior = "all"
    }
    enable_accept_encoding_gzip   = false
    enable_accept_encoding_brotli = false
  }
}

# Random ID for unique bucket naming
resource "random_id" "bucket_suffix" {
  byte_length = 4
}
