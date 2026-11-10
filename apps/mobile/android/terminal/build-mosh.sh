#!/usr/bin/env bash
# Build a separate GPLv3+ mosh-client executable, not a JNI-linked copy of Mosh.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ANDROID=$(cd "$HERE/.." && pwd)
SDK=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/.local/android-sdk}}
NDK="$SDK/ndk/27.1.12297006"
TOOL="$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin"
CMAKE="$SDK/cmake/3.22.1/bin/cmake"
WORK=${BOB_TERMINAL_BUILD_DIR:-$HOME/.cache/bob-terminal-native}
JOBS=${BOB_TERMINAL_JOBS:-4}
mkdir -p "$WORK"; cd "$WORK"
fetch() {
  local name=$1 sha=$2 url=$3
  if ! echo "$sha  $name.tar.gz" | sha256sum --check --status 2>/dev/null; then
    if echo "$sha  $HERE/$name.tar.gz" | sha256sum --check --status 2>/dev/null; then
      if [ "$(realpath "$HERE/$name.tar.gz")" != "$(realpath -m "$name.tar.gz")" ]; then cp "$HERE/$name.tar.gz" "$name.tar.gz"; fi
    elif [ "${BOB_TERMINAL_OFFLINE:-0}" = 1 ]; then
      echo "Missing or invalid pinned source archive: $name (offline build)" >&2; exit 1
    else
      curl --fail --location --retry 2 --max-time 180 "$url" -o "$name.tar.gz"
    fi
    echo "$sha  $name.tar.gz" | sha256sum --check
  fi
}
fetch mosh 872e4b134e5df29c8933dff12350785054d2fd2839b5ae6b5587b14db1465ddd https://github.com/mobile-shell/mosh/releases/download/mosh-1.4.0/mosh-1.4.0.tar.gz
fetch protobuf 2c6a36c7b5a55accae063667ef3c55f2642e67476d96d355ff0acb13dbb47f09 https://github.com/protocolbuffers/protobuf/releases/download/v21.12/protobuf-all-21.12.tar.gz
fetch openssl d80c34f5cf902dccf1f1b5df5ebb86d0392e37049e5d73df1b3abae72e4ffe8b https://github.com/openssl/openssl/releases/download/openssl-3.0.18/openssl-3.0.18.tar.gz
fetch ncurses 136d91bc269a9a5785e5f9e980bc76ab57428f604ce3e5a5a90cebc767971cc6 https://invisible-mirror.net/archives/ncurses/ncurses-6.5.tar.gz
for pair in 'mosh mosh-1.4.0' 'protobuf protobuf-21.12' 'openssl openssl-3.0.18' 'ncurses ncurses-6.5'; do
  read -r archive directory <<< "$pair"
  test -d "$directory" || tar xf "$archive.tar.gz"
done
PREFIX="$WORK/prefix"
mkdir -p "$PREFIX"
export PATH="$TOOL:$PATH"
export ANDROID_NDK_ROOT="$NDK"
if ! test -x "$WORK/protobuf-host/protoc"; then
  "$CMAKE" -S protobuf-21.12/cmake -B protobuf-host -Dprotobuf_BUILD_TESTS=OFF -Dprotobuf_BUILD_SHARED_LIBS=OFF -DCMAKE_BUILD_TYPE=Release
  "$CMAKE" --build protobuf-host --target protoc -j"$JOBS"
fi
export CC=aarch64-linux-android26-clang CXX=aarch64-linux-android26-clang++ AR=llvm-ar RANLIB=llvm-ranlib
export CFLAGS='-O2 -fPIC' CXXFLAGS='-O2 -fPIC' LDFLAGS='-Wl,-z,max-page-size=16384'
if ! test -f "$PREFIX/lib/libprotobuf.a"; then
  "$CMAKE" -S protobuf-21.12/cmake -B protobuf-android \
    -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" \
    -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-26 -DANDROID_STL=c++_static \
    -Dprotobuf_BUILD_TESTS=OFF -Dprotobuf_BUILD_PROTOC_BINARIES=OFF \
    -Dprotobuf_BUILD_SHARED_LIBS=OFF -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX"
  "$CMAKE" --build protobuf-android -j"$JOBS"
  "$CMAKE" --install protobuf-android
