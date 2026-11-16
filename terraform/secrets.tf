# Environment-specific application credentials. Values are seeded out-of-band with
# aws secretsmanager put-secret-value so Terraform state never stores API keys.
resource "aws_secretsmanager_secret" "app" {
  name                    = "${var.project_name}/${var.environment}/app"
  description             = "Aura Vault ${var.environment} API keys and application credentials"
  recovery_window_in_days = var.secret_recovery_window_days

  tags = {
    Name = "${var.project_name}-app-secrets-${var.environment}"
  }
}

resource "aws_secretsmanager_secret_version" "app_template" {
  secret_id = aws_secretsmanager_secret.app.id

  secret_string = jsonencode({
    SENDGRID_API_KEY     = ""
    MAILGUN_DOMAIN       = ""
    MAILGUN_API_KEY      = ""
    JWT_SECRET           = ""
    UNSUBSCRIBE_SECRET   = ""
    WEBHOOK_SIGNING_KEYS = ""
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret_rotation" "app" {
  count               = var.secrets_rotation_lambda_arn != "" ? 1 : 0
  secret_id           = aws_secretsmanager_secret.app.id
  rotation_lambda_arn = var.secrets_rotation_lambda_arn

  rotation_rules {
    automatically_after_days = 30
  }
}

resource "random_password" "db_master" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "aws_secretsmanager_secret" "db_master" {
  name                    = "${var.project_name}/${var.environment}/database/master"
  description             = "Aura Vault ${var.environment} database master credentials"
  recovery_window_in_days = var.secret_recovery_window_days

  tags = {
    Name = "${var.project_name}-db-master-secret-${var.environment}"
  }
}

resource "aws_secretsmanager_secret_version" "db_master" {
  secret_id = aws_secretsmanager_secret.db_master.id

  secret_string = jsonencode({
    username = var.db_username
    password = random_password.db_master.result
    engine   = "postgres"
    host     = aws_db_instance.main.address
    port     = aws_db_instance.main.port
    dbname   = var.db_name
  })
}

resource "aws_secretsmanager_secret_rotation" "db_master" {
  secret_id           = aws_secretsmanager_secret.db_master.id
  rotation_lambda_arn = var.secrets_rotation_lambda_arn

  rotation_rules {
    automatically_after_days = 30
  }

  count = var.secrets_rotation_lambda_arn != "" ? 1 : 0
}

resource "aws_iam_role" "backend_instance" {
  name = "${var.project_name}-backend-instance-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "backend_secrets_read" {
  name = "${var.project_name}-backend-secrets-read-${var.environment}"
  role = aws_iam_role.backend_instance.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:DescribeSecret",
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          aws_secretsmanager_secret.app.arn,
          aws_secretsmanager_secret.db_master.arn
        ]
      }
    ]
  })
}

resource "aws_iam_instance_profile" "backend" {
  name = "${var.project_name}-backend-${var.environment}"
  role = aws_iam_role.backend_instance.name
}

resource "aws_cloudwatch_log_group" "secrets_audit" {
  name              = "/aws/${var.project_name}/${var.environment}/secrets-audit"
  retention_in_days = 90

  tags = {
    Name = "${var.project_name}-secrets-audit-${var.environment}"
  }
}

resource "aws_cloudwatch_event_rule" "secrets_manager_access" {
  name        = "${var.project_name}-secrets-access-${var.environment}"
  description = "Records Secrets Manager read and rotation API calls from CloudTrail"

  event_pattern = jsonencode({
    source = ["aws.secretsmanager"]
    "detail-type" = ["AWS API Call via CloudTrail"]
    detail = {
      eventSource = ["secretsmanager.amazonaws.com"]
      eventName = [
        "GetSecretValue",
        "DescribeSecret",
        "RotateSecret",
        "UpdateSecretVersionStage"
      ]
    }
  })
}

resource "aws_cloudwatch_event_target" "secrets_audit_logs" {
  rule = aws_cloudwatch_event_rule.secrets_manager_access.name
  arn  = aws_cloudwatch_log_group.secrets_audit.arn
}
