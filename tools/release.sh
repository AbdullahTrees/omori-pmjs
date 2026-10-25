#!/usr/bin/env bash
# OMORI (PMJS) release pipeline.
#
#   tools/release.sh prepare  --version v0.7.2 --changes "Fixed X; Improved Y"
#   tools/release.sh check    --version v0.7.2 [--receipt device.json]
#   tools/release.sh publish  --version v0.7.2 --receipt device.json
#   tools/release.sh status
#
# prepare writes docs/releases/<version>.md and CHANGELOG.md, commits and
# pushes main, then builds share/out/OMORI-PMJS-<version>.zip from that commit.
# publish verifies the artifact and receipt, tags the commit and creates the
# GitHub release (latest for a full release, prerelease with --prerelease).
# The build runs in WSL when wsl.exe is available; GitHub steps use gh.
set -euo pipefail

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

REPO_SLUG=${REPO_SLUG:-AbdullahTrees/omori-pmjs}
DISTRO=${WSL_DISTRO:-Ubuntu-22.04}
TAG_PREFIX=${TAG_PREFIX:-OMORI-PMJS-}
BRANCH=${BRANCH:-main}
OUT=share/out

MODE=${1:-help}
if [ $# -gt 0 ]; then shift; fi

VERSION= CHANGES= CHANGES_FILE= ARTIFACT= RECEIPT= COMMIT=
PRERELEASE=0 DRY_RUN=0 FORCE=0 ALLOW_UNVERIFIED=0 CO_AUTHOR=0 NO_BUILD=0

usage() {
  cat <<'EOF'
Usage: tools/release.sh <command> [options]

Commands:
  prepare   Write release notes/changelog, commit+push main, build the ZIP.
  build     Build and check the ZIP for the current pushed commit (resume a prepare).
  check     Validate an artifact (and optional device receipt) without changes.
  publish   Tag the source commit and create the GitHub release.
  promote   Upload a receipt to an existing prerelease or unverified release and mark it Latest.
  status    Show recent GitHub releases.
  help      This text.

Options:
  --version VERSION       Semantic version, e.g. v0.7.2 (required for prepare). Legacy date versions still work for check/promote.
  --changes TEXT          One-line or semicolon-separated changes (prepare).
  --changes-file FILE     Read changes from a file (prepare).
  --artifact FILE         ZIP to check/publish (default share/out/OMORI-PMJS-<version>.zip).
  --commit SHA            Source commit to check against (default HEAD; use the release tag commit for an existing artifact).
  --receipt FILE          Device verification receipt (required for a full release or promote).
  --prerelease            Create a GitHub prerelease; a receipt is optional.
  --skip-device-check     Publish a full release without a device receipt (alias --allow-unverified).
  --dry-run               Preview actions; only a local release-body file may be written, never commits or GitHub changes.
  --force                 Overwrite an existing notes file in prepare.
  --no-build              prepare without building the ZIP.
  --co-author             Add the Claude Code co-author trailer to the release commit.
  --repo OWNER/REPO       GitHub repository (default AbdullahTrees/omori-pmjs).
  --branch BRANCH         Branch to release from (default main).
EOF
}

say() { printf '%s\n' "$*"; }
die() { printf 'release: %s\n' "$*" >&2; exit 1; }

have_wsl() {
  [ -n "${WSL_DISTRO_NAME:-}" ] && return 1
  command -v wsl.exe >/dev/null 2>&1
}
wsl_root() { wsl.exe -d "$DISTRO" -e wslpath -a "$(pwd -W)" | tr -d '\r'; }
win_path() {
  local dir
  dir=$(cd "$(dirname -- "$1")" && pwd -W) || return 1
  printf '%s/%s\n' "$dir" "$(basename -- "$1")"
}
abs_path() {
  if have_wsl; then
    win_path "$1"
  else
    (cd "$(dirname -- "$1")" && printf '%s/%s\n' "$(pwd)" "$(basename -- "$1")")
  fi
}
to_wsl() {
  if have_wsl; then
    wsl.exe -d "$DISTRO" -e wslpath -a "$(win_path "$1")" | tr -d '\r'
  else
    abs_path "$1"
  fi
}
sha256_of() { sha256sum "$1" | awk '{print $1}'; }

require_clean() {
  [ -z "$(git status --porcelain)" ] || die "working tree is not clean; commit or stash first"
}

require_sync() {
  git fetch --quiet origin "$BRANCH"
  [ "$(git rev-parse --abbrev-ref HEAD)" = "$BRANCH" ] || die "not on branch $BRANCH"
  [ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$BRANCH")" ] \
    || die "local $BRANCH is not pushed to origin; push first"
}

tag_for_version() {
  case "$1" in
    v[0-9]*) printf '%s\n' "$1" ;;
    *) printf '%s%s\n' "$TAG_PREFIX" "$1" ;;
  esac
}

