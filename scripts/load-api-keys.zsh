# Loads data-source API keys for the Open OSINT data service from a KEY=value file (work/api-keys.env).
# Sourced by Start Public Desk.command inside the data service's subshell, so no other service sees the keys.
# The file is read line by line, never sourced, so nothing in it can run as a command. Only the names below are
# exported; AI and hosting keys (Groq, OpenRouter, Upstash...) are left out on purpose, since they spend credits.
# Key names are printed; values never are.

PUBLIC_DESK_API_KEY_NAMES=(
  AISSTREAM_API_KEY OTX_API_KEY ABUSEIPDB_API_KEY INTELX_API_KEY
  URLHAUS_AUTH_KEY NASA_FIRMS_API_KEY FRED_API_KEY EIA_API_KEY FINNHUB_API_KEY FMP_API_KEY
  ACLED_ACCESS_TOKEN ACLED_EMAIL GREYNOISE_API_KEY FAA_NOTAM_API_KEY OPENCORPORATES_API_KEY
)

load_api_keys() {
  emulate -L zsh
  local file="$1" line name value
  local -a loaded
  [[ -f "$file" ]] || return 0
  chmod 600 "$file" 2>/dev/null
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ '^[[:space:]]*(#.*)?$' ]] && continue
    if [[ ! "$line" =~ '^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=(.*)$' ]]; then
      print -r -- "Ignoring a line in ${file:t} that is not NAME=value."
      continue
    fi
    name="$match[1]"
    value="${${match[2]##[[:space:]]#}%%[[:space:]]#}"
    if [[ "$value" == \"*\" || "$value" == \'*\' ]]; then
      value="${value[2,-2]}"
    fi
    if (( ! ${PUBLIC_DESK_API_KEY_NAMES[(Ie)$name]} )); then
      print -r -- "Ignoring $name: not a data-source key Public Desk passes on."
      continue
    fi
    [[ -n "$value" ]] || continue
    export "$name=$value"
    loaded+=("$name")
  done < "$file"
  (( ${#loaded} )) && print -r -- "API keys for Open OSINT: ${(j:, :)loaded}"
  return 0
}
