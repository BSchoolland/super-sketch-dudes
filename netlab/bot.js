// Injected into each player's page once the match screen is up (page.evaluate(source)(options)): a seeded,
// human-paced keyboard-and-mouse bot that chases the nearest opponent and fights, and a probe that samples what the
// player sees every 100 ms (WAITING, who it waits on, round trip, frame) for the run's timeline.
(({ seed, slot }) => {
  let a = seed >>> 0;
  const random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const held = new Set();
  const key = (code, down) => {
    if (down === held.has(code)) return;
    if (down) held.add(code); else held.delete(code);
    if (code === "Mouse0") window.dispatchEvent(new PointerEvent(down ? "pointerdown" : "pointerup", { pointerType: "mouse", button: 0 }));
    else window.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", { code, key: code }));
  };
  const tap = (code, ms) => { key(code, true); setTimeout(() => key(code, false), ms); };
  const screen = () => window.sketchbattle.screen;

  const samples = [];
  const t0 = performance.now();
  const probe = setInterval(() => {
    const s = screen();
    if (!s?.session) return;
    const session = s.session;
    const waitingOn = session.waiting ? session.waitingOn().map((i) => s.renderer?.names?.[i] ?? `P${i + 1}`) : [];
    samples.push([Math.round(performance.now() - t0), session.state.frame, session.waiting ? 1 : 0, Math.round(s.opts.transport.rtt()), waitingOn.join("+")]);
  }, 100);

  // decide every 120-450 ms, about how often a player changes what they're pressing
  let next = 0;
  const brain = setInterval(() => {
    const s = screen();
    if (!s?.session) return;
    const now = performance.now();
    if (now < next) return;
    next = now + 120 + random() * 330;
    const st = s.session.state, me = st.fighters[slot];
    if (!me) return;
    const foes = st.fighters.filter((f, i) => i !== slot && f.stocks > 0);
    const foe = foes.sort((p, q) => Math.abs(p.x - me.x) - Math.abs(q.x - me.x))[0];
    const dx = foe ? foe.x - me.x : -me.x;
    const near = Math.abs(dx) < 140;
    // drift back toward the stage when far out
    const toward = Math.abs(me.x) > 700 ? (me.x > 0 ? "KeyA" : "KeyD") : dx > 0 ? "KeyD" : "KeyA";
    const away = toward === "KeyD" ? "KeyA" : "KeyD";
    key(away, false);
    key(toward, !near || random() < 0.3);
    const r = random();
    // y grows downward: below the stage's top and airborne means recover (jump, then up special)
    if (!me.grounded && me.y > 40) { tap("Space", 60); if (random() < 0.4) { tap("KeyW", 200); tap("KeyE", 60); } }
    if (near && r < 0.45) tap("Mouse0", 50 + random() * 60);
    else if (near && r < 0.6) tap("KeyE", 60);
    else if (near && r < 0.68) tap("ShiftLeft", 150 + random() * 300);
    else if (r < 0.75) tap("Space", 60);
    else if (r < 0.8) tap(random() < 0.5 ? "KeyW" : "KeyS", 120);
    else if (!near && r < 0.85) tap("KeyE", 60);
  }, 20);

  window.__netlab = {
    samples,
    stop() { clearInterval(probe); clearInterval(brain); for (const code of [...held]) key(code, false); },
  };
});
