import json
import boto3
import os
from datetime import datetime

def handler(event, context):
    """
    Lambda function to create RDS snapshots and upload to S3
    """
    db_identifier = os.environ['DB_IDENTIFIER']
    backup_bucket = os.environ['BACKUP_BUCKET']
    aws_region = os.environ['AWS_REGION']
    
    rds = boto3.client('rds', region_name=aws_region)
    s3 = boto3.client('s3', region_name=aws_region)
    
    timestamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    snapshot_id = f"{db_identifier}-manual-{timestamp}"
    
    try:
        # Create RDS snapshot
        print(f"Creating snapshot: {snapshot_id}")
        response = rds.create_db_snapshot(
            DBSnapshotIdentifier=snapshot_id,
            DBInstanceIdentifier=db_identifier,
            Tags=[
                {
                    'Key': 'CreatedBy',
                    'Value': 'LambdaBackupFunction'
                },
                {
                    'Key': 'Timestamp',
                    'Value': timestamp
                }
            ]
        )
        
        print(f"Snapshot created: {response['DBSnapshot']['DBSnapshotArn']}")
        
        # Wait for snapshot to be available
        print("Waiting for snapshot to be available...")
        waiter = rds.get_waiter('db_snapshot_available')
        waiter.wait(
            DBSnapshotIdentifier=snapshot_id,
            WaiterConfig={
                'Delay': 30,
                'MaxAttempts': 60
            }
        )
        
        print("Snapshot is available")
        
        # Upload metadata to S3
        metadata = {
            'snapshot_id': snapshot_id,
            'timestamp': timestamp,
            'db_identifier': db_identifier,
            'status': 'completed'
        }
        
        s3_key = f"backups/{timestamp}/metadata.json"
        s3.put_object(
            Bucket=backup_bucket,
            Key=s3_key,
            Body=json.dumps(metadata),
            ContentType='application/json'
        )
        
        print(f"Metadata uploaded to S3: s3://{backup_bucket}/{s3_key}")
        
        # Clean up old snapshots (keep last 7 manual snapshots)
        snapshots = rds.describe_db_snapshots(
            DBInstanceIdentifier=db_identifier,
            SnapshotType='manual'
        )
        
        manual_snapshots = sorted(
            [s for s in snapshots['DBSnapshots'] if 'manual-' in s['DBSnapshotIdentifier']],
            key=lambda x: x['SnapshotCreateTime'],
            reverse=True
        )
        
        if len(manual_snapshots) > 7:
            for old_snapshot in manual_snapshots[7:]:
                print(f"Deleting old snapshot: {old_snapshot['DBSnapshotIdentifier']}")
                rds.delete_db_snapshot(
                    DBSnapshotIdentifier=old_snapshot['DBSnapshotIdentifier']
                )
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Backup completed successfully',
                'snapshot_id': snapshot_id,
                'timestamp': timestamp
            })
        }
        
    except Exception as e:
        print(f"Error during backup: {str(e)}")
        
        # Upload error metadata to S3
        error_metadata = {
            'error': str(e),
            'timestamp': timestamp,
            'db_identifier': db_identifier,
            'status': 'failed'
        }
        
        s3_key = f"backups/{timestamp}/error.json"
        s3.put_object(
            Bucket=backup_bucket,
            Key=s3_key,
            Body=json.dumps(error_metadata),
            ContentType='application/json'
        )
        
        raise e
