# Blue-green and canary releases

The existing blue-green workflow remains the default for releases that should
switch traffic atomically. Use the manual **Canary Deployment** workflow for a
release that needs gradual exposure through the Terraform-managed production
or staging ALB.

## Canary flow

1. Build and validate an immutable backend AMI for the release. It must use the
   same port, health endpoint, instance role, and runtime configuration as the
   stable backend.
2. Start `.github/workflows/deploy-canary.yml` from Actions, select the target
   environment, and provide the AMI ID.
3. Terraform creates an isolated canary launch template and Auto Scaling Group,
   waits for Terraform to finish, and leaves ALB canary weight at zero until at
   least two canary targets are healthy.
4. Terraform then routes 5% of HTTPS traffic to canary for 10 minutes, 20% for
   another 20 minutes, and finally 100%.
5. A CloudWatch metric-math alarm measures the canary target group's target
   5xx count divided by its request count. A rate above 1% triggers an automatic
   Terraform rollback to 100% stable traffic. The workflow fails after rollback
   so the release is visible as unsuccessful.

The Terraform root state is the source of truth for listener weights. Do not
change ALB weights from the console or with direct `modify-listener` commands.
The workflow serializes deployments per environment and uses the Terraform
state lock while changing the weights.

## GitHub Actions setup

- Configure `TF_CI_ROLE_ARN` with permission to manage the Terraform resources,
  read CloudWatch alarms, and inspect ALB target health.
- Configure the environment secret `TERRAFORM_TFVARS` with the root module's
  existing Terraform variable values. Do not commit a `terraform.tfvars` file.
- Protect the `production` GitHub environment with the required reviewers.
- Publish an immutable AMI before starting the workflow. The workflow does not
  build or mutate AMIs; it deploys the AMI ID supplied at dispatch.

On successful promotion Terraform retains the canary ASG as the active release.
For the next release, build a new AMI and repeat the workflow. After verifying
the new stable baseline, disable canary capacity with Terraform during the
normal maintenance window.
