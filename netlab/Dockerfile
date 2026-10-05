# One image for the relay and every player: Node, Playwright's Chromium, and tc for netem.
FROM mcr.microsoft.com/playwright:v1.63.0-noble
RUN apt-get update && apt-get install -y --no-install-recommends iproute2 && rm -rf /var/lib/apt/lists/*
