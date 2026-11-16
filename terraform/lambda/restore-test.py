"""Monthly restore test Lambda — verifies RDS backup can be restored, then cleans up."""
import boto3
import os
import json
import time
from datetime import datetime, timezone

rds = boto3.client("rds")
sns = boto3.client("sns")
SNS_TOPIC = os.environ["SNS_TOPIC_ARN"]
SOURCE_DB = os.environ["SOURCE_DB_IDENTIFIER"]
TEST_DB = f"{SOURCE_DB}-restore-test"


def handler(event, context):
    result = {"timestamp": datetime.now(timezone.utc).isoformat(), "success": False}
    try:
        # Find latest snapshot
        snaps = rds.describe_db_snapshots(
            DBInstanceIdentifier=SOURCE_DB,
            SnapshotType="automated",
        )["DBSnapshots"]
        if not snaps:
            raise RuntimeError("No automated snapshots found")
        latest = sorted(snaps, key=lambda s: s["SnapshotCreateTime"])[-1]
        snap_id = latest["DBSnapshotIdentifier"]

        # Restore
        rds.restore_db_instance_from_db_snapshot(
            DBInstanceIdentifier=TEST_DB,
            DBSnapshotIdentifier=snap_id,
            DBInstanceClass="db.t3.micro",
            MultiAZ=False,
            DeletionProtection=False,
        )

        # Wait until available (max 30 min)
        waiter = rds.get_waiter("db_instance_available")
        waiter.wait(
            DBInstanceIdentifier=TEST_DB,
            WaiterConfig={"Delay": 30, "MaxAttempts": 60},
        )

        result["success"] = True
        result["snapshot_id"] = snap_id
        result["snapshot_age_hours"] = round(
            (datetime.now(timezone.utc) - latest["SnapshotCreateTime"]).total_seconds() / 3600, 1
        )
    except Exception as e:
        result["error"] = str(e)
    finally:
        # Always clean up test instance
        try:
            rds.delete_db_instance(
                DBInstanceIdentifier=TEST_DB,
                SkipFinalSnapshot=True,
            )
        except rds.exceptions.DBInstanceNotFoundFault:
            pass

    sns.publish(
        TopicArn=SNS_TOPIC,
        Subject=f"DR Restore Test: {'PASS' if result['success'] else 'FAIL'}",
        Message=json.dumps(result, indent=2),
    )
    return result
