/** Fight buttons for Playwright scripts: keyboard codes, or Mouse0 / Mouse2 (attack / special on keyboard 1). */
const mouseButton = (code) => (code === "Mouse2" ? "right" : code === "Mouse1" ? "middle" : "left");
export async function down(page, code) { if (code.startsWith("Mouse")) await page.mouse.down({ button: mouseButton(code) }); else await page.keyboard.down(code); }
export async function up(page, code) { if (code.startsWith("Mouse")) await page.mouse.up({ button: mouseButton(code) }); else await page.keyboard.up(code); }
export async function press(page, code, ms = 60) { await down(page, code); await page.waitForTimeout(ms); await up(page, code); }
