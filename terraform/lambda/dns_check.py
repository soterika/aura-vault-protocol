import json
import boto3
import socket
import dns.resolver
import os
from datetime import datetime

def handler(event, context):
    """
    Lambda function to check DNS propagation and record configuration
    """
    domain_name = os.environ.get('DOMAIN_NAME')
    expected_ip = os.environ.get('EXPECTED_IP', '')
    
    route53 = boto3.client('route53')
    
    results = {
        'timestamp': datetime.now().isoformat(),
        'domain': domain_name,
        'checks': []
    }
    
    try:
        # Get hosted zone ID
        hosted_zones = route53.list_hosted_zones()
        zone_id = None
        
        for zone in hosted_zones['HostedZones']:
            if zone['Name'].rstrip('.') == domain_name:
                zone_id = zone['Id']
                break
        
        if not zone_id:
            results['checks'].append({
                'name': 'hosted_zone',
                'status': 'FAIL',
                'message': 'Hosted zone not found'
            })
            return results
        
        results['checks'].append({
            'name': 'hosted_zone',
            'status': 'PASS',
            'message': 'Hosted zone found',
            'zone_id': zone_id
        })
        
        # Get DNS records
        records = route53.list_resource_record_sets(
            HostedZoneId=zone_id
        )
        
        # Check A record
        a_record = None
        for record in records['ResourceRecordSets']:
            if record['Type'] == 'A' and record['Name'] == f"{domain_name}.":
                a_record = record
                break
        
        if a_record:
            results['checks'].append({
                'name': 'a_record',
                'status': 'PASS',
                'message': 'A record exists',
                'record': a_record
            })
            
            # Check DNS resolution
            try:
                resolved_ip = socket.gethostbyname(domain_name)
                results['checks'].append({
                    'name': 'dns_resolution',
                    'status': 'PASS',
                    'message': f'Domain resolves to {resolved_ip}',
                    'resolved_ip': resolved_ip
                })
                
                if expected_ip and resolved_ip == expected_ip:
                    results['checks'].append({
                        'name': 'ip_match',
                        'status': 'PASS',
                        'message': 'Resolved IP matches expected'
                    })
                elif expected_ip:
                    results['checks'].append({
                        'name': 'ip_match',
                        'status': 'FAIL',
                        'message': f'Resolved IP {resolved_ip} does not match expected {expected_ip}'
                    })
                    
            except socket.gaierror:
                results['checks'].append({
                    'name': 'dns_resolution',
                    'status': 'FAIL',
                    'message': 'Domain does not resolve'
                })
        else:
            results['checks'].append({
                'name': 'a_record',
                'status': 'FAIL',
                'message': 'A record not found'
            })
        
        # Check MX records if email is enabled
        try:
            mx_records = dns.resolver.resolve(domain_name, 'MX')
            results['checks'].append({
                'name': 'mx_records',
                'status': 'PASS',
                'message': f'Found {len(mx_records)} MX records',
                'records': [str(mx) for mx in mx_records]
            })
        except dns.resolver.NoAnswer:
            results['checks'].append({
                'name': 'mx_records',
                'status': 'INFO',
                'message': 'No MX records found (email not configured)'
            })
        except Exception as e:
            results['checks'].append({
                'name': 'mx_records',
                'status': 'ERROR',
                'message': f'Error checking MX records: {str(e)}'
            })
        
        # Check TXT records
        try:
            txt_records = dns.resolver.resolve(domain_name, 'TXT')
            results['checks'].append({
                'name': 'txt_records',
                'status': 'PASS',
                'message': f'Found {len(txt_records)} TXT records',
                'records': [str(txt) for txt in txt_records]
            })
        except dns.resolver.NoAnswer:
            results['checks'].append({
                'name': 'txt_records',
                'status': 'INFO',
                'message': 'No TXT records found'
            })
        except Exception as e:
            results['checks'].append({
                'name': 'txt_records',
                'status': 'ERROR',
                'message': f'Error checking TXT records: {str(e)}'
            })
        
        # Overall status
        failed_checks = [c for c in results['checks'] if c['status'] == 'FAIL']
        if failed_checks:
            results['overall_status'] = 'FAIL'
            results['failed_checks'] = len(failed_checks)
        else:
            results['overall_status'] = 'PASS'
            results['failed_checks'] = 0
        
        print(json.dumps(results, indent=2))
        return results
        
    except Exception as e:
        print(f"Error during DNS check: {str(e)}")
        results['error'] = str(e)
        results['overall_status'] = 'ERROR'
        return results
