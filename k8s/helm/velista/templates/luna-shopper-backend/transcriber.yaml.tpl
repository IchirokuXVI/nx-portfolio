{{- $ls := .Values.lunaShopperBackend }}
{{- $tr := $ls.transcriber | default dict }}
{{- if and $ls.enabled $tr.enabled }}
{{- $root := . }}
{{- $name := "luna-shopper-backend-transcriber" }}
{{- /*
The transcriber (plan 0235, section 9): faster-whisper behind a small HTTP
service, reached by the assistant at TRANSCRIBER_URL and by nothing else. It has
no HTTPRoute, so nothing outside the cluster can send it a recording.

Its own template rather than an entry in `lunaShopperBackend.services`, because
the shared Deployment there injects the Node environment of every service
(`lunaShopperBackend.env`, the ConfigMap and the Secret keys) and Node's
resources, none of which apply to a Python process that needs four values and
two cores. The probe paths are the same on purpose: `/health/ready` and
`/health/live`.

Rendered only when `transcriber.enabled` is true, which is production alone.
Staging renders nothing here, and the configmap writes an empty TRANSCRIBER_URL,
so voice there reads as off and never as broken.
*/}}
---
# The model cache (section 5.1): about 2 GB for both models, downloaded on the
# first start at the pinned revisions and kept. `keep` means turning voice off
# deletes the pods and leaves this claim, so turning it back on costs no second
# download. Delete it by hand when the feature is gone for good.
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {{ $name }}-models
  namespace: {{ $root.Release.Namespace }}
  labels:
    app: {{ $name }}
    app.kubernetes.io/part-of: luna-shopper-backend
  annotations:
    helm.sh/resource-policy: keep
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: {{ $tr.storageClassName | default "local-path" }}
  resources:
    requests:
      storage: {{ $tr.storageSize | default "5Gi" }}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ $name }}
  namespace: {{ $root.Release.Namespace }}
  labels:
    app: {{ $name }}
    app.kubernetes.io/part-of: luna-shopper-backend
spec:
  # One replica, taken down before the next one starts (section 6.1). Two pods
  # would each hold both models in memory, and the volume is ReadWriteOnce. A
  # deploy is a minute without voice, which the assistant already says as a
  # failed transcription.
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: {{ $name }}
  template:
    metadata:
      labels:
        app: {{ $name }}
        app.kubernetes.io/part-of: luna-shopper-backend
    spec:
      {{- include "charts.imagePullSecrets" $root | nindent 6 }}
      terminationGracePeriodSeconds: {{ $ls.terminationGracePeriodSeconds }}
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        # The volume is written by the first download, as the image's uid.
        fsGroup: 1000
      containers:
        - name: {{ $name }}
          image: {{ $tr.image }}:{{ $root.Values.imageTag }}
          imagePullPolicy: {{ $ls.imagePullPolicy }}
          ports:
            - containerPort: {{ $tr.port | default 3007 }}
          env:
            - name: PORT
              value: {{ $tr.port | default 3007 | quote }}
            - name: TRANSCRIBER_TURN_MODEL
              value: {{ $tr.turnModel | default "small" | quote }}
            - name: TRANSCRIBER_COMMENT_MODEL
              value: {{ $tr.commentModel | default "large-v3-turbo" | quote }}
            # One thread per core the pod holds, the setting the bench measured.
            - name: TRANSCRIBER_THREADS
              value: {{ $tr.resources.limits.cpu | default "2" | quote }}
          # Ready only once both models are in memory, so no clip reaches a pod
          # that would download a model on the caller's time. The first start
          # downloads about 2 GB, and voice is off until then.
          readinessProbe:
            httpGet:
              path: /health/ready
              port: {{ $tr.port | default 3007 }}
            initialDelaySeconds: 5
            periodSeconds: 10
            failureThreshold: 3
          # Answers while the process runs, downloads included: the models load
          # on a thread of their own.
          livenessProbe:
            httpGet:
              path: /health/live
              port: {{ $tr.port | default 3007 }}
            initialDelaySeconds: 15
            periodSeconds: 20
            failureThreshold: 3
          volumeMounts:
            - name: models
              mountPath: /models
          resources:
            {{- toYaml $tr.resources | nindent 12 }}
      volumes:
        - name: models
          persistentVolumeClaim:
            claimName: {{ $name }}-models
---
# ClusterIP only, on the port TRANSCRIBER_URL names.
apiVersion: v1
kind: Service
metadata:
  name: {{ $name }}
  namespace: {{ $root.Release.Namespace }}
  labels:
    app: {{ $name }}
    app.kubernetes.io/part-of: luna-shopper-backend
spec:
  type: ClusterIP
  selector:
    app: {{ $name }}
  ports:
    - port: {{ $tr.port | default 3007 }}
      targetPort: {{ $tr.port | default 3007 }}
{{- end }}
