const API = `${import.meta.env.BASE_URL}api`;
export function logClient(event: string, data: Record<string, unknown> = {}): void {
  try {
    fetch(`${API}/log`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event, build: __BUILD__, ...data }), keepalive: true }).catch(() => {});
  } catch { /* offline */ }
}
window.addEventListener("error", (e) => logClient("error", { message: e.message, source: e.filename, line: e.lineno }));
window.addEventListener("unhandledrejection", (e) => logClient("error", { message: String(e.reason) }));
