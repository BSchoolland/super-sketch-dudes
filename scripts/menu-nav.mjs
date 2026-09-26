// Keyboard walks through the signed-in menus, shared by the online scripts. Works on dev and built
// bundles alike (it looks at screen fields, not class names).
const press = async (page, key, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(key); await page.waitForTimeout(120); } };

/** Opens `url` signed in as `name` (the server needs DEV_LOGIN=1) and waits for the title. */
export async function signIn(page, url, name) {
  await page.goto(`${url}${url.includes("?") ? "&" : "?"}dev=${encodeURIComponent(name)}`);
  await page.waitForFunction(() => Array.isArray(window.sketchbattle?.screen?.items), null, { timeout: 15000 });
}

/** Title -> BATTLE -> the first fighter offered -> ONLINE: the quick match / create / join menu. */
export async function openOnline(page, url, name) {
  await signIn(page, url, name);
  await press(page, "ArrowDown", 3);
  await press(page, "Enter");
  await page.waitForFunction(() => !!window.sketchbattle.screen.grid, null, { timeout: 15000 });
  await press(page, "Enter");
  await page.waitForFunction(() => "device" in window.sketchbattle.screen && "fighter" in window.sketchbattle.screen);
  await press(page, "ArrowDown", 2);
  await press(page, "Enter");
  await page.waitForFunction(() => "roomCode" in window.sketchbattle.screen);
  await page.waitForTimeout(200);
}
