#!/bin/bash
#
# Puts Fingerly.xcframework in <pod root>/Frameworks. Run by the podspec or
# directly when staging local artifacts.
#
#   fetch-fingerly-xcframework.sh [version] [sha256] [pod root] [url]
#
# When FINGERLY_XCFRAMEWORK_PATH is set (pointing either to an unpacked
# .xcframework directory or a .xcframework.zip archive), copies or extracts it
# directly into <pod root>/Frameworks without any network request.
#
# The release writes the checksum of the published zip into fingerly-binary.json
# before packing, so a package from npm only ever installs the exact binary it
# was released against.
#
# Stdout stays silent because `pod ipc spec` prints its JSON there.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
binary_json="$script_dir/fingerly-binary.json"

json_field() {
  if [ -f "$2" ]; then
    sed -n 's/^[[:space:]]*"'"$1"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$2" | head -n 1
  fi
}

version="${1:-$(json_field version "$binary_json")}"
sha256="${2-$(json_field sha256 "$binary_json")}"
pod_root="${3:-$script_dir}"
url="${4:-$(json_field url "$binary_json")}"

if [ -z "$version" ]; then
  echo "error: missing Fingerly XCFramework version" >&2
  exit 1
fi

if [ -z "$url" ]; then
  url="https://maven.fingerly.io/ios/Fingerly-$version.xcframework.zip"
fi

dest="$pod_root/Frameworks"
stamp="$dest/.fingerly-binary"
wanted="$version $sha256"

work="$(mktemp -d "${TMPDIR:-/tmp}/fingerly-xcframework.XXXXXX")"
trap 'rm -rf "$work"' EXIT

if [ -n "${FINGERLY_XCFRAMEWORK_PATH:-}" ]; then
  if [ -d "$FINGERLY_XCFRAMEWORK_PATH" ]; then
    if [ ! -f "$FINGERLY_XCFRAMEWORK_PATH/Info.plist" ]; then
      echo "error: $FINGERLY_XCFRAMEWORK_PATH is not a valid XCFramework (missing Info.plist)" >&2
      exit 1
    fi
    mkdir -p "$work/expanded"
    cp -R "$FINGERLY_XCFRAMEWORK_PATH" "$work/expanded/Fingerly.xcframework"
  elif [ -f "$FINGERLY_XCFRAMEWORK_PATH" ]; then
    unzip -q "$FINGERLY_XCFRAMEWORK_PATH" -d "$work/expanded"
    if [ ! -d "$work/expanded/Fingerly.xcframework" ]; then
      echo "error: $FINGERLY_XCFRAMEWORK_PATH does not contain Fingerly.xcframework" >&2
      exit 1
    fi
  else
    echo "error: FINGERLY_XCFRAMEWORK_PATH does not exist: $FINGERLY_XCFRAMEWORK_PATH" >&2
    exit 1
  fi

  rm -rf "$dest"
  mkdir -p "$dest"
  mv "$work/expanded/Fingerly.xcframework" "$dest/"
  printf '%s' "$wanted" > "$stamp"
  exit 0
fi

if [ -d "$dest/Fingerly.xcframework" ] && [ "$(cat "$stamp" 2>/dev/null)" = "$wanted" ]; then
  exit 0
fi

if ! curl --fail --silent --show-error --location --proto '=https' --retry 3 --output "$work/sdk.zip" "$url"; then
  echo "error: could not download $url" >&2
  exit 1
fi

if [ -n "$sha256" ]; then
  actual="$(shasum -a 256 "$work/sdk.zip" | cut -d' ' -f1)"
  if [ "$actual" != "$sha256" ]; then
    echo "error: $url has checksum $actual, expected $sha256" >&2
    exit 1
  fi
else
  echo "warning: no checksum recorded, $url was not verified (expected only in a git checkout)" >&2
fi

unzip -q "$work/sdk.zip" -d "$work/expanded"
if [ ! -d "$work/expanded/Fingerly.xcframework" ]; then
  echo "error: $url does not contain Fingerly.xcframework" >&2
  exit 1
fi

rm -rf "$dest"
mkdir -p "$dest"
mv "$work/expanded/Fingerly.xcframework" "$dest/"
printf '%s' "$wanted" > "$stamp"
