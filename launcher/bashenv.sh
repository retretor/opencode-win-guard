# Loaded by every sandboxed bash. `mkdir -p /absolute/path` asks for write access to each parent folder,
# which Windows refuses outside the sandbox folder; a relative path does not.
mkdir() {
  local a=() x
  for x in "$@"; do
    case "$x" in
      /* | [A-Za-z]:[\\/]*) x=$(realpath -ms --relative-to=. -- "$x") ;;
    esac
    a+=("$x")
  done
  command mkdir "${a[@]}"
}
export -f mkdir
