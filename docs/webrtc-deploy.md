# Peer-to-peer links in production: coturn on personal-server

The game works without any of this: a pair that can't link plays over the relay, exactly as before. But without a
STUN server most pairs never link (browsers hide their local addresses, and two homes behind NAT need STUN to find
each other), and without TURN the pairs behind strict NATs or firewalls never link either. coturn does both.

Nothing changes in Apache: signaling rides the existing `/sketch-battle/ws` WebSocket.

## 1. Install and configure coturn

```sh
sudo apt-get install coturn
openssl rand -hex 32        # the shared secret: goes in turnserver.conf and in ~/sketch-battle/.env
```

`/etc/turnserver.conf` (replace `<SECRET>`; if the box sits behind 1:1 NAT, which `ip -4 addr` shows as a private
address only, add `external-ip=<public ip>/<private ip>`):

```
listening-port=3478
tls-listening-port=5349
min-port=49152
max-port=49999
fingerprint
use-auth-secret
static-auth-secret=<SECRET>
realm=bschoolland.dev
server-name=bschoolland.dev
cert=/etc/letsencrypt/live/bschoolland.dev/fullchain.pem
pkey=/etc/letsencrypt/live/bschoolland.dev/privkey.pem
no-tlsv1
no-tlsv1_1
no-cli
no-multicast-peers
# 4 players need at most 3 allocations each; cap abuse
user-quota=12
total-quota=400
stale-nonce=600
# never relay into private networks (the server's own LAN, loopback, cloud metadata)
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.0.0.0-192.0.0.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=198.18.0.0-198.19.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff
log-file=/var/log/turnserver/turn.log
simple-log
```

The Let's Encrypt key has to be readable by coturn (it runs as `turnserver`):

```sh
sudo mkdir -p /var/log/turnserver && sudo chown turnserver: /var/log/turnserver
sudo setfacl -R -m u:turnserver:rX /etc/letsencrypt/live /etc/letsencrypt/archive
# reload coturn when the certificate renews
echo -e '#!/bin/sh\nsystemctl restart coturn' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/coturn && sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/coturn
sudo sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
sudo systemctl enable --now coturn
```

Firewall (ufw shown; do the same in the hosting provider's firewall if there is one):

```sh
sudo ufw allow 3478/udp && sudo ufw allow 3478/tcp && sudo ufw allow 5349/tcp && sudo ufw allow 49152:49999/udp
```

## 2. Point the game at it

Append to `~/sketch-battle/.env` on personal-server (deploy.sh sources it before pm2 restarts):

```
RTC_STUN=stun:bschoolland.dev:3478
RTC_TURN=turn:bschoolland.dev:3478?transport=udp,turn:bschoolland.dev:3478?transport=tcp,turns:bschoolland.dev:5349?transport=tcp
RTC_TURN_SECRET=<SECRET>
```

The server logs a warning at start when these are missing. Credentials are minted per connection (coturn's REST
scheme: the username is an expiry 24 h out, the password an HMAC of it under the secret), so nothing else is stored.

## 3. Check it before players do

```sh
# credentials the way the server makes them
node -e 'const c=require("crypto");const u=`${Math.floor(Date.now()/1000)+3600}:check`;console.log(u, c.createHmac("sha1",process.argv[1]).update(u).digest("base64"))' <SECRET>
```

Paste `turn:bschoolland.dev:3478` with that username and password into
https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/ and gather: a `relay` candidate means TURN
works, a `srflx` one that STUN does. Try `turns:bschoolland.dev:5349?transport=tcp` too.

## 4. Ship

1. Deploy from master as usual (`scripts/deploy.sh`): the relay and the classic page get peer-to-peer.
2. The swappable page (shell.html) runs whatever game bundle is current: push one built from master
   (`scripts/push-game.sh --current`) for its players to get it. Rooms mixing an older bundle still play: those
   players' pairs ride the relay, and the relay doesn't decide anyone away in that match (an older bundle wouldn't
   understand it).
3. In the match wide events, `paths` shows per remote player how inputs arrived (`framesViaLink`/`framesViaRelay`),
   the route (`direct`, `turn`, or none) and the selected candidate pair; `rollback.awayFrames` and the relay's
   match event (`relay[].fills`) show how often the relay played someone away. `node netlab/stats.mjs --prod` prints
   both per player.

## What TURN can't fix

- Networks that allow only HTTPS to port 443 (some schools, hotels): TURN on 5349 is blocked too, so those players'
  pairs ride the relay. Serving TURN on 443 would need a second public IP (Apache owns 443) or an ALPN multiplexer in
  front of both; not worth it until telemetry shows such players.
- coturn going down: direct links keep working; links through TURN drop, and those pairs (and any new pair) ride
  the relay until it's back.
