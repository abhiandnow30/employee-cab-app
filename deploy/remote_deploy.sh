#!/usr/bin/env bash
# Runs ON THE SERVER over SSH, invoked by .github/workflows/deploy.yml.
# Args are plain positional values (already resolved from GitHub Actions
# expressions before this script ever runs) -- no ${{ }} syntax appears here.
set -euo pipefail

DEPLOY_DIR="$1"
RELEASE_TAR="$2"
IMAGE_NAME="$3"
CONTAINER_NAME="$4"
HEALTHCHECK_URL="$5"
# Optional 6th arg. Empty is a normal, supported value -- it means "Hotjar off".
HOTJAR_SITE_ID="${6:-}"

cd "$DEPLOY_DIR"

echo "== Overlaying new tracked files (never rm -rf; .env and other untracked files are untouched) =="
tar xzf "$RELEASE_TAR"
rm -f "$RELEASE_TAR"
# NOTE: a file that was deleted in git will NOT be removed here -- overlay-only
# deploys never delete. If a commit removes a file that matters at runtime,
# that removal needs a manual follow-up on the server.

# The Hotjar Site ID reaches the bundle through app/public/runtime-config.js,
# which Expo copies verbatim into dist/. Written HERE, after the tar overlay and
# before the build, because:
#   - the tar always restores the blank committed version, so this is idempotent
#     and a removed repo variable really does switch recording back off;
#   - there is no Dockerfile in git (the image is built from a compose file that
#     lives on the server), so there is no ARG/ENV of ours to plumb it through;
#   - it is not a secret -- it ships inside client-side JavaScript either way --
#     which is why it comes from a GitHub *variable*, not a secret.
# A non-numeric value is refused here rather than being written: the app would
# only warn and disable itself, and failing loudly at deploy time is more useful.
RUNTIME_CONFIG="app/public/runtime-config.js"
if [ -z "$HOTJAR_SITE_ID" ]; then
  echo "== HOTJAR_SITE_ID is not set -- leaving Hotjar off (no script, no recording) =="
elif ! printf '%s' "$HOTJAR_SITE_ID" | grep -Eq '^[0-9]+$'; then
  echo "== ERROR: HOTJAR_SITE_ID='$HOTJAR_SITE_ID' is not digits only. Fix the repository variable. =="
  exit 1
elif [ ! -f "$RUNTIME_CONFIG" ]; then
  echo "== ERROR: $RUNTIME_CONFIG is missing -- cannot apply HOTJAR_SITE_ID. =="
  exit 1
else
  echo "== Writing Hotjar Site ID $HOTJAR_SITE_ID into $RUNTIME_CONFIG =="
  # Only the hotjarSiteId line is touched, whatever else the file grows later.
  sed -i "s/hotjarSiteId: \"[^\"]*\"/hotjarSiteId: \"${HOTJAR_SITE_ID}\"/" "$RUNTIME_CONFIG"
  grep -q "hotjarSiteId: \"${HOTJAR_SITE_ID}\"" "$RUNTIME_CONFIG" || {
    echo "== ERROR: the substitution did not take. Has the hotjarSiteId line changed shape? =="
    exit 1
  }
fi

echo "== Capturing currently-running image (rollback target) =="
OLD_IMAGE_ID=$(docker inspect "$CONTAINER_NAME" --format '{{.Image}}' 2>/dev/null || echo "")

echo "== Building the new image (current container is untouched by this step) =="
docker compose build
# If this fails, `set -e` stops the script here. Nothing below has run:
# the running container/image is completely untouched, so a build failure
# never takes production down.

if [ -n "$OLD_IMAGE_ID" ]; then
  echo "== Build succeeded: tagging the currently-running image as ':previous' before swapping =="
  docker tag "$OLD_IMAGE_ID" "${IMAGE_NAME}:previous"
else
  echo "== No currently-running container found (first deploy?) -- nothing to tag as previous =="
fi

# From here on we handle failures ourselves instead of letting `set -e` kill the
# script -- a failure in the swap itself (not just a failed health check) must
# still trigger rollback, or a bad swap could leave production down with nothing
# automatic to fix it.

rollback_and_exit() {
  echo "== Rolling back to the previous version automatically. =="
  if ! docker image inspect "${IMAGE_NAME}:previous" >/dev/null 2>&1; then
    echo "== CRITICAL: no ':previous' image exists to roll back to (first-ever deploy?). Manual intervention required NOW. =="
    exit 1
  fi

  docker tag "${IMAGE_NAME}:previous" "${IMAGE_NAME}:latest"
  docker compose up -d || true

  echo "== Re-checking health after rollback =="
  for i in $(seq 1 10); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$HEALTHCHECK_URL" || echo "000")
    echo "Rollback attempt $i: HTTP $code"
    if [ "$code" = "200" ]; then
      echo "== Rollback succeeded: the previous version is live again. Production is safe. =="
      echo "== Git was never touched -- the broken commit(s) stay on main. Fix locally and push again. =="
      echo "== NOTE: if this deploy included a database migration, a partially-applied migration is NOT undone by this container rollback. Check manually. =="
      exit 1
    fi
    sleep 3
  done

  echo "== CRITICAL: the rollback image ALSO failed its health check. Manual intervention required NOW. =="
  exit 1
}

echo "== Swapping to the new version =="
if ! docker compose up -d; then
  echo "== Swap command itself failed. =="
  rollback_and_exit
fi

echo "== Health-checking ${HEALTHCHECK_URL} =="
healthy=0
for i in $(seq 1 10); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$HEALTHCHECK_URL" || echo "000")
  echo "Attempt $i: HTTP $code"
  if [ "$code" = "200" ]; then
    healthy=1
    break
  fi
  sleep 3
done

if [ "$healthy" = "1" ]; then
  echo "== Deploy successful, new version is live =="
  exit 0
fi

echo "== Health check FAILED. =="
rollback_and_exit