CHECK_SHA= CHECK_SIZE= CHECK_COMMIT= CHECK_DEVICE= CHECK_CFW= CHECK_RESOLUTION= CHECK_TESTS=

check_artifact() {
  local art=${1:-$ARTIFACT}
  local receipt=${2:-$RECEIPT}
  local commit=${3:-$(git rev-parse HEAD)}
  [ -f "$art" ] || die "artifact not found: $art"
  local args=(--artifact "$(to_wsl "$art")" --version "$VERSION" --commit "$commit" --format shell)
  if [ -n "$receipt" ]; then
    [ -f "$receipt" ] || die "receipt not found: $receipt"
    args+=(--receipt "$(to_wsl "$receipt")" --require-receipt)
  fi
  local cmd=""
  if have_wsl; then
    cmd="cd $(printf '%q' "$(wsl_root)") && python3 tools/release_check.py"
  else
    cmd="cd $(printf '%q' "$ROOT") && python3 tools/release_check.py"
  fi
  local arg
  for arg in "${args[@]}"; do cmd+=" $(printf '%q' "$arg")"; done
  local out
  if have_wsl; then
    if ! out=$(wsl.exe -d "$DISTRO" -e bash -lc "$cmd"); then
      die "artifact check failed"
    fi
  else
    if ! out=$(bash -lc "$cmd"); then
      die "artifact check failed"
    fi
  fi
  while IFS='=' read -r key value; do
    case "$key" in
      CHECK) [ "$value" = ok ] || die "artifact check failed" ;;
      SHA256) CHECK_SHA=$value ;;
      SIZE) CHECK_SIZE=$value ;;
      COMMIT) CHECK_COMMIT=$value ;;
      RECEIPT_DEVICE) CHECK_DEVICE=$value ;;
      RECEIPT_CFW) CHECK_CFW=$value ;;
      RECEIPT_RESOLUTION) CHECK_RESOLUTION=$value ;;
      RECEIPT_TESTS) CHECK_TESTS=$value ;;
    esac
  done <<< "$out"
  [ -n "$CHECK_SHA" ] || die "artifact check produced no checksum"
  say "artifact ok: $VERSION, $CHECK_SHA, $(( ${CHECK_SIZE:-0} / 1048576 )) MiB, source $CHECK_COMMIT"
}

build_artifact() {
  [ -n "$VERSION" ] || die "--version is required"
  if [ "$DRY_RUN" = 1 ]; then
    say "would build share/out/OMORI-PMJS-$VERSION.zip from $(git rev-parse --short HEAD)"
    return 0
  fi
  local args=(--version "$VERSION" --require-screenshot)
  if [ -n "${PMJS_RUNTIME:-}" ]; then args+=(--runtime "$PMJS_RUNTIME"); fi
  if [ -n "${PMJS_RUNTIME_SRC:-}" ]; then args+=(--runtime-src "$PMJS_RUNTIME_SRC"); fi
  if have_wsl; then
    local root cmd arg
    root=$(wsl_root)
    cmd="cd $(printf '%q' "$root") && { [ -f \"\$HOME/omori-test/build-env/env.sh\" ] && source \"\$HOME/omori-test/build-env/env.sh\"; } || true; python3 tools/release-build.py"
    for arg in "${args[@]}"; do cmd+=" $(printf '%q' "$arg")"; done
    say "building $VERSION in WSL ($DISTRO)"
    wsl.exe -d "$DISTRO" -e bash -lc "$cmd"
  else
    say "building $VERSION locally"
    ( cd "$ROOT" && { [ -f "$HOME/omori-test/build-env/env.sh" ] && source "$HOME/omori-test/build-env/env.sh"; } || true; python3 tools/release-build.py "${args[@]}" )
  fi
  ARTIFACT="$OUT/OMORI-PMJS-$VERSION.zip"
  [ -f "$ARTIFACT" ] || die "build did not produce $ARTIFACT"
}

