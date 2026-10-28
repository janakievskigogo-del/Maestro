const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const python = process.env.PYTHON || "python";
const project = path.resolve(__dirname, "..");
const database = path.join(__dirname, "restaurant-ui-smoke.sqlite3");

function waitForServer(processRef) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Server did not start. Output: ${output}`)), 10000);
    processRef.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(/running at (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    processRef.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    processRef.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited with code ${code}. Output: ${output}`));
    });
  });
}

async function login(page, username) {
  await page.getByLabel("Корисничко име").fill(username);
  await page.getByLabel("Лозинка").fill("demo123");
  await page.getByRole("button", { name: "Најави се" }).click();
}

(async () => {
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.setDefaultTimeout(3500);
    await page.goto(baseUrl);
    await login(page, "waiter");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.getByRole("button", { name: /1 Маса/ }).click();
    await page.getByRole("button", { name: /Нова нарачка/ }).first().click();
    await page.getByRole("button", { name: /Coca-Cola/ }).click();
    await page.getByRole("button", { name: /Margherita/ }).click();

    const tray = page.locator(".compact-summary-tray");
    await tray.waitFor();
    const margheritaChip = tray.locator(".tray-chip").filter({ hasText: "Margherita" });
    const colaChip = tray.locator(".tray-chip").filter({ hasText: "Coca-Cola" });
    assert.ok(await margheritaChip.isVisible());
    assert.ok(await colaChip.isVisible());
    assert.equal(await margheritaChip.locator(".tray-chip-qty").textContent(), "1");
    await margheritaChip.locator('button[data-delta="1"]').click();
    await margheritaChip.locator('button[data-delta="1"]').click();
    assert.equal(await margheritaChip.locator(".tray-chip-qty").textContent(), "3");
    await margheritaChip.locator('button[data-delta="-1"]').click();
    assert.equal(await margheritaChip.locator(".tray-chip-qty").textContent(), "2");
    await margheritaChip.locator('button[data-delta="1"]').click();
    assert.equal(await margheritaChip.locator(".tray-chip-qty").textContent(), "3");
    await colaChip.locator('button[data-delta="1"]').click();
    assert.equal(await colaChip.locator(".tray-chip-qty").textContent(), "2");
    assert.ok((await tray.locator(".tray-total-label").textContent()).includes("5 ставки"));
    assert.ok(/ден\./.test(await tray.locator(".tray-total-amount").textContent()));
    await page.getByRole("button", { name: /Schweppes/ }).click();
    const schweppesChip = tray.locator(".tray-chip").filter({ hasText: "Schweppes" });
    assert.ok(await schweppesChip.isVisible());
    await schweppesChip.locator(".tray-remove-btn").click();
    assert.equal(await tray.locator(".tray-chip").filter({ hasText: "Schweppes" }).count(), 0);
    const cartPanel = page.locator("#cart-panel");
    assert.ok(!(await cartPanel.isVisible()), "cart details must be collapsed by default");
    await tray.getByRole("button", { name: /Детали/ }).click();
    assert.ok(await cartPanel.isVisible(), "Детали must expand the full cart list");
    const margheritaCard = cartPanel.locator(".cart-card").filter({ hasText: "Margherita" });
    const colaCard = cartPanel.locator(".cart-card").filter({ hasText: "Coca-Cola" });
    assert.equal(await colaCard.locator(".food-customization-accordion").count(), 0, "drinks must not show customization");
    const margheritaAccordion = margheritaCard.locator(".food-customization-accordion");
    assert.ok(await margheritaAccordion.isVisible(), "food customization accordion should render");
    assert.equal(await margheritaAccordion.getAttribute("open"), null, "accordion must be collapsed by default");
    await margheritaCard.locator(".food-customization-summary").click();
    assert.equal(await margheritaAccordion.getAttribute("open"), "", "accordion opens on tap");
    await margheritaCard.locator('.quantity-control button[data-delta="1"]').click();
    assert.equal(await margheritaAccordion.getAttribute("open"), "", "accordion stays open across re-renders");
    assert.equal(await margheritaCard.locator(".quantity-control strong").textContent(), "4");
    await margheritaCard.locator('.quantity-control button[data-delta="-1"]').click();
    assert.equal(await margheritaCard.locator(".quantity-control strong").textContent(), "3");
    await tray.getByRole("button", { name: /Скриј детали/ }).click();
    assert.ok(!(await cartPanel.isVisible()), "Скриј детали must collapse the cart list again");
    await tray.getByRole("button", { name: /Испрати/ }).click();
    await page.getByText("Нарачката е испратена.").waitFor();

    // --- KDS: single direct "Готово" action, no quantity popup or steppers ---

    await page.getByRole("button", { name: "Одјави се" }).click();
    await login(page, "kitchen");
    await page.getByRole("button", { name: "Кујна" }).click();
    await page.getByText("Margherita").waitFor();
    assert.equal(await page.locator(".kds-step-btn").count(), 0, "KDS must not render quantity steppers");
    assert.equal(await page.locator(".ready-quantity-input").count(), 0, "KDS must not render a quantity input");
    await page.getByRole("button", { name: "Готово" }).first().click();
    await page.getByText("Ставката е означена како готова.").waitFor();

    await page.getByRole("button", { name: "Одјави се" }).click();
    await login(page, "bar");
    await page.getByRole("button", { name: "Бар", exact: true }).click();
    await page.getByText("Coca-Cola").waitFor();
    assert.equal(await page.locator(".kds-step-btn").count(), 0, "Bar KDS must not render quantity steppers");
    await page.getByRole("button", { name: "Готово" }).first().click();
    await page.getByText("Ставката е означена како готова.").waitFor();

    await page.getByRole("button", { name: "Одјави се" }).click();
    await login(page, "waiter");
    await page.getByRole("button", { name: /^Готови ставки/ }).click();
    await page.getByText("Margherita").waitFor();
    await page.getByText("Coca-Cola").waitFor();
    const deliverButton = page.getByRole("button", { name: "Означи како доставено" });
    await deliverButton.first().waitFor();
    await deliverButton.first().click();
    await page.getByText("Ставката е означена како доставена.").waitFor();

    await page.getByRole("button", { name: "Одјави се" }).click();
    await login(page, "admin");
    await page.getByRole("button", { name: "Администрација" }).click();
    const pizzaForm = page.locator('form[data-admin-update="menu"]').filter({ hasText: "Margherita" });
    await pizzaForm.locator('input[name="price"]').fill("400");
    await pizzaForm.getByRole("button", { name: "Зачувај Margherita" }).click();
    await page.getByText("Промените се зачувани.").waitFor();
    const categoryForm = page.locator('form[data-admin-create="category"]');
    await categoryForm.locator('input[name="name"]').fill("Десерти");
    await categoryForm.getByRole("button", { name: "Додади категорија" }).click();
    await page.waitForFunction(() => Array.from(document.querySelectorAll('form[data-admin-create="menu"] select[name="category_id"] option')).some((option) => option.textContent === "Десерти"));

    assert.deepEqual(pageErrors, []);
    assert.equal(await page.title(), "Нарачки . Ресторан");
    console.log("UI smoke flow passed: tray -> conditional accordions -> single KDS Готово button -> delivery -> admin edits.");
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
