#!/usr/bin/env bash
#
# Deploy script for the self-hosted stasharr-portal container.
#
# Run this ON THE PROXMOX LXC CONTAINER (not on your dev machine). It:
#   1. Pulls the latest commits for the configured branch into the source clone
#   2. Rebuilds the custom Docker image
#   3. Restarts the compose stack with the new image
#
# Usage:
#   ./deploy-container.sh                  # deploy the branch currently checked out
#   ./deploy-container.sh -b main           # deploy a specific branch
#   SRC_DIR=/opt/stasharr-src COMPOSE_DIR=/opt/stasharr ./deploy-container.sh
#
set -euo pipefail

SRC_DIR="${SRC_DIR:-/opt/stasharr-src}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/stasharr}"
IMAGE_TAG="${IMAGE_TAG:-stasharr-portal:custom}"
BRANCH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -b|--branch)
      BRANCH="$2"
      shift 2
      ;;
    -h|--help)
      sed -n '2,16p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

log() {
  printf '\n\033[1;34m==>\033[0m %s\n' "$1"
}

fail() {
  printf '\n\033[1;31mERROR:\033[0m %s\n' "$1" >&2
  exit 1
}

command -v git >/dev/null 2>&1 || fail "git is not installed."
command -v docker >/dev/null 2>&1 || fail "docker is not installed."

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  fail "Neither 'docker compose' nor 'docker-compose' is available."
fi

[[ -d "$SRC_DIR/.git" ]] || fail "$SRC_DIR is not a git checkout. Set SRC_DIR to your stasharr-src clone."
[[ -f "$COMPOSE_DIR/compose.yaml" ]] || fail "$COMPOSE_DIR/compose.yaml not found. Set COMPOSE_DIR to your compose directory."

cd "$SRC_DIR"

if [[ -z "$BRANCH" ]]; then
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
fi

log "Checking for uncommitted changes in $SRC_DIR"
if [[ -n "$(git status --porcelain)" ]]; then
  fail "Uncommitted changes in $SRC_DIR. Commit, stash, or discard them before deploying."
fi

log "Fetching latest commits"
git fetch origin "$BRANCH"

BEFORE_SHA="$(git rev-parse HEAD)"

log "Checking out and updating branch: $BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

AFTER_SHA="$(git rev-parse HEAD)"

if [[ "$BEFORE_SHA" == "$AFTER_SHA" ]]; then
  log "Already up to date at $AFTER_SHA — rebuilding anyway"
else
  log "Updated $BEFORE_SHA -> $AFTER_SHA"
  git --no-pager log --oneline "$BEFORE_SHA..$AFTER_SHA"
fi

log "Building Docker image: $IMAGE_TAG"
docker build -t "$IMAGE_TAG" "$SRC_DIR"

log "Restarting compose stack in $COMPOSE_DIR"
cd "$COMPOSE_DIR"
"${COMPOSE[@]}" up -d

log "Deploy complete. Recent container status:"
"${COMPOSE[@]}" ps

log "Pruning dangling images"
docker image prune -f >/dev/null

log "Done. Follow logs with: cd $COMPOSE_DIR && ${COMPOSE[*]} logs -f"
