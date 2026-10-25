# Sourced by the scripts that act on one deploy unit (k8s plan 0015). It reads
# k8s/units/<unit>/unit.env, the registry of plan 0014.
#
#   . "$K8S_DIR/units/unit-env.sh"
#   load_unit "$K8S_DIR" velista       # sets UNIT, NAMESPACE, RELEASE_NAME, ...
#   unit_field "$K8S_DIR" velista NAMESPACE   # prints one field, sets nothing
#
# The file is read with its carriage returns removed, so a Windows checkout
# sources the same values a Linux host does.

# Sets every field of the unit's unit.env, and CHART_PATH, the chart directory
# resolved against the parent of the k8s directory (on a host, ~/k8s/.. is ~).
load_unit() {
  local k8s_dir="$1" unit="$2" file
  case "$unit" in
    '' | *[!a-z0-9-]*)
      echo "'$unit' is not a unit name. The units are the directories of $k8s_dir/units." >&2
      return 1
      ;;
  esac
  file="$k8s_dir/units/$unit/unit.env"
  if [ ! -f "$file" ]; then
    echo "There is no unit '$unit': $file does not exist." >&2
    return 1
  fi
  UNIT='' NAMESPACE='' RELEASE_NAME='' CHART='' TAG_PREFIX='' GATES='' SECRETS=''
  RELEASE_TASKS='' HOSTS_STAGING='' HOSTS_PRODUCTION=''
  # shellcheck disable=SC1090
  . <(tr -d '\r' < "$file")
  if [ "$UNIT" != "$unit" ] || [ -z "$NAMESPACE" ] || [ -z "$RELEASE_NAME" ] || [ -z "$CHART" ]; then
    echo "$file must state UNIT=$unit, NAMESPACE, RELEASE_NAME and CHART." >&2
    return 1
  fi
  CHART_PATH="$(dirname "$k8s_dir")/$CHART"
}

# Prints one field of a unit's unit.env, in a subshell so the caller keeps its
# own variables.
unit_field() {
  (
    load_unit "$1" "$2" > /dev/null || exit 1
    printf '%s' "${!3}"
  )
}

# Every unit name, one per line.
unit_names() {
  local dir
  for dir in "$1"/units/*/; do
    if [ -f "$dir/unit.env" ]; then basename "$dir"; fi
  done
}
