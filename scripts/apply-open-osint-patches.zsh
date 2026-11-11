# Applies Public Desk's fixes for the bundled Open OSINT checkout (patches/*.patch) before its data service starts.
# Sourced by Start Public Desk.command. Each patch is applied once: an already-applied patch is skipped silently, and
# one that no longer fits (Open OSINT's code changed) is reported and skipped, so startup always continues.
# Patches are kept in this repo so they are reviewed and survive Open OSINT updates.

apply_open_osint_patches() {
  emulate -L zsh
  setopt null_glob
  local root="$1" patch_dir="$2" patch name
  [[ -d "$root" ]] || return 0
  for patch in "$patch_dir"/*.patch; do
    name="${patch:t:r}"
    # Stop git from looking above the checkout for another repository.
    if GIT_CEILING_DIRECTORIES="${root:h}" git -C "$root" apply --reverse --check "$patch" >/dev/null 2>&1; then
      continue
    fi
    if GIT_CEILING_DIRECTORIES="${root:h}" git -C "$root" apply --check "$patch" >/dev/null 2>&1 \
      && GIT_CEILING_DIRECTORIES="${root:h}" git -C "$root" apply "$patch" >/dev/null 2>&1; then
      print -r -- "Applied $name to Open OSINT."
    else
      print -r -- "Could not apply $name: Open OSINT's code has changed. Ask your coding assistant to update the patch."
    fi
  done
  return 0
}
