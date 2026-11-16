# DNS and Domain Setup Guide

This guide covers the complete DNS and domain configuration for the Aura Vault Protocol infrastructure.

## Prerequisites

- Registered domain name (e.g., example.com)
- AWS Route53 access
- Domain registrar access (to update nameservers)

## Architecture Overview

```
User Request
    ↓
Route53 Hosted Zone
    ↓
├── A Record → ALB (Primary)
├── www Record → ALB
├── api Record → ALB
├── cdn Record → CloudFront
└── failover Record → ALB (Primary) / S3 (Secondary)
```

## Step 1: Configure Variables

Edit `terraform.tfvars`:

```hcl
domain_name = "your-domain.com"
create_subdomain_zone = false
subdomain_name = "app"
enable_dns_failover = true
enable_email_forwarding = false
```

## Step 2: Deploy Infrastructure

```bash
terraform plan
terraform apply
```

This will create:
- Route53 hosted zone
- ACM SSL certificate
- DNS records for ALB, CloudFront, and subdomains
- DNS health checks
- Failover configuration

## Step 3: Update Nameservers

After Terraform completes, you'll receive the Route53 nameservers:

```bash
terraform output route53_zone_id
```

Update your domain registrar with the new nameservers:
1. Log into your domain registrar (GoDaddy, Namecheap, etc.)
2. Find DNS settings / Nameservers
3. Replace existing nameservers with Route53 nameservers
4. Save changes

## Step 4: Verify DNS Propagation

### Manual Verification

```bash
# Check nameservers
dig NS your-domain.com

# Check A record
dig A your-domain.com

# Check propagation globally
dig +trace your-domain.com
```

### Automated Verification

The infrastructure includes a Lambda function that checks DNS propagation hourly. View results in CloudWatch Logs:

```bash
aws logs tail /aws/lambda/aura-vault-dns-check-dev --follow
```

## DNS Records Created

### Primary Records

| Record | Type | Value | Purpose |
|--------|------|-------|---------|
| `@` | A | ALB DNS | Main application |
| `www` | A | ALB DNS | www subdomain |
| `api` | A | ALB DNS | API endpoint |
| `cdn` | A | CloudFront | Static assets CDN |
| `failover` | A | ALB/S3 | Failover endpoint |

### Certificate Validation Records

- `_amazonses.your-domain.com` (TXT) - SES verification
- DKIM CNAME records (3 records) - Email authentication

### Health Check Records

- Route53 health check monitors `/api/health` endpoint
- Fails over to S3 maintenance page if ALB is unhealthy

## SSL/TLS Certificate

### Certificate Details

- **Type**: ACM certificate
- **Validation**: DNS validation
- **SANs**: `your-domain.com`, `*.your-domain.com`
- **Auto-renewal**: Enabled by ACM

### Certificate Validation

Terraform automatically creates DNS validation records. ACM validates the certificate automatically once DNS propagates.

### Certificate Monitoring

CloudWatch alarm alerts 30 days before expiry:
```bash
aws cloudwatch describe-alarms --alarm-names aura-vault-cert-expiry-dev
```

## DNS Failover Configuration

### Primary Endpoint

- **Target**: Application Load Balancer
- **Health Check**: HTTPS `/api/health`
- **Failover Threshold**: 3 consecutive failures

### Secondary Endpoint

- **Target**: S3 static website
- **Content**: Maintenance page
- **Activation**: Automatic on primary failure

### Testing Failover

```bash
# Simulate ALB failure
# 1. Stop backend instances
# 2. Wait for health check to fail (3 intervals = 90 seconds)
# 3. Verify DNS resolves to S3
dig failover.your-domain.com
```

## Email Forwarding (Optional)

### Enable Email Forwarding

Set in `terraform.tfvars`:

```hcl
enable_email_forwarding = true
email_forwarding_recipients = ["info@your-domain.com"]
email_forwarding_destinations = ["your-email@gmail.com"]
```

### Email Flow

```
Incoming Email → SES → S3 Storage → Lambda → Forward to Destination
```

### Verification Required

1. **Domain Verification**: TXT record created automatically
2. **DKIM Verification**: 3 CNAME records created automatically
3. **SES Production Access**: Request from AWS Console

### Test Email Forwarding

```bash
# Send test email to info@your-domain.com
# Check CloudWatch Logs for Lambda execution
aws logs tail /aws/lambda/aura-vault-email-forwarder-dev --follow
```

## CDN Integration

### CloudFront DNS

- **Record**: `cdn.your-domain.com`
- **Type**: Alias to CloudFront distribution
- **Cache**: Static assets with 1-year TTL

### Static Assets Upload

```bash
# Upload frontend assets to S3
aws s3 sync frontend/dist/ s3://$(terraform output s3_bucket_name)/

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id $(terraform output cloudfront_distribution_id) \
  --paths "/*"
```

## Monitoring

### DNS Health Dashboard

Access CloudWatch dashboard: `${project_name}-dns-dashboard-${environment}`

Metrics monitored:
- DNS health check status
- SSL certificate expiry
- DNS resolution times

### Alerts

Configure email alerts in `terraform.tfvars`:

```hcl
alert_email = "alerts@your-domain.com"
```

Alerts trigger for:
- DNS health check failures
- Certificate expiry < 30 days
- DNS propagation issues

## Troubleshooting

### Domain Not Resolving

1. Check nameservers updated at registrar
2. Verify DNS propagation: `dig NS your-domain.com`
3. Check Route53 hosted zone exists
4. Review CloudWatch DNS check logs

### Certificate Not Validating

1. Check validation records exist in Route53
2. Verify DNS propagation: `dig _amazonses.your-domain.com TXT`
3. Check ACM console for validation status
4. Wait up to 24 hours for DNS propagation

### Health Check Failing

1. Verify ALB health check endpoint: `curl https://your-domain.com/api/health`
2. Check security group allows health checks
3. Review backend instance health
4. Check CloudWatch ALB metrics

### Email Not Forwarding

1. Verify SES domain is verified
2. Check DKIM records are valid
3. Request SES production access
4. Review Lambda execution logs
5. Verify email forwarding destinations

### Failover Not Activating

1. Check health check threshold (3 failures)
2. Verify health check is failing
3. Check failover routing policy
4. Review Route53 health check status

## Security Best Practices

1. **DNSSEC**: Consider enabling DNSSEC for additional security
2. **SPF/DKIM/DMARC**: Configure email authentication records
3. **Private Zones**: Use private hosted zones for internal services
4. **WAF**: Enable AWS WAF on ALB for additional protection

## Cost Optimization

- **Route53**: ~$0.50/month per hosted zone
- **ACM**: Free (AWS managed certificates)
- **Health Checks**: ~$0.50/month per health check
- **SES**: $0.10/1000 emails (after free tier)

## Cleanup

To remove DNS configuration:

```bash
terraform destroy
```

**Important**: Before destroying:
1. Update domain registrar nameservers back to original
2. Wait for DNS to propagate (24-48 hours)
3. Verify email is not critical before removing SES

## Additional Resources

- [Route53 Documentation](https://docs.aws.amazon.com/Route53/)
- [ACM Documentation](https://docs.aws.amazon.com/acm/)
- [SES Documentation](https://docs.aws.amazon.com/ses/)
- [CloudFront Documentation](https://docs.aws.amazon.com/cloudfront/)
