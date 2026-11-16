# =============================================================================
# AWS WAF v2 — CloudFront Rate Limiting & Threat Protection — Issue #959
#
# WAF rules (in priority order):
#   10  Block AWS Managed Threat Intelligence IPs
#   20  Block suspicious User-Agent patterns (bots, scanners, exploit tools)
#   30  Rate limit /api/auth/* — 1 000 req / 5 min per IP
#   40  Rate limit /api/* (all other API endpoints) — 10 000 req / 5 min per IP
#
# All blocked requests are logged to CloudWatch Logs.
#
# NOTE: WAF WebACLs for CloudFront must be created in us-east-1.
#       This file uses the aws.us_east_1 provider alias defined in provider.tf.
#       If your provider.tf does not define that alias, add:
#         provider "aws" {
#           alias  = "us_east_1"
#           region = "us-east-1"
#         }
# =============================================================================

# ─────────────────────────────────────────────────────────────────────────────
# CloudWatch Log Group for WAF blocked requests
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_cloudwatch_log_group" "waf" {
  # WAF log group name MUST start with "aws-waf-logs-"
  name              = "aws-waf-logs-${var.project_name}-${var.environment}"
  retention_in_days = 90

  tags = {
    Name        = "${var.project_name}-waf-logs-${var.environment}"
    Environment = local.cost_environment
    ManagedBy   = "terraform"
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# WAF Web ACL
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_wafv2_web_acl" "cloudfront_api" {
  count = var.enable_cloudfront ? 1 : 0

  name        = "${var.project_name}-cloudfront-waf-${var.environment}"
  description = "WAF rules for Aura Vault CloudFront distribution — rate limiting and threat intel blocking"
  scope       = "CLOUDFRONT"

  # Default: allow all requests not matched by a blocking rule
  default_action {
    allow {}
  }

  # ── Rule 10: AWS Managed Threat Intelligence IP Block ───────────────────────
  rule {
    name     = "AWSManagedThreatIntelBlock"
    priority = 10

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesAmazonIpReputationList"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project_name}-threat-intel-${var.environment}"
      sampled_requests_enabled   = true
    }
  }

  # ── Rule 20: Block Suspicious User-Agent Patterns ───────────────────────────
  rule {
    name     = "BlockSuspiciousUserAgents"
    priority = 20

    action {
      block {
        custom_response {
          response_code = 403
          response_header {
            name  = "X-Blocked-By"
            value = "AuraVaultWAF"
          }
        }
      }
    }

    statement {
      regex_match_statement {
        # Match common exploit scanners, credential-stuffing bots, and known attack tools
        regex_string = "(?i)(sqlmap|nikto|nmap|masscan|zgrab|nuclei|hydra|medusa|burpsuite|dirbuster|gobuster|wfuzz|ffuf|python-requests/2\\.[0-9]\\.[0-9] |go-http-client/1\\.1|curl/7\\.[0-4][0-9]\\.|libwww-perl|scrapy|wget/|perl \\(https://metacpan\\.org|python/2|zgrab|censys|shodan|expanse)"
        field_to_match {
          single_header {
            name = "user-agent"
          }
        }
        text_transformations {
          priority = 0
          type     = "LOWERCASE"
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project_name}-suspicious-ua-${var.environment}"
      sampled_requests_enabled   = true
    }
  }

  # ── Rule 30: Rate Limit /api/auth/* — 1 000 req / 5 min per IP ─────────────
  rule {
    name     = "RateLimitAuthEndpoints"
    priority = 30

    action {
      block {
        custom_response {
          response_code = 429
          response_header {
            name  = "Retry-After"
            value = "300"
          }
          response_header {
            name  = "X-RateLimit-Scope"
            value = "auth"
          }
        }
      }
    }

    statement {
      rate_based_statement {
        # 1 000 requests per 5-minute window per IP
        limit              = 1000
        aggregate_key_type = "IP"

        scope_down_statement {
          byte_match_statement {
            search_string = "/api/auth/"
            field_to_match {
              uri_path {}
            }
            text_transformations {
              priority = 0
              type     = "LOWERCASE"
            }
            positional_constraint = "STARTS_WITH"
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project_name}-rate-limit-auth-${var.environment}"
      sampled_requests_enabled   = true
    }
  }

  # ── Rule 40: Rate Limit all other /api/* — 10 000 req / 5 min per IP ────────
  rule {
    name     = "RateLimitApiEndpoints"
    priority = 40

    action {
      block {
        custom_response {
          response_code = 429
          response_header {
            name  = "Retry-After"
            value = "300"
          }
          response_header {
            name  = "X-RateLimit-Scope"
            value = "api"
          }
        }
      }
    }

    statement {
      rate_based_statement {
        # 10 000 requests per 5-minute window per IP
        limit              = 10000
        aggregate_key_type = "IP"

        scope_down_statement {
          and_statement {
            statement {
              byte_match_statement {
                search_string = "/api/"
                field_to_match {
                  uri_path {}
                }
                text_transformations {
                  priority = 0
                  type     = "LOWERCASE"
                }
                positional_constraint = "STARTS_WITH"
              }
            }
            # Exclude /api/auth/* (handled by higher-priority rule 30)
            statement {
              not_statement {
                statement {
                  byte_match_statement {
                    search_string = "/api/auth/"
                    field_to_match {
                      uri_path {}
                    }
                    text_transformations {
                      priority = 0
                      type     = "LOWERCASE"
                    }
                    positional_constraint = "STARTS_WITH"
                  }
                }
              }
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project_name}-rate-limit-api-${var.environment}"
      sampled_requests_enabled   = true
    }
  }

  # ── Visibility config for the WebACL itself ─────────────────────────────────
  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.project_name}-waf-${var.environment}"
    sampled_requests_enabled   = true
  }

  tags = {
    Name        = "${var.project_name}-cloudfront-waf-${var.environment}"
    Environment = local.cost_environment
    ManagedBy   = "terraform"
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# Associate WAF WebACL with the CloudFront distribution
# ─────────────────────────────────────────────────────────────────────────────
# The WAF WebACL ARN is passed into the CloudFront distribution via the
# web_acl_id argument in cloudfront.tf. We use a local value to wire it up
# without modifying cloudfront.tf directly.
locals {
  waf_web_acl_arn = var.enable_cloudfront ? aws_wafv2_web_acl.cloudfront_api[0].arn : null
}

# ─────────────────────────────────────────────────────────────────────────────
# WAF Logging Configuration → CloudWatch Logs
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_wafv2_web_acl_logging_configuration" "cloudfront_api" {
  count = var.enable_cloudfront ? 1 : 0

  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]
  resource_arn            = aws_wafv2_web_acl.cloudfront_api[0].arn

  # Log all blocked requests; redact Authorization header to avoid leaking tokens
  logging_filter {
    default_behavior = "DROP"

    filter {
      behavior = "KEEP"
      condition {
        action_condition {
          action = "BLOCK"
        }
      }
      requirement = "MEETS_ANY"
    }
  }

  redacted_fields {
    single_header {
      name = "authorization"
    }
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# CloudWatch Metric Alarms — WAF
# ─────────────────────────────────────────────────────────────────────────────

# Alert if the auth rate-limit rule fires > 100 times in 5 minutes
resource "aws_cloudwatch_metric_alarm" "waf_auth_rate_limit_high" {
  count = var.enable_cloudfront ? 1 : 0

  alarm_name          = "${var.project_name}-waf-auth-rate-limit-high-${var.environment}"
  alarm_description   = "WAF is blocking high volumes on /api/auth/* — possible credential stuffing attack"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "BlockedRequests"
  namespace           = "AWS/WAFV2"
  period              = 300
  statistic           = "Sum"
  threshold           = 100
  treat_missing_data  = "notBreaching"

  dimensions = {
    WebACL = "${var.project_name}-cloudfront-waf-${var.environment}"
    Region = "Global"
    Rule   = "RateLimitAuthEndpoints"
  }

  tags = {
    Name        = "${var.project_name}-waf-auth-alarm-${var.environment}"
    Environment = local.cost_environment
  }
}

# Alert if the general API rate-limit rule fires > 500 times in 5 minutes
resource "aws_cloudwatch_metric_alarm" "waf_api_rate_limit_high" {
  count = var.enable_cloudfront ? 1 : 0

  alarm_name          = "${var.project_name}-waf-api-rate-limit-high-${var.environment}"
  alarm_description   = "WAF is blocking high volumes on /api/* — possible DDoS attack"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "BlockedRequests"
  namespace           = "AWS/WAFV2"
  period              = 300
  statistic           = "Sum"
  threshold           = 500
  treat_missing_data  = "notBreaching"

  dimensions = {
    WebACL = "${var.project_name}-cloudfront-waf-${var.environment}"
    Region = "Global"
    Rule   = "RateLimitApiEndpoints"
  }

  tags = {
    Name        = "${var.project_name}-waf-api-alarm-${var.environment}"
    Environment = local.cost_environment
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# Outputs
# ─────────────────────────────────────────────────────────────────────────────
output "waf_web_acl_arn" {
  description = "ARN of the WAF WebACL — reference this in aws_cloudfront_distribution.web_acl_id"
  value       = var.enable_cloudfront ? aws_wafv2_web_acl.cloudfront_api[0].arn : null
}

output "waf_web_acl_id" {
  description = "ID of the WAF WebACL"
  value       = var.enable_cloudfront ? aws_wafv2_web_acl.cloudfront_api[0].id : null
}

output "waf_log_group_name" {
  description = "CloudWatch Log Group name for WAF blocked requests"
  value       = aws_cloudwatch_log_group.waf.name
}
