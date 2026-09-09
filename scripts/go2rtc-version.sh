#!/usr/bin/env bash
# Pinned go2rtc release used by the Camera widget. Sourced by install.sh (Pi)
# and referenced by the Dockerfile and BUILD.md (Windows). Bumping go2rtc is a
# deliberate, reviewed change: update GO2RTC_VERSION and every sha256 below
# (from the checksums a plain `sha256sum <asset>` gives, against the assets at
# https://github.com/AlexxIT/go2rtc/releases/tag/<version>).

GO2RTC_VERSION="v1.9.14"
GO2RTC_BASE_URL="https://github.com/AlexxIT/go2rtc/releases/download/${GO2RTC_VERSION}"

# asset name  ->  sha256
#   linux_amd64 / arm64 / arm(v7) / armv6 / i386 are raw binaries.
#   win64 / win_arm64 / win32 are .zip files containing go2rtc.exe.
declare -A GO2RTC_SHA256=(
  [go2rtc_linux_amd64]="32d616af226bd731678ffde328b94cfb94e30339bfefc469cfb76323144615a6"
  [go2rtc_linux_arm64]="359fabade8a7a51e81a55fe6df6b0ef81764a5e1d63179577534eaaa71904b50"
  [go2rtc_linux_arm]="4d7e1639af5a2722a28e864468fd8099b3c1682565446c798bf9e3b38fde12e4"
  [go2rtc_linux_armv6]="4dc20370556b29f3a90f4c7a09dcd95472c8f74cca56d4d1fb91f32bdd15174c"
  [go2rtc_linux_i386]="12a114d19fc9fba1b3541cf7c6bb9b01896a6845f31285ec77269e2e7c613885"
  [go2rtc_win64.zip]="dd4167d75cb04abe618855b7c71f8658bd009f60c1a71835d134d2c11c939907"
  [go2rtc_win_arm64.zip]="814be0f6d8669025c7bccdd1f026ffaf613abae5352239f4ec84de543b94594a"
  [go2rtc_win32.zip]="6fafb817477f4d34e5edfd8bb3c547151dfc5c404bde41e274db146b17ed5c03"
  [go2rtc_mac_amd64.zip]="9b0b9a27a4dc3a5b8b93376e7e8fc2787c6af624a512842622be84aec0171c7a"
  [go2rtc_mac_arm64.zip]="919b78adc759d6b3883d1e1b2ac915ac0985bb903ff1897b4d228527bd64690c"
)

# Map `uname -m` to the linux asset name.
go2rtc_linux_asset_for_arch() {
  case "$1" in
    x86_64|amd64)        echo "go2rtc_linux_amd64" ;;
    aarch64|arm64)       echo "go2rtc_linux_arm64" ;;
    armv7l|armv7|armhf)  echo "go2rtc_linux_arm" ;;
    armv6l|armv6)        echo "go2rtc_linux_armv6" ;;
    i386|i686)           echo "go2rtc_linux_i386" ;;
    *)                   echo "" ;;
  esac
}
