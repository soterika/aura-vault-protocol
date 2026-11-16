# Route53 Hosted Zone
resource "aws_route53_zone" "main" {
  count = var.domain_name != "" ? 1 : 0
  
  name = var.domain_name
  
  tags = {
    Name = "${var.project_name}-zone-${var.environment}"
  }
}

# Route53 Zone for subdomain (optional)
resource "aws_route53_zone" "subdomain" {
  count = var.create_subdomain_zone ? 1 : 0
  
  name = "${var.subdomain_name}.${var.domain_name}"
  
  tags = {
    Name = "${var.project_name}-subdomain-zone-${var.environment}"
  }
}

# ACM Certificate for main domain
resource "aws_acm_certificate" "main" {
  count = var.domain_name != "" ? 1 : 0
  
  domain_name       = var.domain_name
  validation_method = "DNS"
  
  subject_alternative_names = var.create_subdomain_zone ? ["*.${var.subdomain_name}.${var.domain_name}"] : ["*.${var.domain_name}"]
  
  lifecycle {
    create_before_destroy = true
  }
  
  tags = {
    Name = "${var.project_name}-cert-${var.environment}"
  }
}

# ACM Certificate Validation Records
resource "aws_route53_record" "cert_validation" {
  count = var.domain_name != "" ? length(aws_acm_certificate.main[0].domain_validation_options) : 0
  
  allow_overwrite = true
  name            = aws_acm_certificate.main[0].domain_validation_options[count.index].resource_record_name
  records         = [aws_acm_certificate.main[0].domain_validation_options[count.index].resource_record_value]
  type            = aws_acm_certificate.main[0].domain_validation_options[count.index].resource_record_type
  zone_id         = aws_route53_zone.main[0].zone_id
  ttl             = 60
}

# ACM Certificate Validation
resource "aws_acm_certificate_validation" "main" {
  count = var.domain_name != "" ? 1 : 0
  
  certificate_arn         = aws_acm_certificate.main[0].arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
  
  depends_on = [aws_route53_record.cert_validation]
}

# Route53 Record for ALB (main domain)
resource "aws_route53_record" "alb_main" {
  count = var.domain_name != "" ? 1 : 0
  
  zone_id = aws_route53_zone.main[0].zone_id
  name    = var.domain_name
  type    = "A"
  
  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
  
  depends_on = [aws_acm_certificate_validation.main]
}

# Route53 Record for www (redirects to main domain)
resource "aws_route53_record" "www" {
  count = var.domain_name != "" ? 1 : 0
  
  zone_id = aws_route53_zone.main[0].zone_id
  name    = "www.${var.domain_name}"
  type    = "A"
  
  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
  
  depends_on = [aws_acm_certificate_validation.main]
}

locals {
  dr_api_failover_enabled = var.enable_dns_failover && var.domain_name != "" && var.dr_alb_dns_name != "" && var.dr_alb_zone_id != ""
}

# Route53 Record for API subdomain when DR is not configured.
resource "aws_route53_record" "api" {
  count = var.domain_name != "" && !local.dr_api_failover_enabled ? 1 : 0
  
  zone_id = aws_route53_zone.main[0].zone_id
  name    = "api.${var.domain_name}"
  type    = "A"
  
  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

# Route53 Record for CloudFront (static assets)
resource "aws_route53_record" "cdn" {
  count = var.domain_name != "" && var.enable_cloudfront ? 1 : 0
  
  zone_id = aws_route53_zone.main[0].zone_id
  name    = "cdn.${var.domain_name}"
  type    = "A"
  
  alias {
    name                   = aws_cloudfront_distribution.main[0].domain_name
    zone_id                = aws_cloudfront_distribution.main[0].hosted_zone_id
    evaluate_target_health = false
  }
}

# Route53 Record for verification (TXT record)
resource "aws_route53_record" "verification" {
  count = var.domain_name != "" && var.verification_token != "" ? 1 : 0
  
  zone_id = aws_route53_zone.main[0].zone_id
  name    = "_dmarc.${var.domain_name}"
  type    = "TXT"
  records = [var.verification_token]
  ttl     = 3600
}

# Route53 Health Check for ALB
resource "aws_route53_health_check" "alb" {
  count = var.domain_name != "" ? 1 : 0
  
  fqdn              = aws_lb.main.dns_name
  port              = 443
  type              = "HTTPS"
  resource_path     = "/api/health"
  request_interval  = 30
  failure_threshold = 3
  success_threshold = 2
  
  tags = {
    Name = "${var.project_name}-alb-health-check-${var.environment}"
  }
}

# DNS Failover Configuration
resource "aws_route53_record" "failover_primary" {
  count = local.dr_api_failover_enabled ? 1 : 0
  
  zone_id = aws_route53_zone.main[0].zone_id
  name    = "api.${var.domain_name}"
  type    = "A"
  
  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
  
  failover_routing_policy {
    type = "PRIMARY"
  }
  
  set_identifier = "primary"
  
  health_check_id = aws_route53_health_check.alb[0].id
}

resource "aws_route53_record" "failover_secondary" {
  count = local.dr_api_failover_enabled ? 1 : 0
  
  zone_id = aws_route53_zone.main[0].zone_id
  name    = "api.${var.domain_name}"
  type    = "A"
  
  alias {
    name                   = var.dr_alb_dns_name
    zone_id                = var.dr_alb_zone_id
    evaluate_target_health = true
  }
  
  failover_routing_policy {
    type = "SECONDARY"
  }
  
  set_identifier = "secondary"
}

# S3 Bucket for static failover website
resource "aws_s3_bucket" "failover_website" {
  count = var.enable_dns_failover ? 1 : 0
  
  bucket = "${var.project_name}-failover-${var.environment}-${random_id.failover_suffix.hex}"
  
  tags = {
    Name = "${var.project_name}-failover-${var.environment}"
  }
}

resource "aws_s3_bucket_website_configuration" "failover" {
  count = var.enable_dns_failover ? 1 : 0
  
  bucket = aws_s3_bucket.failover_website[0].id
  
  index_document {
    suffix = "index.html"
  }
  
  error_document {
    key = "error.html"
  }
}

resource "aws_s3_object" "failover_index" {
  count = var.enable_dns_failover ? 1 : 0
  
  bucket = aws_s3_bucket.failover_website[0].id
  key    = "index.html"
  content = <<-EOF
  <!DOCTYPE html>
  <html>
  <head>
    <title>Maintenance Mode</title>
    <style>
      body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
      h1 { color: #333; }
      p { color: #666; }
    </style>
  </head>
  <body>
    <h1>Aura Vault Protocol</h1>
    <p>We are currently performing maintenance. Please check back soon.</p>
  </body>
  </html>
  EOF
  content_type = "text/html"
}

resource "random_id" "failover_suffix" {
  byte_length = 4
}

# Variables for DNS configuration
variable "create_subdomain_zone" {
  description = "Create a separate hosted zone for subdomain"
  type        = bool
  default     = false
}

variable "subdomain_name" {
  description = "Subdomain name (e.g., 'app' for app.example.com)"
  type        = string
  default     = "app"
}

variable "verification_token" {
  description = "Verification token for domain ownership"
  type        = string
  default     = ""
}

variable "enable_dns_failover" {
  description = "Enable DNS failover configuration"
  type        = bool
  default     = true
}
