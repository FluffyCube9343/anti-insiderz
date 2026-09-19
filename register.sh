#!/usr/bin/env bash
# Registers trader subdomains as ANS agents end-to-end: CSR, register,
# ACME TXT via Porkbun API, verify-acme, _ans/_ans-badge TXT, verify-dns.
# One-time manual step: Porkbun Account -> API keypair, then domain Details -> enable API Access.


##
# NOTE: YOU WILL NEED TO HAVE
#
#export ANS_API_KEY='XXXX:XXXXXXXX'
#export ANS_BASE_URL='https://api.ote-godaddy.com'
#unset ANS_OAUTH_TOKEN
#export AGENT_HOST='not-an-insider-just-lucky.biz'
#export AGENT_ID='bb21de26-38d3-46af-bf7f-83fed3df5abc'
#export PB_API_KEY='XXXXXXX'
#export PB_SECRET='XXXXXXXX'
#export DOMAIN='not-an-insider-just-lucky.biz'

set -uo pipefail


pb() { # pb <path> <json-body> -> Porkbun API call, prints response
  curl -sS -X POST "https://api.porkbun.com/api/json/v3/$1" \
    -H 'Content-Type: application/json' -d "$2"
}

register_agent() {
  local sub="$1" display="$2"
  local host="$sub.$DOMAIN"
  local dir="agents/$sub"
  mkdir -p "$dir/certs"

  echo "== $host: generating CSRs"
  ans-cli generate-csr --host "$host" --org 'not-an-insider-just-lucky' --version 1.0.0 --out-dir "$dir/certs" || return 1

  echo "== $host: registering"
  ans-cli register -j --name "$display" --host "$host" --version '1.0.0' \
    --description 'Verifiable hackathon trader agent' \
    --identity-csr "$dir/certs/identity.csr" --server-csr "$dir/certs/server.csr" \
    --endpoint-url "https://$host/mcp" --metadata-url "https://$host/.well-known/agent-card.json" \
    --endpoint-protocol MCP --endpoint-transports STREAMABLE-HTTP \
    --function 'main:Trader agent:hackathon' | tee "$dir/registration.json" || return 1

  local agent_id token
  agent_id=$(jq -r '.links[] | select(.rel=="self") | .href | split("/")[-1]' "$dir/registration.json")
  token=$(jq -r '.challenges[] | select(.type=="DNS_01") | .token' "$dir/registration.json")
  echo "$agent_id" > "$dir/agent_id"
  echo "== $host: agent id $agent_id"

  echo "== $host: creating _acme-challenge TXT"
  pb "dns/create/$DOMAIN" "{\"apikey\":\"$PB_API_KEY\",\"secretapikey\":\"$PB_SECRET\",\"name\":\"_acme-challenge.$sub\",\"type\":\"TXT\",\"content\":\"$token\",\"ttl\":600}"
  echo

  echo "== $host: waiting for ACME TXT propagation"
  until dig +short TXT "_acme-challenge.$host" @1.1.1.1 | grep -qF "$token"; do sleep 5; done

  echo "== $host: verify-acme"
  ans-cli verify-acme "$agent_id" -j || return 1

  echo "== $host: creating _ans + _ans-badge TXT"
  pb "dns/create/$DOMAIN" "{\"apikey\":\"$PB_API_KEY\",\"secretapikey\":\"$PB_SECRET\",\"name\":\"_ans.$sub\",\"type\":\"TXT\",\"content\":\"v=ans1; version=v1.0.0; p=mcp; mode=direct; url=https://$host/mcp\",\"ttl\":3600}"
  echo
  pb "dns/create/$DOMAIN" "{\"apikey\":\"$PB_API_KEY\",\"secretapikey\":\"$PB_SECRET\",\"name\":\"_ans-badge.$sub\",\"type\":\"TXT\",\"content\":\"v=ans-badge1; version=v1.0.0; url=https://transparency.ans.ote-godaddy.com/v1/agents/$agent_id\",\"ttl\":3600}"
  echo

  echo "== $host: waiting for badge TXT propagation"
  until dig +short TXT "_ans-badge.$host" @1.1.1.1 | grep -qF 'ans-badge1'; do sleep 5; done

  echo "== $host: verify-dns (retrying through registry negative-cache)"
  local i
  for i in 1 2 3 4 5 6; do
    ans-cli verify-dns "$agent_id" -j | tee "$dir/verify.json"
    if jq -e '.status=="ACTIVE"' "$dir/verify.json" >/dev/null 2>&1; then
      echo "== $host: ACTIVE"
      return 0
    fi
    echo "== $host: not yet, sleeping 30s (attempt $i)"
    sleep 30
  done
  echo "== $host: FAILED to go ACTIVE"
  return 1
}

register_agent trader1 'Trader One'
register_agent trader2 'Trader Two'
register_agent trader3 'Trader Three'
register_agent trader4 'Trader Four'