write_notes() {
  local date changes
  date=$(date +%Y-%m-%d)
  changes=$(printf '%s\n' "$CHANGES" | sed 's/; */\n/g' | sed '/^$/d; s/^\([^-*#].*\)$/- \1/')
  if [ "$DRY_RUN" = 1 ]; then
    say "would write docs/releases/$VERSION.md and update CHANGELOG.md"
    say "$changes"
    return 0
  fi
  mkdir -p docs/releases
  CHANGES="$changes" awk -v version="$VERSION" -v date="$date" '
    $0 == "@CHANGES@" { print ENVIRON["CHANGES"]; next }
    { gsub(/@VERSION@/, version); gsub(/@DATE@/, date); print }
  ' docs/releases/TEMPLATE.md > "docs/releases/$VERSION.md"
  local tmp
  tmp=$(mktemp)
  if [ -f CHANGELOG.md ]; then
    CHANGES="$changes" awk -v version="$VERSION" -v date="$date" '
      NR == 1 && $0 == "# Changelog" {
        print; print ""; print "## " version " - " date; print ""; print ENVIRON["CHANGES"]; print ""; seen=1; next
      }
      $0 ~ ("^## " version " - ") { skip=1; next }
      /^## / { skip=0 }
      skip { next }
      { print }
      END { if (!seen) { print "## " version " - " date; print ""; print ENVIRON["CHANGES"]; print "" } }
    ' CHANGELOG.md > "$tmp"
  else
    printf '# Changelog\n\n## %s - %s\n\n%s\n' "$VERSION" "$date" "$changes" > "$tmp"
  fi
  mv "$tmp" CHANGELOG.md
}

