# One image for the relay, the TURN server and every player: Node, Playwright's Chromium, tc for netem, iptables to
# block a player's peer-to-peer routes, and coturn for STUN and TURN.
FROM mcr.microsoft.com/playwright:v1.63.0-noble
RUN apt-get update && apt-get install -y --no-install-recommends iproute2 iptables coturn && rm -rf /var/lib/apt/lists/*
