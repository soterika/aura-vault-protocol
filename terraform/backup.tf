# AWS Backup — 3-2-1 strategy for RDS
resource "aws_backup_vault" "primary" {
  name = "${var.project_name}-backup-${var.environment}"
}

resource "aws_backup_vault" "replica" {
  provider = aws.replica # us-west-2
  name     = "${var.project_name}-backup-replica-${var.environment}"
}

resource "aws_backup_plan" "rds" {
  name = "${var.project_name}-rds-backup-${var.environment}"

  rule {
    rule_name         = "daily"
    target_vault_name = aws_backup_vault.primary.name
    schedule          = "cron(0 2 * * ? *)" # 02:00 UTC daily
    delete_after      = 7

    copy_action {
      destination_vault_arn = aws_backup_vault.replica.arn
      lifecycle { delete_after = 7 }
    }
  }

  rule {
    rule_name         = "weekly"
    target_vault_name = aws_backup_vault.primary.name
    schedule          = "cron(0 3 ? * 1 *)" # Sunday 03:00 UTC
    delete_after      = 30
  }

  rule {
    rule_name         = "monthly"
    target_vault_name = aws_backup_vault.primary.name
    schedule          = "cron(0 4 1 * ? *)" # 1st of month 04:00 UTC
    delete_after      = 365
  }
}

resource "aws_backup_selection" "rds" {
  name         = "${var.project_name}-rds-${var.environment}"
  iam_role_arn = aws_iam_role.backup.arn
  plan_id      = aws_backup_plan.rds.id

  resources = [aws_db_instance.main.arn]
}

resource "aws_iam_role" "backup" {
  name               = "${var.project_name}-backup-${var.environment}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "backup.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "backup" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}

# SNS topic for backup/restore test notifications
resource "aws_sns_topic" "dr_alerts" {
  name = "${var.project_name}-dr-alerts-${var.environment}"
}