cmd_prepare() {
  require_clean
  [ "$(git rev-parse --abbrev-ref HEAD)" = "$BRANCH" ] || die "not on branch $BRANCH"
  [ -n "$VERSION" ] || die "--version is required; use a semantic version such as v0.7.3"
  [[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] \
    || die "prepare requires a semantic version such as v0.7.3"
  local tag
  tag=$(tag_for_version "$VERSION")
  if [ -n "$CHANGES_FILE" ]; then
    [ -f "$CHANGES_FILE" ] || die "changes file not found: $CHANGES_FILE"
    CHANGES=$(tr -d '\r' < "$CHANGES_FILE")
  fi
  [ -n "$CHANGES" ] || die "--changes or --changes-file is required"
  if git rev-parse -q --verify "refs/tags/$tag" >/dev/null 2>&1; then
    die "tag $tag already exists"
  fi
  if [ "$(git log -1 --format=%s)" = "Release $VERSION" ] && [ -f "docs/releases/$VERSION.md" ]; then
    say "release commit for $VERSION is already HEAD; resuming with the build"
    if [ "$DRY_RUN" = 1 ]; then
      say "would build share/out/OMORI-PMJS-$VERSION.zip from HEAD"
      return 0
    fi
    if [ "$NO_BUILD" = 0 ]; then
      build_artifact
      check_artifact "$ARTIFACT" "" "$(git rev-parse HEAD)"
      say ""
      say "Next: device-test $ARTIFACT, write a receipt (docs/RELEASING.md), then:"
      say "  tools/release.sh publish --version $VERSION --receipt <receipt.json>"
    fi
    return 0
  fi
  if [ -f "docs/releases/$VERSION.md" ] && [ "$FORCE" != 1 ]; then
    die "docs/releases/$VERSION.md exists; use --force or run 'tools/release.sh build --version $VERSION'"
  fi
  write_notes
  if [ "$DRY_RUN" = 1 ]; then
    say "would commit Release $VERSION, push $BRANCH, and build"
    return 0
  fi
  git add "docs/releases/$VERSION.md" CHANGELOG.md
  if [ "$CO_AUTHOR" = 1 ]; then
    git commit -m "Release $VERSION" -m "$CHANGES" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
  else
    git commit -m "Release $VERSION" -m "$CHANGES"
  fi
  git push origin "$BRANCH"
  if [ "$NO_BUILD" = 0 ]; then
    build_artifact
    check_artifact "$ARTIFACT" "" "$(git rev-parse HEAD)"
    say ""
    say "Next: device-test $ARTIFACT, write a receipt (docs/RELEASING.md), then:"
    say "  tools/release.sh publish --version $VERSION --receipt <receipt.json>"
  else
    say "Next: build share/out/OMORI-PMJS-$VERSION.zip from this commit, device-test it, then publish."
  fi
}

cmd_build() {
  [ -n "$VERSION" ] || die "--version is required"
  ARTIFACT="$OUT/OMORI-PMJS-$VERSION.zip"
  require_clean
  require_sync
  build_artifact
  check_artifact "$ARTIFACT" "" "$(git rev-parse HEAD)"
  say ""
  say "Next: device-test $ARTIFACT, write a receipt (docs/RELEASING.md), then:"
  say "  tools/release.sh publish --version $VERSION --receipt <receipt.json>"
}

cmd_check() {  [ -n "$VERSION" ] || die "--version is required"
  ARTIFACT=${ARTIFACT:-$OUT/OMORI-PMJS-$VERSION.zip}
  [ -f "docs/releases/$VERSION.md" ] || die "notes missing: docs/releases/$VERSION.md"
  local commit
  commit=$(git rev-parse "${COMMIT:-HEAD}^{commit}") || die "cannot resolve commit ${COMMIT:-HEAD}"
  check_artifact "$ARTIFACT" "$RECEIPT" "$commit"
  say "notes ok: docs/releases/$VERSION.md"
  if [ -n "$RECEIPT" ]; then say "receipt ok: $RECEIPT"; fi
}

write_release_body() {
  local version=$1 tag=$2 head=$3
  body="$OUT/release-body-$version.md"
  {
    if [ "$PRERELEASE" = 1 ]; then
      printf '> **Pre-release:** this build is awaiting device verification of the exact ZIP.\n\n'
    elif [ "$ALLOW_UNVERIFIED" = 1 ] && [ -z "$RECEIPT" ]; then
      printf '> **Unverified:** this build was published without a device receipt.\n\n'
    fi
    printf '# OMORI (PMJS) %s\n\n' "$version"
    printf '**Download:** [OMORI-PMJS-%s.zip](https://github.com/%s/releases/download/%s/OMORI-PMJS-%s.zip) | [latest stable](https://github.com/%s/releases/latest/download/OMORI-PMJS.zip)\n\n' \
      "$version" "$REPO_SLUG" "$tag" "$version" "$REPO_SLUG"
    printf '![OMORI on the RG40XX-H](https://github.com/%s/releases/download/%s/screenshot.png)\n\n' "$REPO_SLUG" "$tag"
    cat "docs/releases/$version.md"
    printf '\n\n## SHA-256\n\n```\n%s  OMORI-PMJS-%s.zip\n```\n' "$CHECK_SHA" "$version"
    if [ -n "$CHECK_DEVICE" ]; then
      printf '\n## Device verification\n\n%s on %s, %s. Tests: %s. The receipt is attached.\n' \
        "$CHECK_DEVICE" "$CHECK_CFW" "$CHECK_RESOLUTION" "$CHECK_TESTS"
    fi
    printf '\n## Source\n\nPort sources: https://github.com/%s at commit `%s`.\n' "$REPO_SLUG" "$head"
  } > "$body"
}

cmd_publish() {
  [ -n "$VERSION" ] || die "--version is required"
  ARTIFACT=${ARTIFACT:-$OUT/OMORI-PMJS-$VERSION.zip}
  [ -f "$ARTIFACT" ] || die "artifact not found: $ARTIFACT"
  [ -f "docs/releases/$VERSION.md" ] || die "notes missing: docs/releases/$VERSION.md"
  if [ "$PRERELEASE" = 0 ] && [ -z "$RECEIPT" ] && [ "$ALLOW_UNVERIFIED" != 1 ]; then
    die "a device receipt is required for a full release (or use --prerelease)"
  fi
  require_clean
  require_sync
  local head tag stable body
  head=$(git rev-parse HEAD)
  check_artifact "$ARTIFACT" "$RECEIPT" "$head"
  tag=$(tag_for_version "$VERSION")
  if git rev-parse -q --verify "refs/tags/$tag" >/dev/null 2>&1; then
    die "tag $tag already exists"
  fi
  if gh release view "$tag" -R "$REPO_SLUG" >/dev/null 2>&1; then
    die "release $tag already exists"
  fi
  stable="$OUT/OMORI-PMJS.zip"
  [ -f "$stable" ] || die "stable copy missing: $stable"
  [ "$(sha256_of "$stable")" = "$CHECK_SHA" ] || die "stable copy differs from the versioned artifact; rebuild"
  [ -f "$ARTIFACT.sha256" ] || die "checksum file missing: $ARTIFACT.sha256"
  [ -f "$OUT/OMORI-PMJS-$VERSION.json" ] || die "manifest missing: $OUT/OMORI-PMJS-$VERSION.json"

  write_release_body "$VERSION" "$tag" "$head"

  if [ "$DRY_RUN" = 1 ]; then
    say "would tag $tag at $head, push the tag, and create the GitHub release"
    say "release body: $body"
    return 0
  fi
  git tag -a "$tag" -m "OMORI (PMJS) $VERSION"
  git push origin "$tag"
  local assets=("$ARTIFACT" "$stable" "$ARTIFACT.sha256" "$OUT/OMORI-PMJS-$VERSION.json" "share/omori-pmjs/metadata/screenshot.png")
  if [ -n "$RECEIPT" ]; then assets+=("$RECEIPT"); fi
  local latest=()
  if [ "$PRERELEASE" = 0 ]; then latest=(--latest); fi
  local flags=()
  if [ "$PRERELEASE" = 1 ]; then flags=(--prerelease); fi
  gh release create "$tag" -R "$REPO_SLUG" --title "OMORI (PMJS) $VERSION" --notes-file "$body" "${latest[@]}" "${flags[@]}" "${assets[@]}"
  say "published: https://github.com/$REPO_SLUG/releases/tag/$tag"
}

cmd_promote() {
  [ -n "$VERSION" ] || die "--version is required"
  [ -n "$RECEIPT" ] || die "promote requires --receipt"
  ARTIFACT=${ARTIFACT:-$OUT/OMORI-PMJS-$VERSION.zip}
  [ -f "$ARTIFACT" ] || die "artifact not found: $ARTIFACT"
  [ -f "$RECEIPT" ] || die "receipt not found: $RECEIPT"
  local tag tag_commit
  tag=$(tag_for_version "$VERSION")
  git fetch --quiet origin "refs/tags/$tag:refs/tags/$tag" 2>/dev/null || true
  tag_commit=$(git rev-list -n1 "$tag" 2>/dev/null) || die "tag $tag not found; fetch it first"
  require_clean
  check_artifact "$ARTIFACT" "$RECEIPT" "$tag_commit"
  if ! gh release view "$tag" -R "$REPO_SLUG" >/dev/null 2>&1; then
    die "release $tag not found"
  fi
  # A prerelease or an unverified full release can be promoted.
  PRERELEASE=0
  ALLOW_UNVERIFIED=0
  write_release_body "$VERSION" "$tag" "$tag_commit"
  local receipt_asset="$OUT/device-receipt-$VERSION.json"
  if [ "$RECEIPT" != "$receipt_asset" ]; then
    cp "$RECEIPT" "$receipt_asset"
  fi
  if [ "$DRY_RUN" = 1 ]; then
    say "would upload $receipt_asset and mark $tag Latest"
    say "release body: $body"
    return 0
  fi
  gh release upload "$tag" "$receipt_asset" -R "$REPO_SLUG" --clobber
  gh release edit "$tag" -R "$REPO_SLUG" --prerelease=false --latest --notes-file "$body"
  say "promoted to latest: https://github.com/$REPO_SLUG/releases/tag/$tag"
}

cmd_status() {
  gh release list -R "$REPO_SLUG" --limit 10
}

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION=${2:?}; shift 2 ;;
    --changes) CHANGES=${2:?}; shift 2 ;;
    --changes-file) CHANGES_FILE=${2:?}; shift 2 ;;
    --artifact) ARTIFACT=${2:?}; shift 2 ;;
    --commit) COMMIT=${2:?}; shift 2 ;;
    --receipt) RECEIPT=${2:?}; shift 2 ;;
    --branch) BRANCH=${2:?}; shift 2 ;;
    --repo) REPO_SLUG=${2:?}; shift 2 ;;
    --prerelease) PRERELEASE=1; shift ;;
    --skip-device-check|--allow-unverified) ALLOW_UNVERIFIED=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --force) FORCE=1; shift ;;
    --co-author) CO_AUTHOR=1; shift ;;
    --no-build) NO_BUILD=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

case "$MODE" in
  prepare) cmd_prepare ;;
  build) cmd_build ;;
  check) cmd_check ;;
  publish) cmd_publish ;;
  promote) cmd_promote ;;
  status) cmd_status ;;
  help|--help|-h) usage ;;
  *) usage; die "unknown command: $MODE" ;;
esac