fi
if ! test -f "$PREFIX/lib/libcrypto.a"; then
  (cd openssl-3.0.18; ./Configure android-arm64 no-shared no-tests no-module --prefix="$PREFIX" --libdir=lib -D__ANDROID_API__=26; make -j"$JOBS" build_sw; make install_dev)
fi
if ! test -f "$PREFIX/lib/libncursesw.a"; then
  mkdir -p ncurses-android
  (cd ncurses-android; ../ncurses-6.5/configure --host=aarch64-linux-android --prefix="$PREFIX" \
    --without-shared --without-cxx --without-cxx-binding --without-ada --without-tests --without-manpages \
    --without-progs --without-debug --disable-stripping --enable-termcap --enable-getcap \
    --with-default-terminfo-dir=/nonexistent --with-terminfo-dirs=/nonexistent \
    --with-fallbacks=xterm-256color,xterm; make -j"$JOBS"; make install.libs)
fi
export PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig"
export PKG_CONFIG_PATH="$PKG_CONFIG_LIBDIR"
export CPPFLAGS="-I$PREFIX/include -I$PREFIX/include/ncursesw"
export LDFLAGS="-L$PREFIX/lib -static-libstdc++ -Wl,-z,max-page-size=16384"
export TINFO_CFLAGS="-I$PREFIX/include/ncursesw" TINFO_LIBS="$PREFIX/lib/libncursesw.a"
export PROTOC="$WORK/protobuf-host/protoc"
# Android protobuf's default diagnostic sink uses liblog.
export LIBS='-llog -lz -ldl'
(cd mosh-1.4.0; ./configure --host=aarch64-linux-android --disable-server --without-utempter \
  --enable-static-protobuf --enable-static-crypto --enable-static-curses --with-crypto-library=openssl \
  --disable-dependency-tracking; make -j"$JOBS")
OUT=${BOB_TERMINAL_OUTPUT_DIR:-$ANDROID/app/build/generated/terminal}
mkdir -p "$OUT/jniLibs/arm64-v8a" "$OUT/assets/terminal/legal"
cp mosh-1.4.0/src/frontend/mosh-client "$OUT/jniLibs/arm64-v8a/libbob_mosh.so"
llvm-strip --strip-unneeded "$OUT/jniLibs/arm64-v8a/libbob_mosh.so"
"$CC" -shared -fPIC -O2 -Wall -Wextra -Werror -Wl,-z,max-page-size=16384 \
  "$HERE/terminal-pty.c" -o "$OUT/jniLibs/arm64-v8a/libbob_terminal_pty.so"
# Distribute complete corresponding sources alongside this executable, not just URLs.
for file in build-mosh.sh terminal-pty.c terminal-pty-test.c vendor-manifest.json README.md; do
  if [ "$(realpath "$HERE/$file")" != "$(realpath -m "$WORK/$file")" ]; then cp "$HERE/$file" "$WORK/$file"; fi
done
tar --sort=name --mtime='UTC 2026-01-01' --owner=0 --group=0 --numeric-owner -cf "$OUT/assets/terminal/legal/mosh-corresponding-source.tar" \
  mosh.tar.gz protobuf.tar.gz openssl.tar.gz ncurses.tar.gz build-mosh.sh terminal-pty.c terminal-pty-test.c vendor-manifest.json README.md
cp "$HERE/vendor-manifest.json" "$OUT/assets/terminal/legal/vendor-manifest.json"
cp "$HERE/README.md" "$OUT/assets/terminal/legal/README.md"
cp mosh-1.4.0/COPYING "$OUT/assets/terminal/legal/MOSH-COPYING"
cp protobuf-21.12/LICENSE "$OUT/assets/terminal/legal/PROTOBUF-LICENSE"
cp openssl-3.0.18/LICENSE.txt "$OUT/assets/terminal/legal/OPENSSL-LICENSE"
cp ncurses-6.5/COPYING "$OUT/assets/terminal/legal/NCURSES-COPYING"
llvm-readelf -h -l -d "$OUT/jniLibs/arm64-v8a/libbob_mosh.so"
echo "Built separate arm64 Mosh executable and corresponding sources in $OUT"
