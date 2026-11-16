# Application Load Balancer
resource "aws_lb" "main" {
  name               = "${var.project_name}-alb-${var.environment}"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
  
  enable_deletion_protection = false
  enable_http2               = true
  
  access_logs {
    bucket  = aws_s3_bucket.alb_logs.id
    prefix  = "alb-logs"
    enabled = true
  }
  
  tags = {
    Name = "${var.project_name}-alb-${var.environment}"
    Component = "networking"
  }
}

# ALB Target Group for Backend
resource "aws_lb_target_group" "backend" {
  name        = "${var.project_name}-backend-tg-${var.environment}"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "instance"
  
  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    path                = "/api/health"
    matcher             = "200"
    port                = 3000
    protocol            = "HTTP"
  }
  
  tags = {
    Name = "${var.project_name}-backend-tg-${var.environment}"
    Component = "backend"
  }
}

# ALB Listener (HTTP - redirects to HTTPS)
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"
  
  default_action {
    type = "redirect"
    
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "301"
    }
  }
}

# ALB Listener (HTTPS)
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS-1-2-2017-01"
  certificate_arn   = var.domain_name != "" ? aws_acm_certificate.main[0].arn : ""
  
  default_action {
    type = "forward"

    forward {
      target_group {
        arn    = aws_lb_target_group.backend.arn
        weight = 100 - var.canary_weight
      }

      target_group {
        arn    = aws_lb_target_group.backend_canary.arn
        weight = var.canary_weight
      }
    }
  }
}

# ACM Certificate (conditional) - moved to dns.tf
# Certificate resources are now managed in dns.tf for better organization
