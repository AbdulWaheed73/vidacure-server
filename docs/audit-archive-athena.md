# Audit-log archive → S3 → Athena

How old audit logs are tiered out of MongoDB and queried on demand.

## Overview

| Job | Cron | What | Retention |
|-----|------|------|-----------|
| `mongo-backup` | 02:00 | Full DB snapshot → `s3://<bucket>/mongo/dump/dt=YYYY-MM-DD/full.gz` | **20 days** (rolling DR) |
| `audit-archive` | 02:30 | Logs > 90 days old → `s3://<bucket>/audit-archive/dt=YYYY-MM-DD/auditlogs.json.gz`, then deleted from Mongo | **kept indefinitely** (never expire) |

Both run in the `vidacure-scheduler` PM2 process. The audit archive is the **sole**
long-term record once a day is removed from Mongo — so it is **never** auto-deleted (no lifecycle expiry rule).

## S3 bucket setup (one-time, manual)

Bucket `vidacure-backups`:
- **SSE-S3** encryption, **Block Public Access ON**, **Versioning ON**.
- Lifecycle rules:
  - `mongo/dump/` → expire objects after **20 days**.
  - `audit-archive/` → **no expiry rule** (kept indefinitely — it is the long-term record).
  - `athena-results/` → expire objects after **30 days** (optional).

## EC2 host requirements
- `mongodump` (mongodb-database-tools) and `aws` CLI installed.
- EC2 **instance IAM role** with `s3:PutObject`, `s3:GetObject`, `s3:ListBucket` on the bucket
  (no access keys in env).

## Enabling the archive job
1. Set in `.env`: `AUDIT_ARCHIVE_ENABLED=true`, `AUDIT_ARCHIVE_S3_BUCKET=vidacure-backups`.
2. Leave `AUDIT_ARCHIVE_EXPORT_ONLY=true` at first — it uploads to S3 but does **not** delete from Mongo.
3. Verify the S3 files look right (download one, `gunzip`, inspect the NDJSON).
4. Flip `AUDIT_ARCHIVE_EXPORT_ONLY=false` to enable the delete step.

Safety: export → confirm upload → only then delete by exact `_id`. A failed upload throws and
retries next run; nothing is deleted on failure.

## Athena setup (one-time)

1. Create a database and set the query-results location to `s3://vidacure-backups/athena-results/`.
2. Create the external table with **partition projection** (no `MSCK REPAIR` needed):

```sql
CREATE EXTERNAL TABLE audit_logs (
  `_id`         string,
  userId        string,
  role          string,
  action        string,
  operation     string,
  success       boolean,
  targetId      string,
  ipAddress     string,
  userAgent     string,
  `timestamp`   string,   -- ISO 8601; parse with from_iso8601_timestamp()
  metadata      string,   -- JSON string; read with json_extract_scalar()
  integrityHash string
)
PARTITIONED BY (dt string)
ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe'
LOCATION 's3://vidacure-backups/audit-archive/'
TBLPROPERTIES (
  'projection.enabled'          = 'true',
  'projection.dt.type'          = 'date',
  'projection.dt.range'         = '2026-01-01,NOW',
  'projection.dt.format'        = 'yyyy-MM-dd',
  'projection.dt.interval'      = '1',
  'projection.dt.interval.unit' = 'DAYS',
  'storage.location.template'   = 's3://vidacure-backups/audit-archive/dt=${dt}/'
);
```

## Example queries

A patient's access history (loggutdrag) from an archived range:
```sql
SELECT from_iso8601_timestamp("timestamp") AS ts,
       action, operation, success, userId,
       json_extract_scalar(metadata, '$.reason') AS reason
FROM audit_logs
WHERE dt BETWEEN '2026-02-01' AND '2026-03-15'
  AND targetId = '<patient_id>'
ORDER BY ts;
```

Failed actions by type in a month:
```sql
SELECT action, count(*) AS n
FROM audit_logs
WHERE dt BETWEEN '2026-02-01' AND '2026-02-28' AND success = false
GROUP BY action ORDER BY n DESC;
```

`WHERE dt BETWEEN ...` restricts the scan to those days' files — fast and cheap.

## Restore a DR backup
```bash
aws s3 cp s3://vidacure-backups/mongo/dump/dt=2026-06-26/full.gz .
mongorestore --uri="<MONGODB_URI>" --archive=full.gz --gzip
```
