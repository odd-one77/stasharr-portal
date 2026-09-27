#!/usr/bin/env bash
# Fresh-install Whisparr-Eros the same way the existing production instance
# was actually installed: via Proxmox VE Community Scripts
# (community-scripts/ProxmoxVED), which provisions its own LXC, downloads
# Whisparr's prebuilt release binary from github.com/Whisparr/Whisparr-Eros
# into /opt/Whisparr-Eros, and runs it as a systemd service
# ("whisparr-eros", data dir /var/lib/whisparr-eros, config.xml inside it).
#
# This is deliberately NOT a from-scratch `pct create` + Docker deployment --
# an earlier version of this script guessed a hotio Docker image, which does
# not match how this install actually works and would have silently produced
# something incompatible with the config-file edit below.
#
# After the community-scripts installer finishes, this script applies the
# same post-install change that was made manually to the existing instance:
# pointing Whisparr's own WhisparrMetadata config entry at Stasharr's
# self-hosted, TPDB-backed metadata proxy (apps/sp-api/src/whisparr-metadata)
# instead of Whisparr's default https://api.whisparr.com/v4/{route}. Whisparr
# never talks to TPDB or StashDB directly -- SkyHookProxy.cs calls whatever
# base URL is configured there for every scene/performer/studio search.
#
# Run this ON THE PROXMOX HOST as root.
#
# The community-scripts installer is interactive by default (Default vs
# Advanced settings, then CT ID/hostname/disk/cores/RAM/network/storage via
# whiptail) -- same as it was for the existing instance. Answer it the same
# way you did before; this script auto-detects the resulting CTID by diffing
# `pct list` before/after and applies the metadata-proxy config to it.
#
# If auto-detection fails (e.g. you ran the installer separately), re-apply
# just the metadata step against an existing container with:
#   CTID=<id> STASHARR_METADATA_URL='http://host:3000/api/whisparr-metadata/{route}' \
#     ./install-whisparr-eros-lxc.sh --apply-metadata-only
set -euo pipefail

# ---- Configuration (override via env vars) ----
# This is the URL already in use in production -- change it if Stasharr's
# host/port differs for this install.
STASHARR_METADATA_URL="${STASHARR_METADATA_URL:-http://10.50.50.201:3000/api/whisparr-metadata/{route}}"
COMMUNITY_SCRIPT_URL="${COMMUNITY_SCRIPT_URL:-https://raw.githubusercontent.com/community-scripts/ProxmoxVED/main/ct/whisparr-eros.sh}"
CTID="${CTID:-}"

apply_metadata_config() {
  local ctid="$1"

  echo "==> Waiting for Whisparr-Eros to write its initial config.xml"
  for _ in $(seq 1 30); do
    if pct exec "$ctid" -- test -f /var/lib/whisparr-eros/config.xml; then
      break
    fi
    sleep 2
  done

  if ! pct exec "$ctid" -- test -f /var/lib/whisparr-eros/config.xml; then
    echo "error: /var/lib/whisparr-eros/config.xml never appeared in CTID $ctid." >&2
    echo "       Is Whisparr-Eros actually installed there? Check 'pct exec $ctid -- systemctl status whisparr-eros'." >&2
    exit 1
  fi

  echo "==> Pointing Whisparr-Eros' metadata source at: $STASHARR_METADATA_URL"
  pct exec "$ctid" -- bash -c "
set -euo pipefail
CONFIG_FILE=/var/lib/whisparr-eros/config.xml
cp \"\$CONFIG_FILE\" \"\${CONFIG_FILE}.bak.\$(date +%Y%m%d%H%M%S)\"
if grep -q '<WhisparrMetadata>' \"\$CONFIG_FILE\"; then
  sed -i 's#<WhisparrMetadata>.*</WhisparrMetadata>#<WhisparrMetadata>${STASHARR_METADATA_URL}</WhisparrMetadata>#' \"\$CONFIG_FILE\"
  echo 'Updated existing <WhisparrMetadata> entry.'
else
  sed -i 's#</Config>#  <WhisparrMetadata>${STASHARR_METADATA_URL}</WhisparrMetadata>\n</Config>#' \"\$CONFIG_FILE\"
  echo 'Inserted new <WhisparrMetadata> entry.'
fi
grep WhisparrMetadata \"\$CONFIG_FILE\"
systemctl restart whisparr-eros
"
  echo "==> Done. Verify with:"
  echo "    pct exec $ctid -- journalctl -u whisparr-eros -n 50 --no-pager | grep -i whisparrmetadata"
}

if ! command -v pct >/dev/null 2>&1; then
  echo "error: 'pct' not found. Run this script on the Proxmox VE host, not inside a container." >&2
  exit 1
fi
if [[ "$(id -u)" -ne 0 ]]; then
  echo "error: run as root." >&2
  exit 1
fi

if [[ "${1:-}" == "--apply-metadata-only" ]]; then
  if [[ -z "$CTID" ]]; then
    echo "error: --apply-metadata-only requires CTID=<id> to be set." >&2
    exit 1
  fi
  apply_metadata_config "$CTID"
  exit 0
fi

BEFORE_CTIDS="$(pct list | awk 'NR>1{print $1}' | sort)"

echo "==> Launching the official Whisparr-Eros installer (community-scripts/ProxmoxVED)."
echo "    This prompts interactively -- answer it the same way you did for the"
echo "    existing instance (Default settings is fine unless you need to match"
echo "    specific resource/network choices)."
echo
bash -c "$(curl -fsSL "$COMMUNITY_SCRIPT_URL")"

AFTER_CTIDS="$(pct list | awk 'NR>1{print $1}' | sort)"
NEW_CTID="$(comm -13 <(echo "$BEFORE_CTIDS") <(echo "$AFTER_CTIDS") | head -1)"

if [[ -z "$NEW_CTID" ]]; then
  cat <<MSG >&2

warning: couldn't auto-detect the new CTID from 'pct list'.
Find it yourself (it'll be the newest entry), then run:
  CTID=<id> STASHARR_METADATA_URL='$STASHARR_METADATA_URL' $0 --apply-metadata-only
MSG
  exit 0
fi

echo "==> Detected new container: CTID $NEW_CTID"
apply_metadata_config "$NEW_CTID"

CT_IP="$(pct exec "$NEW_CTID" -- hostname -I | awk '{print $1}')"

cat <<SUMMARY

==> Done.
    Container:     CTID $NEW_CTID
    Service:       whisparr-eros (systemd) at /opt/Whisparr-Eros, data in /var/lib/whisparr-eros
    Metadata proxy: ${STASHARR_METADATA_URL}

    Open http://${CT_IP}:6969 to finish setup (root folders, indexers,
    connect it to Stasharr's Whisparr integration with a fresh API key from
    Settings > General -- the API key is per-install and won't match any
    old one you had saved).
SUMMARY
