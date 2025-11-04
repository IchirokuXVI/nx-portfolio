#!/usr/bin/env bash
set -e

REGISTRY=${REGISTRY:-ghcr.io}
ORG=${ORG:-ichirokuxvi}
IMAGE_PREFIX=${IMAGE_PREFIX:-portfolio}
TAG=${TAG:-latest}
PUSH=${PUSH:-false}

# Define base for comparison (default: main)
BASE_SHA=${BASE_SHA:-origin/main}
HEAD_SHA=${HEAD_SHA:-HEAD}

echo "Determining affected apps since $BASE_SHA...$HEAD_SHA"

# Run Nx to find affected apps (JSON output → filter to names)
AFFECTED_APPS=$(npx nx print-affected --base=$BASE_SHA --head=$HEAD_SHA --select=projects | jq -r '.[]')

if [ -z "$AFFECTED_APPS" ]; then
  echo "No affected apps detected. Skipping build."
  exit 0
fi

echo "Affected apps: $AFFECTED_APPS"

# Base images (builder + nginx)
docker build -t $REGISTRY/$ORG/$IMAGE_PREFIX-builder:$TAG -f docker/prod/common/Dockerfile.builder .
docker build -t $REGISTRY/$ORG/$IMAGE_PREFIX-http-server:$TAG -f docker/prod/common/Dockerfile.http-server .

# Loop over affected apps
for app in $AFFECTED_APPS; do
  echo "Building image for: $app"
  docker build \
    --build-arg APP_NAME=$app \
    -t $REGISTRY/$ORG/$IMAGE_PREFIX-$app:$TAG \
    -f docker/prod/common/Dockerfile.base .

  if [ "$PUSH" = "true" ]; then
    echo "Pushing image for: $app"
    docker push $REGISTRY/$ORG/$IMAGE_PREFIX-$app:$TAG
    docker tag $REGISTRY/$ORG/$IMAGE_PREFIX-$app:$TAG $REGISTRY/$ORG/$IMAGE_PREFIX-$app:latest
    docker push $REGISTRY/$ORG/$IMAGE_PREFIX-$app:latest
  fi
done
