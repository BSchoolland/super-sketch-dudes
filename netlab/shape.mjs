// netem on one player container: egress on the game interface is the player's uplink, ingress (redirected through
// ifb0) its downlink. A long-lived `sh` per container takes tc commands on stdin, so episode timing stays tight.
import { spawn } from "node:child_process";

/** netem arguments for a base profile with the worst episode in force applied on top. */
export function netemArgs(base, active) {
  const blackout = active.some((e) => e.type === "blackout");
  const add = Math.max(0, ...active.filter((e) => e.type === "spike").map((e) => e.addMs));
  const delay = base.delayMs + add;
  const parts = [`delay ${delay}ms`];
  if (base.jitterMs) parts.push(`${base.jitterMs}ms 25% distribution paretonormal`);
  if (blackout) parts.push("loss random 100%");
  else if (base.lossPct) parts.push(`loss gemodel ${base.lossPct}% ${base.burstPct ?? 100}%`);
  else parts.push("loss random 0%");
  return parts.join(" ");
}

export class Shaper {
  /** @param {string} container @param {string} iface the game-network interface inside it */
  constructor(container, iface) {
    this.container = container;
    this.iface = iface;
    this.sh = spawn("docker", ["exec", "-i", container, "sh", "-e"], { stdio: ["pipe", "inherit", "pipe"] });
    this.errors = [];
    this.sh.stderr.on("data", (d) => this.errors.push(String(d).trim()));
    this.sh.on("exit", (code) => { if (code && !this.closing) this.errors.push(`tc shell in ${container} exited ${code}`); });
  }

  run(cmd) {
    if (this.errors.length) throw new Error(`shaping ${this.container}: ${this.errors.join("; ")}`);
    this.sh.stdin.write(cmd + "\n");
  }

  /** Root netem with a pfifo child on both directions: jitter then delays packets in order, like a real link, instead of reordering them. */
  setup(up, down) {
    const i = this.iface;
    this.run(`tc qdisc replace dev ${i} root handle 1: netem ${up}`);
    this.run(`tc qdisc replace dev ${i} parent 1:1 handle 10: pfifo limit 10000`);
    this.run("ip link add ifb0 type ifb 2>/dev/null || true; ip link set ifb0 up");
    this.run(`tc qdisc replace dev ${i} handle ffff: ingress`);
    this.run(`tc filter replace dev ${i} parent ffff: protocol all prio 1 matchall action mirred egress redirect dev ifb0`);
    this.run(`tc qdisc replace dev ifb0 root handle 1: netem ${down}`);
    this.run("tc qdisc replace dev ifb0 parent 1:1 handle 10: pfifo limit 10000");
  }

  set(direction, args) {
    this.run(`tc qdisc change dev ${direction === "up" ? this.iface : "ifb0"} root handle 1: netem ${args}`);
  }

  async close() {
    this.closing = true;
    this.sh.stdin.end();
    await new Promise((r) => this.sh.once("exit", r));
    if (this.errors.length) throw new Error(`shaping ${this.container}: ${this.errors.join("; ")}`);
  }
}
