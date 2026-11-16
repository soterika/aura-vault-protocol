import json
import boto3
import os
import email
from email.utils import parseaddr
from botocore.exceptions import ClientError

def handler(event, context):
    """
    Lambda function to forward emails received via SES
    """
    ses = boto3.client('ses')
    s3 = boto3.client('s3')
    
    # Get email from S3
    s3_bucket = event['Records'][0]['s3']['bucket']['name']
    s3_key = event['Records'][0]['s3']['object']['key']
    
    try:
        # Get the email from S3
        response = s3.get_object(Bucket=s3_bucket, Key=s3_key)
        raw_email = response['Body'].read()
        
        # Parse the email
        msg = email.message_from_bytes(raw_email)
        
        # Extract email details
        subject = msg['Subject']
        from_addr = parseaddr(msg['From'])[1]
        to_addr = parseaddr(msg['To'])[1]
        
        # Get forwarding destinations
        forward_to = os.environ.get('FORWARD_TO_ADDRESSES', '').split(',')
        
        if not forward_to:
            print("No forwarding destinations configured")
            return {'statusCode': 200, 'body': 'No forwarding configured'}
        
        # Forward email to each destination
        for dest in forward_to:
            dest = dest.strip()
            if not dest:
                continue
            
            try:
                # Create new email for forwarding
                forwarded_msg = email.message.EmailMessage()
                forwarded_msg['Subject'] = f"Fwd: {subject}"
                forwarded_msg['From'] = from_addr
                forwarded_msg['To'] = dest
                forwarded_msg['X-Original-To'] = to_addr
                
                # Copy body
                if msg.is_multipart():
                    for part in msg.walk():
                        content_type = part.get_content_type()
                        content_disposition = str(part.get('Content-Disposition', ''))
                        
                        if content_type == 'text/plain' and 'attachment' not in content_disposition:
                            body = part.get_payload(decode=True).decode('utf-8', errors='ignore')
                            forwarded_msg.set_content(body)
                            break
                else:
                    body = msg.get_payload(decode=True).decode('utf-8', errors='ignore')
                    forwarded_msg.set_content(body)
                
                # Send the email
                ses.send_raw_email(
                    Source=from_addr,
                    Destinations=[dest],
                    RawMessage={'Data': forwarded_msg.as_bytes()}
                )
                
                print(f"Email forwarded to {dest}")
                
            except ClientError as e:
                print(f"Error forwarding to {dest}: {e}")
                continue
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Email forwarded successfully',
                'from': from_addr,
                'to': to_addr,
                'forwarded_to': forward_to
            })
        }
        
    except Exception as e:
        print(f"Error processing email: {str(e)}")
        raise e
