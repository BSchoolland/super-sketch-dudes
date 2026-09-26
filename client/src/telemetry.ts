import { site } from "./base";
export function logClient(event: string, data: Record<string, unknown> = {}): void {
  try {
    fetch(`${site.base}api/log`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event, build: site.build, ...data }), keepalive: true }).catch(() => {});
  } catch { /* offline */ }
}
window.addEventListener("error", (e) => logClient("error", { message: e.message, source: e.filename, line: e.lineno }));
window.addEventListener("unhandledrejection", (e) => logClient("error", { message: String(e.reason) }));
