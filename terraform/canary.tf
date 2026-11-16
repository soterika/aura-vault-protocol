# The canary has its own immutable AMI and Auto Scaling Group so that the
# weighted listener never sends traffic to the stable release by accident.
resource "aws_lb_target_group" "backend_canary" {
  name        = "${var.project_name}-canary-${var.environment}"
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
    port                = "traffic-port"
    protocol            = "HTTP"
  }

  tags = {
    Name        = "${var.project_name}-canary-tg-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_launch_template" "backend_canary" {
  count         = var.canary_enabled ? 1 : 0
  name_prefix   = "${var.project_name}-backend-canary-"
  image_id      = var.canary_ami_id
  instance_type = var.backend_instance_type

  vpc_security_group_ids = [aws_security_group.backend.id]
  key_name               = aws_key_pair.backend.key_name

  monitoring {
    enabled = true
  }

  iam_instance_profile {
    name = aws_iam_instance_profile.backend.name
  }

  user_data = base64encode(templatefile("${path.module}/user-data.sh", {
    db_endpoint   = aws_db_instance.main.endpoint
    db_name       = var.db_name
    db_username   = var.db_username
    db_secret_id  = aws_secretsmanager_secret.db_master.arn
    app_secret_id = aws_secretsmanager_secret.app.arn
    environment   = var.environment
    project_name  = var.project_name
    aws_region    = var.aws_region
  }))

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name        = "${var.project_name}-backend-canary-${var.environment}"
      Environment = var.environment
      Release     = "canary"
    }
  }

  lifecycle {
    precondition {
      condition     = !var.canary_enabled || var.canary_ami_id != ""
      error_message = "canary_ami_id must name the immutable release AMI when canary_enabled is true."
    }
  }
}

resource "aws_autoscaling_group" "backend_canary" {
  count               = var.canary_enabled ? 1 : 0
  name                = "${var.project_name}-backend-canary-asg-${var.environment}"
  min_size            = 2
  max_size            = 10
  desired_capacity    = 2
  vpc_zone_identifier = aws_subnet.private[*].id
  target_group_arns   = [aws_lb_target_group.backend_canary.arn]
  health_check_type   = "ELB"
  health_check_grace_period = 300

  launch_template {
    id      = aws_launch_template.backend_canary[0].id
    version = aws_launch_template.backend_canary[0].latest_version
  }

  tag {
    key                 = "Name"
    value               = "${var.project_name}-backend-canary-${var.environment}"
    propagate_at_launch = true
  }

  tag {
    key                 = "Environment"
    value               = var.environment
    propagate_at_launch = true
  }
}

# CloudWatch evaluates the canary target group's own 5xx rate. A zero request
# window is treated as healthy so idle services do not trigger false rollbacks.
resource "aws_cloudwatch_metric_alarm" "canary_error_rate" {
  alarm_name          = "${var.project_name}-canary-error-rate-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 0.01
  treat_missing_data  = "notBreaching"
  alarm_description   = "Canary target group 5xx rate exceeded 1%; the deployment workflow rolls traffic back."
  alarm_actions       = [aws_sns_topic.alerts.arn]

  metric_query {
    id          = "errors"
    return_data = false
    metric {
      metric_name = "HTTPCode_Target_5XX_Count"
      namespace   = "AWS/ApplicationELB"
      period      = 60
      stat        = "Sum"
      dimensions = {
        LoadBalancer = aws_lb.main.arn_suffix
        TargetGroup  = aws_lb_target_group.backend_canary.arn_suffix
      }
    }
  }

  metric_query {
    id          = "requests"
    return_data = false
    metric {
      metric_name = "RequestCount"
      namespace   = "AWS/ApplicationELB"
      period      = 60
      stat        = "Sum"
      dimensions = {
        LoadBalancer = aws_lb.main.arn_suffix
        TargetGroup  = aws_lb_target_group.backend_canary.arn_suffix
      }
    }
  }

  metric_query {
    id          = "error_rate"
    expression  = "IF(requests > 0, errors / requests, 0)"
    label       = "Canary target 5xx rate"
    return_data = true
  }
}
