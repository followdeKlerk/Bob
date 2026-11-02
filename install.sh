#!/usr/bin/env bash
# Download this file, inspect it, then run with Bash. No Node is needed to start.
set -euo pipefail
umask 077

readonly NODE_VERSION=24.22.1
readonly NODE_ARCHIVE="node-v${NODE_VERSION}-linux-x64.tar.xz"
readonly NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}"
readonly REPOSITORY=https://github.com/followdeKlerk/Bob.git
check_only=false
source_override=''
tmp=''
cleanup() { if [[ -n "$tmp" ]]; then rm -rf -- "$tmp"; fi; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
say() { printf '%s\n' "$*"; }
die() { printf 'Bob bootstrap: %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'HELP'
Usage: bash install.sh [--check] [--source-dir /absolute/path]

Guided Linux x86_64 bootstrap, run as your normal (non-root) user.
  --help        Show this help; make no changes.
  --check       Read-only platform, runtime, dependency and path inspection.
  --source-dir  Use this Bob checkout, or clone into this NEW directory.

Requires Bash and standard Linux utilities. Missing curl/tar/xz/git/coreutils
can be installed with apt, dnf or pacman ONLY after a displayed plan and your
terminal confirmation, using sudo. Otherwise install the listed tools yourself.
An incompatible/missing Node can be replaced for Bob ONLY by a private copy of
Node 24.22.1 from nodejs.org, checked against its HTTPS SHA256 manifest.
No global Node, shell profile, existing checkout, service or Android tools are
replaced or installed. Existing dist/cli.js is reused without npm ci/build.

Default new source/runtime: ${XDG_DATA_HOME:-$HOME/.local/share}/bob-bootstrap/
Launcher: $HOME/.local/bin/bob (never overwrites a different launcher).
Prompts read /dev/tty, not piped stdin. No unattended/assume-yes mode.
After approval, repository/dependency scripts execute with your OS authority.
The final command is the selected Node + dist/cli.js setup --guided.
HELP
}
while (($#)); do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --check) check_only=true; shift ;;
    --source-dir)
      (($# >= 2)) || die '--source-dir needs an absolute path.'
      source_override=$2; shift 2 ;;
    *) die "Unknown argument: $1 (see --help)." ;;
  esac
done

confirm() {
  local reply
  # Opening /dev/tty fails on unattended invocations, even when stdin says yes.
  if ! { exec 3<>/dev/tty; } 2>/dev/null; then
    die 'An interactive terminal is required; inspect with --check, then rerun in a terminal.'
  fi
  printf '%s [y/N] ' "$1" >&3
  if ! IFS= read -r reply <&3; then reply=''; fi
  exec 3>&-
  case "$reply" in y|Y|yes|YES) return 0 ;; *) die 'Declined; no further changes will be made.' ;; esac
}
make_tmp() {
  if [[ -z "$tmp" ]]; then
    tmp=$(mktemp -d "${TMPDIR:-/tmp}/bob-bootstrap.XXXXXXXX")
  fi
}
compatible_node() {
  local version minor patch
  [[ -x "$1" ]] || return 1
  version=$("$1" --version 2>/dev/null) || return 1
  [[ "$version" =~ ^v24\.([0-9]+)\.([0-9]+)$ ]] || return 1
  minor=${BASH_REMATCH[1]}; patch=${BASH_REMATCH[2]}
  ((10#$minor > 22 || (10#$minor == 22 && 10#$patch >= 1)))
}
is_checkout() {
  local origin
  [[ -f "$1/package.json" && ( -d "$1/.git" || -f "$1/.git" ) ]] || return 1
  grep -Eq '"name"[[:space:]]*:[[:space:]]*"@bob-local/cli"' "$1/package.json" || return 1
  origin=$(git -C "$1" remote get-url origin 2>/dev/null) || return 1
  case "$origin" in
    "$REPOSITORY"|https://github.com/followdeKlerk/Bob|git@github.com:followdeKlerk/Bob.git) return 0 ;;
    *) return 1 ;;
  esac
}

[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || die 'Supported platform: Linux x86_64 only. No changes made.'
[[ ${HOME:-} == /* ]] || die 'HOME must be an absolute path.'
data_home=${XDG_DATA_HOME:-$HOME/.local/share}
[[ "$data_home" == /* ]] || die 'XDG_DATA_HOME must be an absolute path.'
[[ -z "$source_override" || "$source_override" == /* ]] || die '--source-dir must be an absolute path.'
base="$data_home/bob-bootstrap"
private_node="$base/node-v$NODE_VERSION-linux-x64"
launcher="$HOME/.local/bin/bob"
node=''
path_node=$(type -P node || true)
if [[ -n "$path_node" ]] && compatible_node "$path_node"; then
  # Resolve relative PATH entries now; the launcher must not depend on its cwd.
  node="$(cd -- "$(dirname -- "$path_node")" && pwd -P)/$(basename -- "$path_node")"
elif compatible_node "$private_node/bin/node"; then
  node="$private_node/bin/node"
fi
source_dir=${source_override:-$base/source}
if [[ -z "$source_override" ]] && command -v git >/dev/null 2>&1; then
  script_dir=''
  # BASH_SOURCE is empty when an inspected download is piped into Bash.
  if [[ -n ${BASH_SOURCE[0]:-} ]]; then
    script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
  fi
  cwd_root=$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null || true)
  if [[ -n "$script_dir" ]] && is_checkout "$script_dir"; then source_dir=$script_dir
  elif [[ -n "$cwd_root" ]] && is_checkout "$cwd_root"; then source_dir=$cwd_root
  fi
fi
say 'Bob bootstrap — trust and planned paths'
say "Repository: $REPOSITORY (code and dependencies run with your user permissions)"
say "Source: $source_dir (existing Bob checkout is NEVER pulled, reset or rebuilt if dist/cli.js exists)"
say "Node: ${node:-private download required: $private_node}"
say "Launcher: $launcher (no shell-profile edits)"
say 'No Android SDK, Java, NDK, service installation, or global Node changes.'
missing=()
for tool in git curl tar xz sha256sum; do
  if ! command -v "$tool" >/dev/null 2>&1; then missing+=("$tool"); fi
done
if ((${#missing[@]})); then say "Missing tools: ${missing[*]}"; else say 'Bootstrap tools: present'; fi
if [[ -f "$source_dir/dist/cli.js" ]]; then
  say 'Build: reuse existing dist/cli.js; no dependency install or build.'
else
  say 'Build: npm ci, then npm run build (repository/dependency scripts; separate consent required).'
fi
if [[ -e "$launcher" || -L "$launcher" ]]; then say 'Launcher already exists; only an identical bootstrap launcher can be reused.'; fi
if $check_only; then
  say 'Read-only check complete; no downloads, package installs, directories or files created.'
  exit 0
fi
[[ $(id -u) != 0 ]] || die 'Run as a normal user, not root. Only approved system package plans use sudo.'
# Refuse occupied source paths before any installation. With git missing we cannot
# authenticate an existing checkout: ask for git to be installed manually first.
if [[ -e "$source_dir" || -L "$source_dir" ]]; then
  command -v git >/dev/null 2>&1 || die 'Install git first to verify the existing source directory; it will not be overwritten.'
  is_checkout "$source_dir" || die "Not a verified Bob checkout; refusing to overwrite: $source_dir"
  [[ ! -L "$source_dir" ]] || die 'Refusing a symlink source directory; pass the real checkout path.'
fi
# An occupied launcher is checked early, before any download/install. This marker
# is not sufficient for reuse: exact Node/CLI paths are compared below as well.
if [[ -e "$launcher" || -L "$launcher" ]]; then
  [[ -f "$launcher" && ! -L "$launcher" ]] || die "Refusing existing launcher: $launcher"
  grep -Fxq '# Bob bootstrap launcher v1' "$launcher" || die "Refusing unrelated launcher: $launcher"
  [[ -n "$node" ]] || die "Existing Bob launcher found; refusing to change it: $launcher"
fi
launcher_text() {
  printf '#!/usr/bin/env bash\n# Bob bootstrap launcher v1\nexec %q %q "$@"\n' "$node" "$source_dir/dist/cli.js"
}
if [[ -f "$launcher" && -n "$node" ]]; then
  [[ $(cat -- "$launcher") == "$(launcher_text)" ]] || die "Existing Bob launcher uses other paths; refusing to replace: $launcher"
fi

if ((${#missing[@]})); then
  packages=()
  manager=''
  if command -v apt-get >/dev/null 2>&1; then manager=apt-get
  elif command -v dnf >/dev/null 2>&1; then manager=dnf
  elif command -v pacman >/dev/null 2>&1; then manager=pacman
  fi
  for tool in "${missing[@]}"; do
    package=$tool
    [[ "$tool" != sha256sum ]] || package=coreutils
    if [[ "$tool" == xz && "$manager" == apt-get ]]; then package=xz-utils; fi
    packages+=("$package")
  done
  [[ -n "$manager" ]] || die "No supported package manager. Install these tools yourself and rerun: ${missing[*]} (xz is often xz-utils; sha256sum is in coreutils)."
  command -v sudo >/dev/null 2>&1 || die "sudo is unavailable. Ask your administrator to install: ${packages[*]}; then rerun as your normal user."
  case "$manager" in
    apt-get) say "System package plan: sudo apt-get update; sudo apt-get install -y -- ${packages[*]}" ;;
    dnf) say "System package plan: sudo dnf install -y -- ${packages[*]}" ;;
    pacman) say "System package plan: sudo pacman -S --needed --noconfirm -- ${packages[*]}" ;;
  esac
  confirm 'Approve ONLY this system package plan?'
  case "$manager" in
    apt-get) sudo apt-get update; sudo apt-get install -y -- "${packages[@]}" ;;
    dnf) sudo dnf install -y -- "${packages[@]}" ;;
    pacman) sudo pacman -S --needed --noconfirm -- "${packages[@]}" ;;
  esac
  for tool in "${missing[@]}"; do command -v "$tool" >/dev/null 2>&1 || die "Still missing $tool; install it manually and rerun."; done
fi

if [[ -z "$node" ]]; then
  [[ ! -e "$private_node" && ! -L "$private_node" ]] || die "Private runtime path already exists but is incompatible; will not overwrite: $private_node"
  say "Download plan: $NODE_URL/$NODE_ARCHIVE and SHASUMS256.txt over HTTPS."
  say "Verify SHA256 before extracting; install ONLY to $private_node. Global Node is untouched."
  confirm 'Trust nodejs.org and install this private Node runtime?'
  make_tmp
  curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 --output "$tmp/$NODE_ARCHIVE" "$NODE_URL/$NODE_ARCHIVE" || die 'Node download failed; no runtime installed.'
  curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 --output "$tmp/SHASUMS256.txt" "$NODE_URL/SHASUMS256.txt" || die 'Checksum manifest download failed; no runtime installed.'
  checksum=''
  while read -r hash name extra; do
    if [[ "$name" == "$NODE_ARCHIVE" && -z "${extra:-}" ]]; then
      [[ -z "$checksum" && "$hash" =~ ^[0-9a-f]{64}$ ]] || die 'Invalid or duplicate Node SHA256 manifest entry.'
      checksum=$hash
    fi
  done < "$tmp/SHASUMS256.txt"
  [[ -n "$checksum" ]] || die 'Node archive is missing from the SHA256 manifest.'
  (cd -- "$tmp" && printf '%s  %s\n' "$checksum" "$NODE_ARCHIVE" | sha256sum --check --status) || die 'Node SHA256 verification failed; no archive extracted.'
  mkdir -- "$tmp/runtime"
  tar -xJf "$tmp/$NODE_ARCHIVE" --strip-components=1 -C "$tmp/runtime"
  compatible_node "$tmp/runtime/bin/node" || die 'Downloaded Node cannot run on this host (check Linux/glibc requirements).'
  mkdir -p -- "$base"
  mv -T -n -- "$tmp/runtime" "$private_node"
  [[ ! -d "$tmp/runtime" ]] || die 'Runtime destination appeared during installation; refusing to overwrite.'
  node="$private_node/bin/node"
fi

if [[ ! -e "$source_dir" && ! -L "$source_dir" ]]; then
  say "Clone plan: $REPOSITORY into $source_dir; no existing checkout is updated."
  confirm 'Clone the official Bob repository into this new directory?'
  make_tmp
  git clone -- "$REPOSITORY" "$tmp/source"
  is_checkout "$tmp/source" || die 'Cloned repository did not identify as Bob.'
  mkdir -p -- "$(dirname -- "$source_dir")"
  mv -T -n -- "$tmp/source" "$source_dir"
  [[ ! -d "$tmp/source" ]] || die 'Source destination appeared during cloning; refusing to overwrite.'
fi
is_checkout "$source_dir" || die 'Source is no longer a verified Bob checkout; stopping.'
if [[ ! -f "$source_dir/dist/cli.js" ]]; then
  export PATH="${node%/*}:$PATH"
  npm=$(type -P npm || true)
  [[ -n "$npm" ]] || die 'The selected Node needs npm to build Bob. Install npm for it, or use a complete official Node distribution, then rerun.'
  say "Execution plan in $source_dir: npm ci; npm run build."
  say 'These execute trusted repository and dependency scripts with your full OS account authority.'
  confirm 'Trust this checkout and its dependencies, and execute the build plan?'
  # Dependency scripts must not consume a streamed install.sh from stdin.
  (cd -- "$source_dir" && "$npm" ci && "$npm" run build) </dev/null
  [[ -f "$source_dir/dist/cli.js" ]] || die 'Build did not produce dist/cli.js.'
fi
say "Launcher plan: create $launcher pointing only to $node and $source_dir/dist/cli.js."
say "Final command: selected Node dist/cli.js setup --guided (interactive configuration)."
confirm 'Create/reuse this launcher and enter guided setup?'
# Reused dist may predate this installer. Probe capability without rebuilding it
# or publishing a launcher which cannot run the promised flow.
if ! setup_help=$("$node" "$source_dir/dist/cli.js" setup --help </dev/null 2>/dev/null) || ! grep -Eq -- '(^|[[:space:]])--guided([[:space:]]|$)' <<< "$setup_help"; then
  die 'This compiled CLI does not support setup --guided. No launcher was created or changed. Upgrade this checkout using its existing maintenance procedure, or select a separate fresh checkout with --source-dir; never rebuild live artifacts blindly.'
fi
if [[ -e "$launcher" || -L "$launcher" ]]; then
  [[ -f "$launcher" && ! -L "$launcher" && $(cat -- "$launcher") == "$(launcher_text)" ]] || die "Refusing to replace existing launcher: $launcher"
else
  mkdir -p -- "$(dirname -- "$launcher")"
  # noclobber gives an exclusive create, including if another installer races us.
  (set -o noclobber; launcher_text > "$launcher") || die 'Launcher appeared during installation; refusing to overwrite.'
  chmod 755 -- "$launcher"
fi
say "Launcher ready: $launcher (add $HOME/.local/bin to PATH yourself if needed)."
say 'Entering guided setup. No existing service or state has been changed by this bootstrap.'
# exec does not run EXIT traps: remove temporary downloads before handing off.
cleanup
tmp=''
# A streamed installer has a pipe on stdin; give the interactive CLI the tty.
exec "$node" "$source_dir/dist/cli.js" setup --guided </dev/tty
