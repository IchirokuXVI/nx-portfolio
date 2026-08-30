{{- if and .Values.lunaShopperBackend.enabled .Values.lunaShopperBackend.backups.enabled }}
{{- $root := . }}
{{- $ls := .Values.lunaShopperBackend }}
{{- $backups := $ls.backups }}
{{- $secName := "luna-shopper-backend-secrets" }}
{{/*
  Nightly logical backups (plan 0005).

  One CronJob per Postgres instance, rendered from the same `postgres.instances`
  list that drives the StatefulSets, so a fourth database gets a backup by
  existing rather than by somebody remembering.

  Why pg_dump and not something else. The storage class is k3s's `local-path`: a
  PersistentVolume is a directory on the node's own disk, with no replication, no
  second copy, and no VolumeSnapshot support — so the usual Kubernetes answer of
  snapshotting the PVC is simply unavailable. A filesystem copy of the data
  directory is unsafe while Postgres is running and produces a backup whose
  integrity cannot be checked without restoring it into an identical major
  version. `pg_dump` is consistent, taken through a normal connection, portable
  across versions, and inspectable with `pg_restore --list`. The usual objection
  to logical dumps is that they do not scale, which for three databases measured
  in megabytes will not apply for years.

  Retention is deliberately NOT here. An object storage lifecycle rule expresses
  "expire after N days" declaratively, runs whether or not the cluster is
  healthy, and cannot be broken by a bug in a shell script.
*/}}
{{- range $pg := $ls.postgres.instances }}
{{- if not (include "lunaShopperBackend.entryEnabled" (dict "entry" $pg "ls" $ls)) }}{{- continue }}{{- end }}
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: {{ $pg.name }}-backup
  namespace: {{ $root.Values.namespace }}
  labels:
    app: {{ $pg.name }}-backup
    app.kubernetes.io/part-of: luna-shopper-backend
spec:
  # Staggered across the instances (17, 37, 57 past 02:00) so three dumps never
  # contend for the single node at once.
  schedule: {{ $pg.backupSchedule | quote }}
  # A dump that is still running when the next window opens means something is
  # wrong; starting a second one alongside it makes it worse.
  concurrencyPolicy: Forbid
  # A window missed because the node was down still runs when it returns.
  startingDeadlineSeconds: {{ $backups.startingDeadlineSeconds }}
  successfulJobsHistoryLimit: {{ $backups.successfulJobsHistoryLimit }}
  failedJobsHistoryLimit: {{ $backups.failedJobsHistoryLimit }}
  jobTemplate:
    spec:
      template:
        metadata:
          labels:
            app: {{ $pg.name }}-backup
            app.kubernetes.io/part-of: luna-shopper-backend
        spec:
          restartPolicy: OnFailure
          containers:
            - name: dump
              # The same image the instance runs, which is what guarantees
              # pg_dump matches the server version.
              image: {{ $backups.image }}
              env:
                # Read from the application Secret rather than duplicated, so
                # there is one copy of each credential in the cluster.
                - name: DB_URL
                  valueFrom:
                    secretKeyRef:
                      name: {{ $secName }}
                      key: {{ $pg.urlSecretKey }}
                - name: DB_NAME
                  value: {{ $pg.database | quote }}
                {{- range $key := (list "S3_ENDPOINT" "S3_BUCKET" "AWS_ACCESS_KEY_ID" "AWS_SECRET_ACCESS_KEY") }}
                - name: {{ $key }}
                  valueFrom:
                    secretKeyRef:
                      name: {{ $backups.secret }}
                      key: {{ $key }}
                {{- end }}
              command:
                - /bin/sh
                - -ec
                - |
                  # `set -e` plus an explicit pipefail: a pg_dump that dies mid
                  # stream must fail the Job, not upload a truncated file.
                  set -o pipefail

                  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
                  out="/tmp/${DB_NAME}-${stamp}.dump"

                  # --format=custom rather than plain SQL: it compresses, and it
                  # is the only format pg_restore can read a table of contents
                  # from, restore selectively from, and validate.
                  pg_dump --format=custom --compress=9 "$DB_URL" > "$out"

                  # The line that matters. The classic backup failure is not a
                  # missing backup, it is a bucket full of zero byte files that
                  # nobody ever looked at. Fail here rather than upload one.
                  pg_restore --list "$out" > /dev/null
                  echo "dump ok: $(wc -c < "$out") bytes"

                  # apk rather than a second image: the aws CLI is the only thing
                  # missing from postgres:16-alpine, and a custom image would be
                  # one more thing to build, publish and keep in step with the
                  # server version this Job depends on matching.
                  apk add --no-cache aws-cli > /dev/null

                  aws s3 cp "$out" \
                    "s3://${S3_BUCKET}/${DB_NAME}/${stamp}.dump" \
                    --endpoint-url "$S3_ENDPOINT"

                  echo "uploaded s3://${S3_BUCKET}/${DB_NAME}/${stamp}.dump"
              volumeMounts:
                - name: scratch
                  mountPath: /tmp
              resources:
                requests:
                  cpu: 100m
                  memory: 128Mi
                limits:
                  cpu: 500m
                  memory: 256Mi
          volumes:
            # The dump is written to an emptyDir rather than the node's own disk
            # under the container root, so a large dump cannot fill the same
            # filesystem the databases are living on.
            - name: scratch
              emptyDir: {}
{{- end }}
{{- end }}
