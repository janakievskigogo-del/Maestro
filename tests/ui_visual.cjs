const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const python = process.env.PYTHON || "python";
const project = path.resolve(__dirname, "..");
const database = path.join(__dirname, "restaurant-visual.sqlite3");
const outDir = path.join(__dirname, "screenshots");
function waitForServer(processRef) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Server did not start. Output: ${output}`)), 10000);
    processRef.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(/running at (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
    processRef.once("error", (error) => { clearTimeout(timeout); reject(error); });
    processRef.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Server exited with code ${code}. Output: ${output}`)); });
  });
}

async function login(page, username) {
  await page.getByLabel("Корисничко име").fill(username);
  await page.getByLabel("Лозинка").fill("demo123");
  await page.getByRole("button", { name: "Најави се" }).click();
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const serverBootstrap = [
    "import sys, runpy",
    `sys.path.insert(0, ${JSON.stringify(project)})`,
    `runpy.run_path(${JSON.stringify(path.join(project, "server.py"))}, run_name="__main__")`,
  ].join("; ");
  const server = spawn(python, ["-c", serverBootstrap], {
    cwd: project,
    env: { ...process.env, HOST: "127.0.0.1", PORT: "0", RESTAURANT_DB: database },
    stdio: ["ignore", "pipe", "inherit"],
  });
  let browser;
  try {
    const baseUrl = await waitForServer(server);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    // --- Waiter mobile: quick-action tray (collapsed default) ---
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(8000);
    await page.goto(baseUrl);
    await login(page, "waiter");
    await page.getByRole("button", { name: /1 Маса/ }).click();
    await page.getByRole("button", { name: /Нова нарачка/ }).first().click();
    await page.getByRole("button", { name: /Coca-Cola/ }).click();
    await page.getByRole("button", { name: /Margherita/ }).click();
    await page.getByRole("button", { name: /Schweppes/ }).click();
    const tray = page.locator(".compact-summary-tray");
    await tray.waitFor();
    await tray.locator(".tray-chip").filter({ hasText: "Margherita" }).locator('button[data-delta="1"]').click();
    await page.screenshot({ path: path.join(outDir, "waiter-tray-collapsed.png") });
    // --- Waiter mobile: expanded details with open food accordion ---
    await tray.getByRole("button", { name: /Детали/ }).click();
    const cartPanel = page.locator("#cart-panel");
    await cartPanel.waitFor();
    const margheritaCard = cartPanel.locator(".cart-card").filter({ hasText: "Margherita" });
    await margheritaCard.locator(".food-customization-summary").click();
    await page.screenshot({ path: path.join(outDir, "waiter-details-expanded.png"), fullPage: false });
    // Scroll to the Margherita card so the accordion body is in the shot
    await margheritaCard.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(outDir, "waiter-accordion-open.png") });
    // Send the order so the KDS section below has items in the queue.
    await tray.getByRole("button", { name: /Испрати/ }).click();
    await page.getByText("Нарачката е испратена.").waitFor();
    await page.close();
    // --- KDS dark theme: single "Готово" action with table group header ---
    const kitchen = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    kitchen.setDefaultTimeout(8000);
    await kitchen.goto(baseUrl);
    await login(kitchen, "kitchen");
    await kitchen.getByRole("button", { name: "Кујна" }).click();
    await kitchen.getByText("Margherita").waitFor();
    await kitchen.screenshot({ path: path.join(outDir, "kds-dark-group.png") });
    const readyButton = kitchen.getByRole("button", { name: "Готово" }).first();
    await readyButton.waitFor();
    await kitchen.screenshot({ path: path.join(outDir, "kds-dark-ready.png") });
    await readyButton.click();
    await kitchen.screenshot({ path: path.join(outDir, "kds-dark-after-ready.png") });
    await kitchen.close();
    console.log("Screenshots written to", outDir);
  } finally {
    if (browser) await browser.close();
    server.kill();
    await new Promise((resolve) => server.once("exit", resolve));
    for (const suffix of ["", "-wal", "-shm"]) {
      try { fs.unlinkSync(database + suffix); } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
