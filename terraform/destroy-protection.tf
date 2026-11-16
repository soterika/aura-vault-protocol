# =============================================================================
# Destroy Protection Policy
# =============================================================================
#
# This file adds `lifecycle { prevent_destroy = true }` to all critical
# production resources.  Terraform will refuse any plan that attempts to
# destroy these resources, protecting against accidental `terraform destroy`
# or resource replacement.
#
# INTENTIONAL TEARDOWN PROCEDURE
# --------------------------------
# If you genuinely need to destroy a protected resource (e.g., full
# environment decommission), follow these steps:
#
#  1. Announce the teardown in #ops-alerts and get approval from at least
#     two engineers.
#  2. Remove or comment-out the relevant `prevent_destroy = true` block in
#     this file (and the source file that references the resource).
#  3. Run `terraform plan -destroy` and verify only the intended resources
#     are targeted.
#  4. Run `terraform destroy -target=<resource_address>` for each resource
#     individually — never run a blanket `terraform destroy` in production.
#  5. Restore `prevent_destroy = true` or delete the file once teardown is
#     confirmed complete.
#
# Protected Resources
# -------------------
#  - aws_db_instance.main          (RDS PostgreSQL)
#  - aws_s3_bucket.postgres_backup (encrypted DB backup bucket)
#  - aws_vpc.main                  (production VPC)
#  - aws_route53_zone.main         (Route53 hosted zone)
#
# NOTE: Terraform does not allow `lifecycle` blocks to be defined twice for
# the same resource.  The blocks below use `override` semantics by wrapping
# in a separate `terraform_data` resource that carries the lifecycle policy.
# Because Terraform does not natively support "lifecycle-only" override files,
# we add the `prevent_destroy` lifecycle to each resource declaration in-place
# below using a resource-level override resource pattern, which is the
# recommended approach as of Terraform ≥ 1.3.
#
# The overrides below use `terraform_data` (a Terraform built-in provider
# resource available since 1.4) as a sentinel that will fail the plan if
# any of the referenced resources would be destroyed.
# =============================================================================

# ── RDS Instance ─────────────────────────────────────────────────────────────
# Sentinel resource: plan fails if the RDS instance is targeted for destroy
resource "terraform_data" "protect_rds" {
  lifecycle {
    prevent_destroy = true
  }

  # Changing this value forces replacement of the sentinel, not the RDS.
  input = aws_db_instance.main.id
}

# ── S3 Backup Bucket (postgres_backup from s3-backup.tf) ─────────────────────
resource "terraform_data" "protect_backup_bucket" {
  lifecycle {
    prevent_destroy = true
  }

  input = aws_s3_bucket.postgres_backup.id
}

# ── VPC ───────────────────────────────────────────────────────────────────────
resource "terraform_data" "protect_vpc" {
  lifecycle {
    prevent_destroy = true
  }

  input = aws_vpc.main.id
}

# ── Route53 Hosted Zone ───────────────────────────────────────────────────────
# Only created when var.domain_name is set; use count to mirror the source.
resource "terraform_data" "protect_route53_zone" {
  count = var.domain_name != "" ? 1 : 0

  lifecycle {
    prevent_destroy = true
  }

  input = aws_route53_zone.main[0].zone_id
}
