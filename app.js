window.filterIngredients = function(input) {
  const query = input.value.toLowerCase().trim();
  const block = input.closest(".ingredient-selector-block") || input.parentElement.parentElement;
  const pills = block.querySelectorAll(".ingredient-pill");
  pills.forEach((pill) => {
    const isTop = pill.dataset.top === "true";
    const isChecked = pill.querySelector('input[type="checkbox"]')?.checked;
    if (!query) {
      // Revert to displaying ONLY the top 3 most expensive ingredients (and any currently checked)
      pill.style.display = (isTop || isChecked) ? "" : "none";
    } else {
      const nameEl = pill.querySelector(".ingredient-pill-name");
      const name = nameEl ? nameEl.textContent.toLowerCase() : pill.textContent.toLowerCase();
      pill.style.display = name.includes(query) ? "" : "none";
    }
  });
};
// ============================================================================
// CRITICAL FIX: UNCONDITIONAL HARD SPLASH SCREEN TIMEOUT (1500ms)
// Finds #splash-screen, .splash-screen, or .splash-container and forces display='none'
// Runs independently on a timer - NEVER inside any fetch().then() or async/await block.
// ============================================================================
function forceHideSplashUnconditional() {
  const splash = document.querySelector("#splash-screen") || document.querySelector(".splash-screen") || document.querySelector(".splash-container");
  if (splash) {
    splash.style.display = "none";
    splash.classList.add("hidden");
    splash.setAttribute("aria-hidden", "true");
  }
  if (typeof state !== "undefined" && state.isSplash) {
    state.isSplash = false;
    if (typeof render === "function") {
      try { render(); } catch (_) {}
    }
  }
}

// 1. At the very top of DOMContentLoaded
window.addEventListener("DOMContentLoaded", () => {
  setTimeout(forceHideSplashUnconditional, 1500);
});
// 2. At the very top of window.onload
window.addEventListener("load", () => {
  setTimeout(forceHideSplashUnconditional, 1500);
});
// 3. Immediate fallback in case document is already parsed when script runs
setTimeout(forceHideSplashUnconditional, 1500);
const app = document.querySelector("#app");
const toastRegion = document.querySelector("#toast-region");
const offlineBanner = document.querySelector("#offline-banner");
function detectVenueSlug() {
  const params = new URLSearchParams(window.location.search);
  const querySlug = params.get("venue") || params.get("venue_slug");
  if (querySlug && querySlug.trim()) {
    const clean = querySlug.trim().toLowerCase();
    localStorage.setItem("activeVenueSlug", clean);
    return clean;
  }
  const urlPath = window.location.pathname.replace(/^\/+|\/+$/g, "").trim().toLowerCase();
  const nonVenuePaths = new Set(["", "index.html", "app.js", "styles.css", "manifest.json", "sw.js"]);
  if (urlPath && !nonVenuePaths.has(urlPath) && !urlPath.startsWith("api")) {
    localStorage.setItem("activeVenueSlug", urlPath);
    return urlPath;
  }
  const saved = localStorage.getItem("activeVenueSlug");
  if (saved && saved.trim()) {
    return saved.trim().toLowerCase();
  }
  // No venue slug in URL or localStorage - return null to trigger venue selector UI
  return null;
}


const state = {
  user: null,
  view: "tables",
  isSplash: true,
  loginMode: "quick",
  activeVenueSlug: detectVenueSlug(),
  currentVenue: null,
  showVenueModal: false,
  publicVenues: [],
  currentPin: "",
  pinError: "",
  pinShaking: false,
  tables: [],
  menu: [],
  ingredients: [],
  orders: [],
  queue: [],
  ready: [],
  restaurants: [],
  tableId: null,
  category: "",
  search: "",
  cart: [],
  cartExpanded: false,
  customizingItemUid: null,
  openAccordions: new Set(),
  activePortions: {},  // uid -> 0-based portion index
  editingMenuId: null,
  editingUserId: null,
  editingRestaurantId: null,
  adminConfig: null,
  adminTab: "menu",
  adminMenuSearch: "",
  adminMenuCategory: "Сите",
  adminIngredientSearch: "",
  notifications: [],
  notificationSeeded: false,
  loading: false,
  audioUnlocked: false,
  showResetModal: false,
  selectedDeliveryTable: null,
};
const roles = {
  waiter: ["tables", "profile", "ready"],
  kitchen: ["kitchen", "profile"],
  bar: ["bar", "profile"],
  admin: ["admin"],
  super_admin: ["super-admin"],
};
const viewNames = {
  tables: "Маси",
  profile: "Профил",
  kitchen: "Кујна",
  bar: "Бар",
  ready: "Готови ставки",
  admin: "Администрација",
  "super-admin": "Ресторани",
};
const statusNames = {
  received: "Примено",
  preparing: "Се подготвува",
  ready: "Готово",
  needs_confirmation: "Потребна потврда",
  rejected: "Одбиено",
  cancelled: "Откажано",
  delivered: "Доставено",
};
// --- AUDIO & HAPTIC ALERTS ---
function playReadyBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    // Double chime (880Hz then 1174Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(880, now);
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.22);
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(1174, now + 0.12);
    gain2.gain.setValueAtTime(0.35, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.38);
  } catch (_) {}
}

function vibrateReady() {
  if ("vibrate" in navigator) {
    try {
      navigator.vibrate([220, 80, 220]);
    } catch (_) {}
  }
}

function notifyReady(message) {
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      new Notification("Maestro . Готова ставка!", {
        body: message,
        icon: "/icons/icon-192.svg",
        badge: "/icons/icon-192.svg",
      });
    } catch (_) {}
  }
}

function unlockAudio() {
  if (state.audioUnlocked) return;
  state.audioUnlocked = true;
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}
document.addEventListener("click", unlockAudio, { once: true });
document.addEventListener("touchstart", unlockAudio, { once: true });
// --- OFFLINE DETECTION ---
function syncOnlineStatus() {
  if (offlineBanner) {
    offlineBanner.hidden = navigator.onLine;
  }
}
window.addEventListener("online", syncOnlineStatus);
window.addEventListener("offline", syncOnlineStatus);
syncOnlineStatus();
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function icon(paths, options = {}) {
  const size = options.size || 20;
  const className = options.className || "";
  const viewBox = options.viewBox || "0 0 24 24";
  return `<svg class="${className}" viewBox="${viewBox}" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}

const ICON_CHECK = icon(`<path d="M20 6 9 17l-5-5"></path>`);
const ICON_COOKING = icon(`<path d="M7 3v18"></path><path d="M7 8h4a3 3 0 0 1 0 6H7"></path><path d="M7 13h5"></path>`);
const ICON_TABLE = icon(`<path d="M3 10a9 9 0 0 1 18 0v3H3z"></path><rect x="3" y="14" width="18" height="7"></rect><path d="M12 19v3"></path>`);
const ICON_MAGNIFY = icon(`<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>`, { size: 18 });
const ICON_CLIPBOARD = icon(`<rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2z"></path>`);
const ICON_USERS = icon(`<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>`);
const ICON_TAG = icon(`<path d="M12.59 2.29A2 2 0 0 0 11.71 2H4a2 2 0 0 0-2 2v7.59a2 2 0 0 0 .59 1.41l8.44 8.44a2 2 0 0 0 2.82 0l6.79-6.79a2 2 0 0 0 0-2.82z"></path><circle cx="11.5" cy="6.5" r="1.5"></circle>`);
const ICON_CHEVRON_DOWN = icon(`<path d="m6 9 6 6 6-6"></path>`, { size: 10, className: "accordion-arrow" });
const ICON_CHEVRON_UP = icon(`<path d="m18 15-6-6-6 6"></path>`, { size: 10, className: "accordion-arrow" });
const ICON_CHEVRON_SMALL_DOWN = icon(`<path d="m6 9 6 6 6-6"></path>`, { size: 8, className: "tray-toggle-arrow" });
const ICON_CHEVRON_SMALL_UP = icon(`<path d="m18 15-6-6-6 6"></path>`, { size: 8, className: "tray-toggle-arrow" });
async function api(path, options = {}) {
  try {
    const token = localStorage.getItem("maestro_token");
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    // Default 8-second timeout for API requests to prevent indefinite network hanging
    let signal = options.signal;
    let timeoutId = null;
    if (!signal && window.AbortController) {
      const controller = new AbortController();
      signal = controller.signal;
      const timeoutMs = options.timeoutMs || 8000;
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    }

    try {
      const response = await fetch(path, {
        credentials: "same-origin",
        headers,
        signal,
        ...options,
      });
      if (timeoutId) clearTimeout(timeoutId);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401 && state.user) {
          state.user = null;
          localStorage.removeItem("maestro_token");
          render();
        }
        throw new Error(body.error || "Се појави грешка. Обидете се повторно.");
      }
      return body;
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      throw err;
    }
  } catch (error) {
    console.error(`[API Error] ${options.method || "GET"} ${path}:`, error.message);
    throw error;
  }
}

let activeToastTimeout = null;
function toast(message, kind = "success") {
  if (!message || !toastRegion) return;
  // Debounce & single toast enforcement: clear existing toasts to prevent stacking
  if (kind === "error") {
    const currentError = toastRegion.querySelector(".toast-error");
    if (currentError && currentError.textContent === message) {
      return; // Deduplicate identical error messages
    }
  }

  // Clear previous toast
  toastRegion.innerHTML = "";
  if (activeToastTimeout) {
    clearTimeout(activeToastTimeout);
    activeToastTimeout = null;
  }

  const node = document.createElement("div");
  node.className = `toast toast-${kind}`;
  node.textContent = message;
  toastRegion.append(node);
  activeToastTimeout = setTimeout(() => {
    node.remove();
    activeToastTimeout = null;
  }, kind === "error" ? 4000 : 3500);
}

function formatCurrency(amount, currency) {
  const n = Number(amount) || 0;
  return n.toLocaleString("mk-MK", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + "\u00a0" + (currency || "MKD");
}


function formatTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("mk-MK", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function money(value, currency = null) {
  const curr = currency || state.user?.restaurant?.currency || "MKD";
  return `${new Intl.NumberFormat("mk-MK").format(value)} ${curr === "MKD" ? "ден." : curr}`;
}

function isBeverage(item) {
  if (!item) return false;
  if (item.station === "bar") return true;
  const category = String(item.category || "").toLowerCase();
  return ["пијал", "напит", "drink", "beverage", "напиток"].some((word) => category.includes(word));
}

// Sync a specific portion's data back to the flat fields on the cart entry.
// The flat fields (removals/additions/note/allergies) are kept as the
// authoritative data for portion-0 only - they are used by modificationSummary
// and the send payload for simple (quantity=1 or all-same) items.
function syncPortionToFlat(entry, portionIndex) {
  if (!entry.portions) return;
  const p = entry.portions[portionIndex] || entry.portions[0];
  if (!p) return;
  // Only sync portion 0 into the flat fields (it IS portion 0)
  if (portionIndex === 0) {
    entry.removals = p.removals;
    entry.additions = p.additions;
    entry.note = p.note;
    entry.allergies = p.allergies;
  }
}

// Return per-portion summary text for the accordion collapsed header.
function portionSummary(portions) {
  if (!portions || portions.length <= 1) return null;
  const customized = portions.filter((p) => p.removals.length || p.additions.length || p.note || p.allergies.length);
  if (!customized.length) return null;
  return customized.length === 1 ? `1 порција прилагодена` : `${customized.length} порции прилагодени`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Stable per-entry id so cart controls (steppers, remove, customization)
// keep working after entries are spliced out of the array.
let cartUid = 0;
function cartEntry(uid) {
  return state.cart.find((entry) => entry.uid === Number(uid));
}

function lineTotal(entry) {
  const additions = entry.additions.reduce((sum, addition) => sum + Number(addition.price || 0), 0);
  return (entry.price + additions) * entry.quantity;
}

function cartTotals() {
  return state.cart.reduce(
    (totals, entry) => ({
      total: totals.total + lineTotal(entry),
      quantity: totals.quantity + entry.quantity,
    }),
    { total: 0, quantity: 0 }
  );
}

// Short human summary of the modifications applied to one cart line. Shown in
// the collapsed customization header so the waiter never has to open it just to
// remember what was changed.
function modificationSummary(item) {
  // Multi-portion: show aggregate summary
  if (item.portions && item.portions.length > 1) {
    const ps = portionSummary(item.portions);
    return ps || "";
  }
  const parts = [];
  if (item.removals.length) parts.push(`Без ${item.removals.join(", ")}`);
  if (item.additions.length) parts.push(`+ ${item.additions.map((addition) => addition.name).join(", ")}`);
  if (item.allergies.length) parts.push("Алергија");
  if (item.note) parts.push("забелешка");
  return parts.join(" . ");
}

function venueSwitchModal() {
  if (!state.showVenueModal) return "";
  const venues = state.publicVenues || [];
  return `
  <div class="modal-overlay" data-action="close-venue-modal" role="dialog" aria-modal="true" aria-labelledby="venue-modal-title">
    <div class="modal-box" style="max-width: 440px" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h2 id="venue-modal-title">Промени ресторан</h2>
        <button type="button" class="modal-close-btn" data-action="close-venue-modal" aria-label="Затвори">x</button>
      </div>
      <div class="modal-body" style="padding: 18px 20px;">
        <p class="muted small" style="margin-bottom: 12px">Изберете ресторан од листата или внесете кратенка (URL slug):</p>
        <div class="venue-option-list">
          ${venues.map((v) => `
            <div class="venue-option-item ${state.activeVenueSlug === v.slug ? "active" : ""}" data-select-venue-slug="${escapeHtml(v.slug)}">
              <div>
                <div class="venue-option-name">${escapeHtml(v.name)}</div>
                <div class="venue-option-slug">/${escapeHtml(v.slug)} . ${escapeHtml(v.currency || "MKD")}</div>
              </div>
              ${state.activeVenueSlug === v.slug ? '<span class="status-pill status-ready">Активен</span>' : ""}
            </div>
          `).join("")}
        </div>
        <form id="custom-venue-form" style="display: flex; gap: 8px; margin-top: 14px;">
          <input name="venue_slug" placeholder="Внесете slug (пр. maestro-skopje)" style="flex: 1;" value="${escapeHtml(state.activeVenueSlug || "")}" required />
          <button type="submit" class="button button-primary">Потврди</button>
        </form>
      </div>
      <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center;">
        <button type="button" class="auth-switch-btn" data-action="switch-standard-auth" style="margin: 0; padding: 0;">
          Супер-Админ / Менаџер најава ->
        </button>
        <button type="button" class="button button-soft" data-action="close-venue-modal">Затвори</button>
      </div>
    </div>
  </div>`;
}

function venueSelectView() {
  const venues = state.publicVenues || [];
  if (!venues.length) {
    loadPublicVenues().then(() => render());
    return `<main class="login-page">
      <section class="login-card" style="text-align:center">
        <div class="brand-mark">M</div>
        <p class="eyebrow">SMARTRESTO . MAESTRO POS</p>
        <p class="muted" style="margin-top:16px">Вчитување ресторани...</p>
      </section>
    </main>`;
  }
  const venueItems = venues.map(v => `
    <div class="venue-option-item" data-select-venue-slug="${escapeHtml(v.slug)}">
      <div class="venue-option-name">${escapeHtml(v.name)}</div>
      <div class="venue-option-slug">/${escapeHtml(v.slug)} . ${escapeHtml(v.currency || "MKD")}</div>
    </div>`).join('');
  return `<main class="quick-auth-page">
    <section class="quick-auth-card">
      <div class="quick-auth-header">
        <div class="brand-mark">M</div>
        <p class="eyebrow">SMARTRESTO . MAESTRO POS</p>
        <h1 class="quick-auth-venue-title">Изберете ресторан</h1>
        <p class="muted" style="font-size:0.92rem;margin:4px 0 12px">Изберете го вашиот ресторан за да продолжите</p>
      </div>
      <div class="venue-option-list" style="width:100%;margin-top:8px">
        ${venueItems}
      </div>
      <button type="button" class="auth-switch-btn" data-action="switch-standard-auth"
              style="margin-top:18px">Стандардна најава со лозинка</button>
    </section>
  </main>`;
}

function quickAuthView() {
  const pinDots = [0, 1, 2, 3].map((i) => {
    const isFilled = i < state.currentPin.length;
    return `<div class="pin-dot ${isFilled ? "filled" : ""}"></div>`;
  }).join("");
  const venueName = state.currentVenue?.name || "Маестро Скопје";
  return `<main class="quick-auth-page">
    <section class="quick-auth-card">
      <div class="quick-auth-header">
        <div class="brand-mark">M</div>
        <p class="eyebrow">SMARTRESTO . MAESTRO POS</p>
        <h1 class="quick-auth-venue-title">${escapeHtml(venueName)}</h1>
        <p class="muted" style="font-size:0.92rem;margin:0 0 4px">Внесете 4-цифрен PIN</p>
      </div>
      ${state.pinError ? `<div class="pin-error-banner" role="alert">${escapeHtml(state.pinError)}</div>` : ""}

      <div class="pin-display-wrap">
        <div id="pin-dots" class="pin-display ${state.pinShaking ? "shake" : ""}">
          ${pinDots}
        </div>
      </div>
      <div class="pin-pad">
        <button type="button" class="pin-key" data-pin-digit="1">1</button>
        <button type="button" class="pin-key" data-pin-digit="2">2</button>
        <button type="button" class="pin-key" data-pin-digit="3">3</button>
        <button type="button" class="pin-key" data-pin-digit="4">4</button>
        <button type="button" class="pin-key" data-pin-digit="5">5</button>
        <button type="button" class="pin-key" data-pin-digit="6">6</button>
        <button type="button" class="pin-key" data-pin-digit="7">7</button>
        <button type="button" class="pin-key" data-pin-digit="8">8</button>
        <button type="button" class="pin-key" data-pin-digit="9">9</button>
        <button type="button" class="pin-key pin-key-action" data-action="pin-clear" title="Избриши" aria-label="Избриши">
          C
          <span class="pin-subtext">Избриши</span>
        </button>
        <button type="button" class="pin-key" data-pin-digit="0">0</button>
        <button type="button" class="pin-key pin-key-action" data-action="pin-backspace" title="Избриши">
          Del
          <span class="pin-subtext">Избриши</span>
        </button>
      </div>
      <button type="button" class="auth-switch-btn" data-action="switch-standard-auth">
        Стандардна најава со лозинка
      </button>
      ${venueSwitchModal()}
    </section>
  </main>`;
}

function loginView() {
  return `<main class="login-page">
    <section class="login-card">
      <div class="row-between" style="margin-bottom:12px">
        <div class="brand-mark" style="margin-bottom:0">M</div>
        <button type="button" class="button button-soft small" data-action="switch-quick-auth">
          Брза најава (PIN) ->
        </button>
      </div>
      <p class="eyebrow">SMARTRESTO . MAESTRO POS</p>
      <h1>Добредојдовте</h1>
      <p class="muted">Најавете се за пристап до системот на ресторанот.</p>
      <form id="login-form" class="stack-form">
        <label>Корисничко име<input name="username" aria-label="Корисничко име" autocomplete="username" required /></label>
        <label>Лозинка<input name="password" aria-label="Лозинка" type="password" autocomplete="current-password" required /></label>
        <div id="login-error" class="form-error" role="alert"></div>
        <button class="button button-primary button-wide" type="submit">Најави се</button>
      </form>
      <p class="small muted">Поддржува инсталација како апликација (PWA) и работа на телефони и таблети.</p>
    </section>
  </main>`;
}

function navSvg(view) {
  if (view === "tables") {
    // Original 4-Squares Grid SVG Icon ("Маси")
    return `<svg class="bottom-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5"/>
      <rect x="14" y="3" width="7" height="7" rx="1.5"/>
      <rect x="3" y="14" width="7" height="7" rx="1.5"/>
      <rect x="14" y="14" width="7" height="7" rx="1.5"/>
    </svg>`;
  }
  if (view === "profile") {
    // CENTER TAB: Elevated Blue Circle #007AFF with Profile User Avatar
    return `<div class="bottom-nav-icon-circle">
      <svg class="bottom-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
      </svg>
    </div>`;
  }
  if (view === "ready") {
    // Original Simple Bell SVG Icon ("Готови ставки")
    return `<svg class="bottom-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>`;
  }
  if (view === "kitchen") {
    return `<svg class="bottom-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 13.8V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v9.8"/><path d="M3 14h18a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2z"/></svg>`;
  }
  if (view === "bar") {
    return `<svg class="bottom-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 22h8"/><path d="M12 15v7"/><path d="m19 3-7 8-7-8h14z"/></svg>`;
  }
  if (view === "admin") {
    return `<svg class="bottom-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
  }
  return `<svg class="bottom-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
}

//  MОЈ ПРОФИЛ - Clean & Minimal Staff Profile Screen (No Shift Statistics) 
function profileView() {
  const u = state.user;
  if (!u) return "";
  const roleLabel = { waiter: "Келнер", kitchen: "Кујна", bar: "Шанк", admin: "Администратор", super_admin: "Супер-Администратор" }[u.role] || u.role;
  const roleBadgeClass = { waiter: "role-badge-waiter", kitchen: "role-badge-kitchen", bar: "role-badge-bar", admin: "role-badge-admin", super_admin: "role-badge-admin" }[u.role] || "";
  const pin = u.pin || "1234";
  const password = u.password || "123456";
  return `
    <div class="profile-view">
      <!-- Profile Top Bar: Title Top-Left & Back Button Top-Right aligned -->
      <div class="profile-top-bar">
        <h1 class="profile-top-title">Мој Профил</h1>
        <button type="button" class="back-btn profile-back-btn" data-action="profile-back" aria-label="Назад кон работа">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M19 12H5"/><path d="M12 5l-7 7 7 7"/>
          </svg>
          <span>Назад</span>
        </button>
      </div>
      <!-- Profile Card: Avatar icon, Display Name, Role badge, and visible 4-digit PIN -->
      <div class="profile-hero">
        <div class="profile-avatar-ring">
          <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="14" cy="14" r="11" />
            <circle cx="14" cy="11" r="3.4" />
            <path d="M7.8 21.4c1.2-3.4 3.6-5 6.2-5s5 1.6 6.2 5" />
          </svg>
        </div>
        <div class="profile-hero-info">
          <h1 class="profile-display-name">${escapeHtml(u.name || u.display_name || u.username)}</h1>
          <div class="profile-badges">
            <span class="profile-role-badge ${roleBadgeClass}">${roleLabel}</span>
            <span class="profile-pin-badge">PIN: <strong>${escapeHtml(String(pin))}</strong></span>
          </div>
        </div>
      </div>
      <!-- Login Data Card: Clear Username and Password details -->
      <div class="profile-cred-box">
        <div class="profile-cred-title">Податоци за најава</div>
        <div class="profile-cred-list">
          <div class="profile-cred-row">
            <span class="profile-cred-label">Корисничко име:</span>
            <strong class="profile-cred-val">${escapeHtml(u.username)}</strong>
          </div>
          <div class="profile-cred-row">
            <span class="profile-cred-label">Лозинка:</span>
            <strong class="profile-cred-val">${escapeHtml(password)}</strong>
          </div>
          <div class="profile-cred-row">
            <span class="profile-cred-label">PIN код:</span>
            <strong class="profile-cred-val profile-cred-pin">${escapeHtml(String(pin))}</strong>
          </div>
        </div>
      </div>
      <!-- Action Button: A single, clean iOS Red "Одјави се" (Logout) button -->
      <div class="profile-actions">
        <button class="button profile-logout-btn" data-action="logout">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          Одјави се
        </button>
      </div>
    </div>`;
}

function shell(content) {
  const tabs = roles[state.user.role] || [];
  const venueTitle = state.user.restaurant ? state.user.restaurant.name : state.user.role === "super_admin" ? "Системска администрација" : "Ресторан";
  const readyCount = state.ready.reduce((sum, item) => sum + (item.ready_quantity - item.delivered_quantity), 0);
  return `<div class="app-shell">
    <header class="topbar">
      <a class="brand" href="#" data-action="home" aria-label="Почетна">
        <span class="brand-mark brand-mark-small">M</span>
        <span><strong>Maestro</strong><small>SMARTRESTO POS</small></span>
      </a>
      <nav class="main-nav" aria-label="Главна навигација">
        ${tabs.map((view) => `<button class="nav-button ${state.view === view ? "active" : ""}" data-nav="${view}">${viewNames[view] || view}${view === "ready" && readyCount > 0 ? ` (${readyCount})` : ""}</button>`).join("")}
      </nav>
      <div class="user-menu">
        <span class="venue-tag" title="Ресторан">${escapeHtml(venueTitle)}</span>
        <span class="role-chip">${escapeHtml(state.user.name)}</span>
        <button class="button button-ghost" data-action="logout">Одјави се</button>
      </div>
    </header>
    <main class="page-content">${content}</main>
    <nav class="bottom-nav ${state.view === "admin" ? "bottom-nav-admin" : ""}" aria-label="Мобилна навигација">
      <div class="bottom-nav-inner">
        ${state.view === "admin" ? `
          <button class="bottom-nav-item ${(state.adminMobileTab || state.adminTab || "analytics") === "analytics" ? "active" : ""}" data-admin-bottom-nav="analytics">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>
            <span>Стат.</span>
          </button>
          <button class="bottom-nav-item ${(state.adminMobileTab || state.adminTab) === "menu" ? "active" : ""}" data-admin-bottom-nav="menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
            <span>Мени</span>
          </button>
          <button class="bottom-nav-item ${(state.adminMobileTab || state.adminTab) === "categories" ? "active" : ""}" data-admin-bottom-nav="categories">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            <span>Категории</span>
          </button>
          <button class="bottom-nav-item ${(state.adminMobileTab || (state.adminTab === "tables" ? "staff" : "")) === "staff" ? "active" : ""}" data-admin-bottom-nav="staff">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <span>Персонал</span>
          </button>
        ` : tabs.map((view) => `<button class="bottom-nav-item ${state.view === view ? "active" : ""}" data-nav="${view}">
          ${navSvg(view)}
          <span>${viewNames[view] || view}</span>
          ${view === "ready" && readyCount > 0 ? `<span class="bottom-nav-badge">${readyCount}</span>` : ""}
        </button>`).join("")}
      </div>
    </nav>
    <footer class="app-footer">
      <span>${escapeHtml(venueTitle)} . Maestro SmartResto</span>
      <span>Валута: ${state.user?.restaurant?.currency || "MKD"} . Освежување во живо</span>
    </footer>
  </div>`;
}

function statusPill(status) {
  return `<span class="status-pill status-${escapeHtml(status)}">${escapeHtml(statusNames[status] || status)}</span>`;
}

function tablesView() {
  return `<div class="view-mode-banner mode-order-taking">
      <span class="mode-badge">РЕЖИМ НА РАБОТА</span>
      <h1>ПРИМАЊЕ НАРАЧКИ</h1>
    </div>
    <div class="page-heading compact-heading">
      <div>
        <p class="eyebrow">РАБОТЕН ПРЕГЛЕД</p>
        <h2>Маси</h2>
      </div>
      <button class="button button-soft" data-action="refresh-tables">Освежи</button>
    </div>
    ${state.loading ? `<div class="loading-state" role="status">Се вчитуваат масите...</div>` : `<section class="table-grid">${state.tables.map((table) => `<button class="table-card" data-table="${table.id}">
      <span class="table-number">${table.number}</span>
      <span class="table-label">Маса</span>
      <span class="table-meta">${table.active_orders ? `${table.active_orders} активни испраќања` : "Нема активни нарачки"}</span>
    </button>`).join("")}</section>`}`;
}

function amendmentControls(item) {
  if (state.user.role !== "waiter" || !["received", "preparing", "ready", "rejected"].includes(item.status)) return "";
  if (item.pending_request) {
    return `<div class="request-pending">Барањето за ${item.pending_request.action === "cancel" ? "откажување" : "измена"} чека потврда од ${item.station === "bar" ? "барот" : "кујната"}.</div>`;
  }
  const menuItem = state.menu.find((entry) => entry.id === item.menu_item_id);
  return `<details class="change-controls"><summary>Измени или откажи ставка</summary><div class="change-form"><label>Посебна желба<input data-change-note="${item.id}" value="${escapeHtml(item.note)}" maxlength="500" /></label>
    ${menuItem?.ingredients.length ? `<div><p class="small muted">Состојки што гостинот не ги сака:</p><div class="checks">${menuItem.ingredients.map((ingredient) => `<label class="check-label"><input type="checkbox" data-change-removal="${item.id}" value="${escapeHtml(ingredient)}" ${item.removals.includes(ingredient) ? "checked" : ""}/><span>Без ${escapeHtml(ingredient)}</span></label>`).join("")}</div></div>` : ""}
    ${state.ingredients.length ? `<div><p class="small muted">Дополнителни состојки:</p><div class="checks">${state.ingredients.map((ingredient) => `<label class="check-label"><input type="checkbox" data-change-addition="${item.id}" value="${escapeHtml(ingredient.name)}" ${item.additions.some((entry) => entry.name === ingredient.name) ? "checked" : ""}/><span>${escapeHtml(ingredient.name)}${ingredient.price ? ` (+${money(ingredient.price)})` : ""}</span></label>`).join("")}</div></div>` : ""}
    <div class="station-actions"><button class="button button-soft" data-request-amend="${item.id}">Побарај измена</button><button class="button button-danger" data-request-cancel="${item.id}">Побарај откажување</button></div></div></details>`;
}

function changeHistory(order) {
  const changes = order.events.filter((event) => ["amended", "amended_after_rejection", "cancelled", "change_requested", "change_request_approved", "change_request_rejected", "allergy_approve", "allergy_reject"].includes(event.kind));
  if (!changes.length) return "";
  const labels = { amended: "Изменета ставка", amended_after_rejection: "Изменета одбиена ставка", cancelled: "Откажана ставка", change_requested: "Побарана измена", change_request_approved: "Измената е одобрена", change_request_rejected: "Измената е одбиена", allergy_approve: "Потврдена подготовка по проверка", allergy_reject: "Одбиена подготовка поради алергија" };
  return `<details class="change-history"><summary>Историја на измени (${changes.length})</summary>${changes.map((event) => `<div class="history-row"><strong>${escapeHtml(labels[event.kind] || event.kind)} . ${escapeHtml(event.item_name || "ставка")}</strong><span>${formatTime(event.created_at)} . ${escapeHtml(event.actor || "Систем")}</span>${changeDescription(event)}</div>`).join("")}</details>`;
}

function changeDescription(event) {
  const changes = event.details.changes || event.details;
  const parts = [];
  if (changes.note) parts.push(`Забелешка: ${changes.note}`);
  if (changes.removals?.length) parts.push(`Без: ${changes.removals.join(", ")}`);
  if (changes.additions?.length) parts.push(`Додади: ${changes.additions.map((entry) => typeof entry === "string" ? entry : entry.name).join(", ")}`);
  if (event.kind === "cancelled") parts.push("Ставката е откажана.");
  return parts.map((part) => `<small>${escapeHtml(part)}</small>`).join("");
}

function tableDetailView() {
  const table = state.tables.find((entry) => entry.id === state.tableId);
  const resetModal = state.showResetModal ? `
    <div class="modal-overlay" data-modal-overlay="reset" role="dialog" aria-modal="true" aria-labelledby="reset-modal-title">
      <div class="modal-box">
        <div class="modal-header">
          <h2 id="reset-modal-title">Ослободи маса</h2>
          <button type="button" class="modal-close-btn" data-action="cancel-reset-modal" aria-label="Затвори">x</button>
        </div>
        <div class="modal-body">
          <p style="font-weight:700;font-size:1.15rem;margin-bottom:8px">Дали сте сигурни?</p>
          <p class="muted" style="font-size:0.9rem">Сите завршени и доставени нарачки за маса ${table?.number ?? ""} ќе бидат архивирани, а масата ќе биде подготвена за нови гости. Историјата останува зачувана за извештаи.</p>
        </div>
        <div class="modal-footer ios-modal-footer">
          <button type="button" class="ios-modal-btn ios-modal-cancel-btn" data-action="cancel-reset-modal">Не / Откажи</button>
          <button type="button" class="ios-modal-btn ios-modal-primary-btn" data-action="confirm-reset-table">Да</button>
        </div>
      </div>
    </div>` : "";
  return `${resetModal}<div class="page-heading table-detail-header">
      <div class="page-heading-main table-info-col">
        <p class="eyebrow table-eyebrow">ДЕТАЛИ ЗА МАСА</p>
        <h1 class="table-title"><span class="table-name-nowrap">Маса ${table?.number ?? ""}</span> <button class="button button-ghost button-refresh-small" data-action="refresh-table" title="Освежи">Освежи</button></h1>
        <div class="table-left-actions">
          <button class="button button-clear-table button-compact-action" data-action="reset-table">Ослободи маса</button>
        </div>
      </div>
      <div class="page-heading-actions table-right-actions">
        <button class="back-btn" data-action="back-tables"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="M12 5l-7 7 7 7"/></svg> Назад</button>
        <button class="button button-primary button-compact-action table-new-order-btn" data-action="new-order">+ Нова нарачка</button>
      </div>
    </div>
    ${state.loading ? `<div class="loading-state" role="status">Се вчитуваат нарачките...</div>` : state.orders.length ? `<div class="ticket-list">${state.orders.map((order, orderIndex) => `<article class="ticket-card">
      <div class="ticket-head">
        <div><strong>Испраќање #${orderIndex + 1}</strong><span class="muted"> . ${formatTime(order.created_at)}</span></div>
        <span class="small muted">Келнер: ${escapeHtml(order.waiter)}</span>
      </div>
      <div class="ticket-lines">${order.items.map((item) => `<div class="order-line">
        <div class="line-main"><strong>${escapeHtml(item.name)} x ${item.quantity}</strong><span>${statusPill(item.status)}</span></div>
        <div class="line-details">
          ${item.ready_quantity ? `<span>${item.ready_quantity - item.delivered_quantity} за достава готови</span>` : ""}
          ${item.removals.length ? `<span>Без: ${item.removals.map(escapeHtml).join(", ")}</span>` : ""}
          ${item.additions.length ? `<span>Додади: ${item.additions.map((entry) => escapeHtml(entry.name)).join(", ")}</span>` : ""}
          ${item.note ? `<span>Забелешка: ${escapeHtml(item.note)}</span>` : ""}
        </div>
        ${item.allergies.length ? `<div class="allergy-warning"><strong> АЛЕРГИЈА:</strong> ${item.allergies.map(escapeHtml).join(", ")}<br/><span>Ресторанот мора да провери дали може безбедно да ја подготви храната и ризик од контаминација.</span></div>` : ""}
        ${amendmentControls(item)}
      </div>`).join("")}</div>${changeHistory(order)}</article>`).join("")}</div>` : `<section class="empty-state"><div class="empty-icon">${ICON_TABLE}</div><h2>Сe уште нема испратени нарачки</h2><p>Започнете со додавање ставки за оваа маса.</p><button class="button button-primary" data-action="new-order">+ Нова нарачка</button></section>`}`;
}

function portionBody(p, portionKey, item) {
  return `
    ${item.ingredients && item.ingredients.length ? `
      <section class="customization-section">
        <h4>Состав и измени</h4>
        <p class="small muted">Отстрани состојка што гостинот не ја сака:</p>
        <div class="checks">
          ${item.ingredients.map((ingredient) => `<label class="check-label"><input type="checkbox" data-remove-ingredient="${portionKey}" value="${escapeHtml(ingredient)}" ${p.removals.includes(ingredient) ? "checked" : ""}/><span>Без ${escapeHtml(ingredient)}</span></label>`).join("")}
        </div>
      </section>
    ` : ""}
    ${state.ingredients && state.ingredients.length ? `
      <section class="customization-section">
        <h4>Додади состојка</h4>
        <div class="checks">
          ${state.ingredients.map((ingredient) => `<label class="check-label"><input type="checkbox" data-add-ingredient="${portionKey}" value="${escapeHtml(ingredient.name)}" ${p.additions.some((entry) => entry.name === ingredient.name) ? "checked" : ""}/><span>${escapeHtml(ingredient.name)}${ingredient.price ? ` (+${money(ingredient.price)})` : ""}</span></label>`).join("")}
        </div>
      </section>
    ` : ""}
    <section class="customization-section">
      <h4>Алергија</h4>
      <label class="compact-label allergy-input"><span>Алергија (одделно од "не ја сака")</span><input data-allergy="${portionKey}" value="${escapeHtml(p.allergies.join(", "))}" placeholder="На пр. млечни производи" /></label>
    </section>
    <section class="customization-section">
      <h4>Забелешка</h4>
      <label class="compact-label"><span class="visually-hidden">Посебна желба</span><textarea rows="2" maxlength="500" data-note="${portionKey}" placeholder="Посебна желба / слободна забелешка">${escapeHtml(p.note)}</textarea></label>
    </section>`;
}

function customizationModal(item) {
  if (!item) return "";
  const beverage = isBeverage(item);
  const uid = item.uid;
  const hasPortions = !beverage && item.quantity >= 2 && item.portions && item.portions.length >= 2;
  const activePortion = hasPortions ? Math.min(state.activePortions[uid] || 0, item.portions.length - 1) : 0;
  const portion = hasPortions ? (item.portions[activePortion] || item.portions[0]) : item;
  const portionKey = hasPortions ? `${uid}:${activePortion}` : `${uid}`;
  return `
    <div class="customization-modal-overlay" data-modal-overlay="customization" role="dialog" aria-modal="true" aria-labelledby="customization-modal-title">
      <div class="customization-modal-container">
        <header class="customization-modal-header">
          <div class="customization-modal-title-group">
            <span class="customization-modal-eyebrow">Прилагодување</span>
            <h2 id="customization-modal-title">${escapeHtml(item.name)} <span class="customization-modal-qty">x${item.quantity}</span></h2>
          </div>
          <button type="button" class="customization-modal-close-btn" data-action="close-customization" aria-label="Затвори" title="Затвори">
            <span>Затвори</span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </header>
        <div class="customization-modal-body">
          ${hasPortions ? `
            <div class="portion-tabs-container">
              <span class="portion-tabs-label">Избери порција (${item.quantity} вкупно):</span>
              <div class="portion-tabs" role="tablist" aria-label="Порција">
                ${item.portions.map((_, i) => `<button type="button" role="tab" class="portion-tab${i === activePortion ? " portion-tab-active" : ""}" data-portion-tab="${uid}" data-portion-index="${i}" aria-selected="${i === activePortion}">${i + 1}</button>`).join("")}
              </div>
            </div>
            <p class="small muted portion-tab-hint">Порција ${activePortion + 1} од ${item.quantity} - прилагоди посебно</p>
          ` : ""}
          ${portionBody(portion, portionKey, item)}
        </div>
        <footer class="customization-modal-footer">
          <button type="button" class="button button-primary button-wide" data-action="close-customization">Зачувај и затвори</button>
        </footer>
      </div>
    </div>`;
}

function syncArrowIcons() {
  document.querySelectorAll("[data-customize-item]").forEach((btn) => {
    const uid = Number(btn.dataset.customizeItem);
    const isOpen = state.openAccordions.has(uid) || state.customizingItemUid === uid;
    btn.classList.toggle("is-open", isOpen);
    btn.setAttribute("title", isOpen ? "Затвори прилагодување" : "Прилагоди");
    const svg = btn.querySelector("svg");
    if (svg) {
      if (isOpen) {
        svg.innerHTML = '<polyline points="18 15 12 9 6 15"></polyline>';
      } else {
        svg.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';
      }
    }
  });
}

function updatePortionTabs(item) {
  const uid = item.uid;
  const hasPortions = !isBeverage(item) && item.quantity >= 2 && item.portions && item.portions.length >= 2;
  const activePortion = hasPortions ? Math.min(state.activePortions[uid] || 0, item.portions.length - 1) : 0;
  // Update in inline accordion on desktop
  const card = document.querySelector(`.cart-card[data-cart-uid="${uid}"]`);
  if (card) {
    let container = card.querySelector(".portion-tabs-container");
    let hint = card.querySelector(".portion-tab-hint");
    if (hasPortions) {
      if (!container) {
        const body = card.querySelector(".food-customization-body");
        if (body) {
          container = document.createElement("div");
          container.className = "portion-tabs-container";
          body.prepend(container);
          hint = document.createElement("p");
          hint.className = "small muted portion-tab-hint";
          container.after(hint);
        }
      }
      if (container) {
        container.innerHTML = `
          <span class="portion-tabs-label">Избери порција (${item.quantity} вкупно):</span>
          <div class="portion-tabs" role="tablist" aria-label="Порција">
            ${item.portions.map((_, i) => `<button type="button" role="tab" class="portion-tab${i === activePortion ? " portion-tab-active" : ""}" data-portion-tab="${uid}" data-portion-index="${i}" aria-selected="${i === activePortion}">${i + 1}</button>`).join("")}
          </div>
        `;
      }
      if (hint) {
        hint.textContent = `Порција ${activePortion + 1} од ${item.quantity} - прилагоди посебно`;
      }
    } else {
      if (container) container.remove();
      if (hint) hint.remove();
    }
  }

  // Also update in mobile modal if open
  const modal = document.querySelector(".customization-modal-container");
  if (modal && state.customizingItemUid === uid) {
    let container = modal.querySelector(".portion-tabs-container");
    let hint = modal.querySelector(".portion-tab-hint");
    const titleQty = modal.querySelector(".customization-modal-qty");
    if (titleQty) titleQty.textContent = `x${item.quantity}`;
    if (hasPortions) {
      if (!container) {
        const body = modal.querySelector(".customization-modal-body");
        if (body) {
          container = document.createElement("div");
          container.className = "portion-tabs-container";
          body.prepend(container);
          hint = document.createElement("p");
          hint.className = "small muted portion-tab-hint";
          container.after(hint);
        }
      }
      if (container) {
        container.innerHTML = `
          <span class="portion-tabs-label">Избери порција (${item.quantity} вкупно):</span>
          <div class="portion-tabs" role="tablist" aria-label="Порција">
            ${item.portions.map((_, i) => `<button type="button" role="tab" class="portion-tab${i === activePortion ? " portion-tab-active" : ""}" data-portion-tab="${uid}" data-portion-index="${i}" aria-selected="${i === activePortion}">${i + 1}</button>`).join("")}
          </div>
        `;
      }
      if (hint) {
        hint.textContent = `Порција ${activePortion + 1} од ${item.quantity} - прилагоди посебно`;
      }
    } else {
      if (container) container.remove();
      if (hint) hint.remove();
    }
  }
}

function orderItemCard(item) {
  const beverage = isBeverage(item);
  const uid = item.uid;
  const isItemOpen = state.openAccordions.has(uid);
  const isOpen = isItemOpen ? "open" : "";
  const summary = modificationSummary(item);
  // Auto multi-portion selector when quantity >= 2 for food items
  if (!beverage && item.quantity >= 2) {
    if (!item.portions) item.portions = [{ removals: [...(item.removals || [])], additions: [...(item.additions || [])], note: item.note || "", allergies: [...(item.allergies || [])] }];
    while (item.portions.length < item.quantity) {
      item.portions.push({ removals: [], additions: [], note: "", allergies: [] });
    }
  }
  const hasPortions = !beverage && item.quantity >= 2 && item.portions && item.portions.length >= 2;
  const activePortion = hasPortions ? Math.min(state.activePortions[uid] || 0, item.portions.length - 1) : 0;
  const portion = hasPortions ? (item.portions[activePortion] || item.portions[0]) : item;
  // portionBody is provided as a shared helper outside orderItemCard
  const portionKey = hasPortions ? `${uid}:${activePortion}` : `${uid}`;
  return `<article class="cart-card" data-cart-uid="${uid}">
    <div class="row-between">
      <div class="cart-card-title"><strong>${escapeHtml(item.name)}</strong><div class="small muted">${money(item.price)} по ставка</div></div>
      <div class="cart-card-actions">
        ${!beverage ? `<button type="button" class="icon-button customize-shortcut-btn ${isItemOpen ? "is-open" : ""}" title="${isItemOpen ? "Затвори прилагодување" : "Прилагоди"}" aria-label="Прилагоди ${escapeHtml(item.name)}" data-customize-item="${uid}">${isItemOpen ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"></polyline></svg>` : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>`}</button>` : ""}
        <button type="button" class="icon-button cart-remove-btn" title="Отстрани ставка" aria-label="Отстрани ${escapeHtml(item.name)}" data-remove-item="${uid}">x</button>
      </div>
    </div>
    <div class="quantity-row">
      <span>Количина</span>
      <div class="quantity-control" role="group" aria-label="Количина за ${escapeHtml(item.name)}">
        <button type="button" data-quantity="${uid}" data-delta="-1" aria-label="Намали количина" ${item.quantity <= 1 ? 'disabled aria-disabled="true"' : ""}>-</button>
        <strong data-qty-display="${uid}">${item.quantity}</strong>
        <button type="button" data-quantity="${uid}" data-delta="1" aria-label="Зголеми количина">+</button>
      </div>
    </div>
    ${beverage ? "" : `
      <details class="food-customization-accordion" ${isOpen}>
        <summary class="food-customization-summary">
          <span class="customization-title">Прилагоди<small data-mod-summary="${uid}">${summary ? escapeHtml(summary) : "Состав . додатоци . алергија"}</small></span>
          <span class="accordion-arrow" aria-hidden="true">${ICON_CHEVRON_DOWN}</span>
        </summary>
        <div class="food-customization-body">
          ${hasPortions ? `
            <div class="portion-tabs-container">
              <span class="portion-tabs-label">Избери порција (${item.quantity} вкупно):</span>
              <div class="portion-tabs" role="tablist" aria-label="Порција">
                ${item.portions.map((_, i) => `<button type="button" role="tab" class="portion-tab${i === activePortion ? " portion-tab-active" : ""}" data-portion-tab="${uid}" data-portion-index="${i}" aria-selected="${i === activePortion}">Порција ${i + 1}</button>`).join("")}
              </div>
            </div>
            <p class="small muted portion-tab-hint">Порција ${activePortion + 1} од ${item.quantity} - прилагоди посебно</p>
          ` : ""}
          ${portionBody(portion, portionKey, item)}
        </div>
      </details>
    `}
  </article>`;
}

function trayChip(item) {
  const name = escapeHtml(item.name);
  const itemTotal = money(item.price * item.quantity);
  const bev = isBeverage(item);
  return `<div class="tray-chip" data-chip-uid="${item.uid}" role="listitem">
    <div class="tray-chip-header">
      <div class="tray-chip-info">
        <strong class="tray-chip-title" title="${name}">${name}</strong>
        <span class="tray-chip-price" data-chip-price="${item.uid}">${itemTotal}</span>
      </div>
      <div class="tray-chip-actions">
        ${!bev ? `<button type="button" class="tray-customize-btn ${state.openAccordions.has(item.uid) ? "is-open" : ""}" data-customize-item="${item.uid}" title="${state.openAccordions.has(item.uid) ? "Затвори прилагодување" : "Прилагоди"}" aria-label="Прилагоди ${name}">${state.openAccordions.has(item.uid) ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"></polyline></svg>` : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>`}</button>` : ""}
        <button type="button" class="tray-remove-btn" data-remove-item="${item.uid}" title="Избриши ${name}" aria-label="Избриши ${name}">x</button>
      </div>
    </div>
    <div class="tray-chip-stepper">
      <button type="button" class="tray-step-btn" data-quantity="${item.uid}" data-delta="-1" aria-label="Намали ${name}" ${item.quantity <= 1 ? 'disabled aria-disabled="true"' : ""}>-</button>
      <span class="tray-chip-qty" data-qty-display="${item.uid}">${item.quantity}</span>
      <button type="button" class="tray-step-btn" data-quantity="${item.uid}" data-delta="1" aria-label="Зголеми ${name}">+</button>
    </div>
  </div>`;
}

function orderTray(table, totals) {
  return `<div class="compact-summary-tray" role="region" aria-label="Брз преглед на нарачката">
    <div class="tray-chips" role="list">${state.cart.map(trayChip).join("")}</div>
    <div class="tray-bottom-row">
      <div class="tray-total-info">
        <span class="tray-total-label">Маса ${table?.number ?? ""} . <span data-cart-count>${totals.quantity}</span> ставки</span>
        <span class="tray-total-amount" data-cart-total>${money(totals.total)}</span>
      </div>
      <div class="tray-actions">
        <button type="button" class="tray-toggle-btn" data-action="toggle-cart-details" aria-expanded="${state.cartExpanded}">
          <span>${state.cartExpanded ? "Скриј детали" : "Детали"}</span>
          <span class="tray-toggle-arrow" aria-hidden="true">${state.cartExpanded ? ICON_CHEVRON_SMALL_UP : ICON_CHEVRON_SMALL_DOWN}</span>
        </button>
        <button type="button" class="tray-send-btn" data-action="send-order">
          <span>Испрати</span>
        </button>
      </div>
    </div>
  </div>`;
}

// Update every number that depends on cart quantities without rebuilding the
// page. Keeps scroll position, focus and open accordions untouched while the
// waiter taps + / - quickly.
function syncCartUI() {
  const totals = cartTotals();
  for (const entry of state.cart) {
    document.querySelectorAll(`[data-qty-display="${entry.uid}"]`).forEach((node) => {
      node.textContent = entry.quantity;
    });
    document.querySelectorAll(`[data-chip-price="${entry.uid}"]`).forEach((node) => {
      node.textContent = money(entry.price * entry.quantity);
    });
    document.querySelectorAll(`[data-quantity="${entry.uid}"][data-delta="-1"]`).forEach((button) => {
      const disabled = entry.quantity <= 1;
      button.disabled = disabled;
      button.setAttribute("aria-disabled", String(disabled));
    });
  }
  document.querySelectorAll("[data-cart-count]").forEach((node) => { node.textContent = totals.quantity; });
  document.querySelectorAll("[data-cart-total]").forEach((node) => { node.textContent = money(totals.total); });
}

// Rebuild only the cart list and the tray chips when a line is added or
// removed, leaving the menu grid and the page scroll untouched.
function renderCartRegions() {
  const list = document.getElementById("cart-list");
  if (list) list.innerHTML = state.cart.map(orderItemCard).join("");
  const chips = document.querySelector(".tray-chips");
  if (chips) {
    const scrollTop = chips.scrollTop;
    chips.innerHTML = state.cart.map(trayChip).join("");
    chips.scrollTop = scrollTop;
  }
  syncCartUI();
}

function refreshModSummary(uid) {
  const entry = cartEntry(uid);
  if (!entry) return;
  const summary = modificationSummary(entry);
  document.querySelectorAll(`[data-mod-summary="${uid}"]`).forEach((node) => {
    node.textContent = summary || "Состав . додатоци . алергија";
  });
}

function newOrderView() {
  const table = state.tables.find((entry) => entry.id === state.tableId);
  const categories = [...new Set(state.menu.map((item) => item.category))];
  const visible = state.menu.filter((item) => (!state.category || item.category === state.category) && item.name.toLowerCase().includes(state.search.toLowerCase()));
  const totals = cartTotals();
  const hasCart = state.cart.length > 0;
  const cartOpen = state.cartExpanded && hasCart;
  const customizingItem = state.customizingItemUid ? state.cart.find((e) => e.uid === state.customizingItemUid) : null;
  const custModal = customizingItem ? customizationModal(customizingItem) : "";
  return `${custModal}<div class="page-heading compact-heading">
      <div class="page-heading-main">
        <p class="eyebrow">НОВО ИСПРАЌАЊЕ</p>
        <h1>Нарачка за маса ${table?.number ?? ""}</h1>
      </div>
      <div class="page-heading-actions">
        <button class="back-btn" data-action="back-detail"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="M12 5l-7 7 7 7"/></svg> Назад кон маса ${table?.number ?? ""}</button>
      </div>
    </div>
    <div class="order-builder ${cartOpen ? "cart-is-expanded" : "cart-is-collapsed"}">
      <section class="menu-panel">
        <div class="menu-controls">
          <label class="search-input">${ICON_MAGNIFY}<input id="menu-search" value="${escapeHtml(state.search)}" placeholder="Пребарај мени" aria-label="Пребарај мени" /></label>
          <div class="category-tabs">${categories.map((category) => `<button class="category-button ${category === state.category ? "active" : ""}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join("")}</div>
        </div>
        ${visible.length ? `<div class="menu-grid">${visible.map((item) => `<button class="menu-item" data-add-menu="${item.id}">
          <span class="menu-category">${escapeHtml(item.category)}</span>
          <strong>${escapeHtml(item.name)}</strong>
          <span class="menu-ingredients">${item.ingredients.map(escapeHtml).join(" . ") || ""}</span>
          <span class="menu-price">${money(item.price)}</span>
          <span class="add-indicator">+</span>
        </button>`).join("")}</div>` : `<div class="empty-inline">Нема ставки што одговараат на пребарувањето.</div>`}
      </section>
      <aside class="cart-panel" id="cart-panel" aria-label="Кошничка">
        <div class="cart-heading">
          <div><p class="eyebrow">ДЕТАЛЕН ПРЕГЛЕД</p><h2>Кошничка</h2></div>
          <span class="cart-count"><span data-cart-count>${totals.quantity}</span> ставки</span>
        </div>
        ${hasCart ? `
          <div class="cart-list" id="cart-list">${state.cart.map((item) => orderItemCard(item)).join("")}</div>
          <div class="cart-total"><span>Вкупно</span><strong data-cart-total>${money(totals.total)}</strong></div>
          <div class="allergy-disclaimer">Алергија: отстранувањето состојка не гарантира безбедност. Ресторанот мора да провери и можност за вкрстена контаминација.</div>
          <button class="button button-primary button-wide" data-action="send-order">Испрати нарачка</button>
        ` : `<div class="cart-empty"><span>+</span><p>Изберете ставки од менито лево.</p></div>`}
      </aside>
    </div>
    ${hasCart ? orderTray(table, totals) : ""}`;
}

function itemActions(item) {
  if (item.status === "needs_confirmation" && item.allergies.length) {
    return `<div class="station-actions"><button type="button" class="button button-primary" data-item-action="allergy_approve" data-item="${item.id}">Може да се подготви</button><button type="button" class="button button-danger" data-item-action="allergy_reject" data-item="${item.id}">Не може безбедно да се подготви</button></div>`;
  }
  if (item.status === "needs_confirmation" && item.pending_request) {
    const request = item.pending_request;
    return `<div class="request-pending"><strong>Келнерот бара ${request.action === "cancel" ? "откажување" : "измена"}.</strong>${request.changes.note ? `<span>Забелешка: ${escapeHtml(request.changes.note)}</span>` : ""}${request.changes.removals?.length ? `<span>Без: ${request.changes.removals.map(escapeHtml).join(", ")}</span>` : ""}${request.changes.additions?.length ? `<span>Додади: ${request.changes.additions.map((entry) => escapeHtml(typeof entry === "string" ? entry : entry.name)).join(", ")}</span>` : ""}<div class="station-actions"><button type="button" class="button button-primary" data-request-decision="approve" data-item="${item.id}" data-request="${request.id}">${request.action === "cancel" ? "Потврди откажување" : "Одобри измена"}</button><button type="button" class="button button-danger" data-request-decision="reject" data-item="${item.id}" data-request="${request.id}">Одбиј барање</button></div></div>`;
  }
  if (item.status === "received" || item.status === "preparing") {
    return `<div class="station-actions"><button type="button" class="button button-primary" data-item-action="ready" data-item="${item.id}">Готово</button></div>`;
  }
  return "";
}

function stationGroups() {
  const groups = new Map();
  for (const item of state.queue) {
    const number = item.table?.number;
    if (!groups.has(number)) groups.set(number, { number, items: [] });
    groups.get(number).items.push(item);
  }
  return Array.from(groups.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([number, group]) => ({ number, items: group.items }));
}

function stationView(station) {
  const title = station === "kitchen" ? "Кујна" : "Бар";
  const groups = stationGroups();
  const emptyState = `<section class="empty-state"><div class="empty-icon">${ICON_CHECK}</div><h2>Нема ставки за подготовка</h2><p>Новите нарачки ќе се појават тука автоматски.</p></section>`;
  const queueContent = groups.length ? groups.map((group) => {
    const totalPortions = group.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
    const readyPortions = group.items.reduce((sum, item) => sum + (Number(item.ready_quantity) || 0), 0);
    const counterText = readyPortions > 0 ? `${readyPortions} од ${totalPortions} готови` : "";
    const readyable = group.items.filter((item) => item.status === "received" || item.status === "preparing");
    return `<section class="station-group">
      <header class="station-group-head">
        <div class="station-group-info">
          <span class="table-badge">Маса ${group.number}</span>
          <span class="small muted">${group.items.length} ${group.items.length === 1 ? "ставка" : "ставки"} за подготовка</span>
          ${counterText ? `<span class="status-pill status-ready">${counterText}</span>` : ""}
        </div>
        ${readyable.length ? `<button type="button" class="button button-primary button-batch" data-batch-action="ready" data-item-ids="${readyable.map((i) => i.id).join(",")}">Сите готови</button>` : ""}
      </header>
      <div class="station-grid">
        ${group.items.map((item) => {
          const isDelayed = item.order_created_at && (Date.now() - new Date(item.order_created_at).getTime()) > 15 * 60 * 1000;
          return `<article class="${item.status === "needs_confirmation" ? "station-card station-allergy" : item.status === "ready" ? "station-card station-ready" : "station-card"}${isDelayed ? " station-delayed" : ""}">
          <div class="station-card-head"><div class="table-badge">Маса ${item.table?.number ?? ""}</div><div style="display:flex;align-items:center;gap:6px;">${isDelayed ? `<span class="kds-delay-badge" title="Чека повеќе од 15 минути">15 мин</span>` : ""}<span class="small muted">${formatTime(item.order_created_at)}</span></div></div>
          <div class="station-item-title"><h2>${escapeHtml(item.name)}</h2><span class="quantity-badge">${item.quantity}</span></div>
          <p class="small muted">Испраќање #${item.order_id} . Келнер: ${escapeHtml(item.waiter)}</p>
          ${item.status === "received" ? "" : statusPill(item.status)}
          ${item.ready_quantity ? `<p class="ready-progress">${item.ready_quantity} од ${item.quantity} готови (${item.ready_quantity - item.delivered_quantity} чекаат достава)</p>` : ""}
          ${item.removals.length ? `<p class="modifier-line">Без: ${item.removals.map(escapeHtml).join(", ")}</p>` : ""}
          ${item.additions.length ? `<p class="modifier-line">Додади: ${item.additions.map((entry) => escapeHtml(entry.name)).join(", ")}</p>` : ""}
          ${item.note ? `<p class="modifier-line">Желба: ${escapeHtml(item.note)}</p>` : ""}
          ${item.allergies.length ? `<div class="allergy-warning"><strong>АЛЕРГИЈА: ${item.allergies.map(escapeHtml).join(", ")}</strong><span>Проверете безбедна подготовка и ризик од вкрстена контаминација пред потврда.</span></div>` : ""}
          ${itemActions(item)}
        </article>`;
        }).join("")}
      </div>
    </section>`;
  }).join("") : emptyState;
  return `<div class="page-heading">
      <div>
        <p class="eyebrow">СТАНИЦА ЗА ПОДГОТОВКА</p>
        <h1>${title}</h1>
        <p class="muted">Нарачките се групирани по маса и се ажурираат автоматски во живо.</p>
      </div>
      <button class="button button-soft" data-action="refresh-queue">Освежи</button>
    </div>
    ${state.loading ? `<div class="loading-state" role="status">Се вчитува редицата...</div>` : queueContent}`;
}

function readyView() {
  const readyMap = new Map();
  for (const item of state.ready) {
    const num = item.table?.number ?? item.table_number;
    if (num !== undefined) {
      if (!readyMap.has(num)) readyMap.set(num, []);
      readyMap.get(num).push(item);
    }
  }

  // Check if selected table still has ready items
  if (state.selectedDeliveryTable !== null) {
    const items = readyMap.get(state.selectedDeliveryTable) || [];
    if (!items.length) {
      state.selectedDeliveryTable = null;
    }
  }

  const selectedTableNumber = state.selectedDeliveryTable;
  const selectedItems = selectedTableNumber !== null ? (readyMap.get(selectedTableNumber) || []) : [];
  const tableCards = state.tables.map((table) => {
    const items = readyMap.get(table.number) || [];
    const readyCount = items.reduce((sum, i) => sum + (Number(i.ready_quantity) - Number(i.delivered_quantity)), 0) || table.ready_items || 0;
    const totalReadyPortions = items.reduce((sum, i) => sum + (Number(i.ready_quantity) || 0), 0);
    const isGlowing = readyCount > 0;
    const isExpanded = selectedTableNumber === table.number;
    const waiterList = Array.from(new Set(items.map((i) => i.waiter_name).filter(Boolean)));
    const waiterTag = waiterList.length ? `<span class="delivery-waiter-tag">Келнер: ${waiterList.map(escapeHtml).join(", ")}</span>` : "";
    return `<button class="table-card delivery-table-card ${isGlowing ? "has-ready delivery-card-ready" : "delivery-card-empty"} ${isExpanded ? "delivery-card-selected" : ""}" ${isGlowing ? `data-delivery-table="${table.number}" data-ready-count="${readyCount}"` : `disabled aria-disabled="true"`}>
      <span class="table-number">${table.number}</span>
      <span class="table-label">Маса</span>
      ${isGlowing ? `
        <span class="ready-indicator delivery-glow-badge">${readyCount} од ${totalReadyPortions} готови</span>
        ${waiterTag}
        <span class="delivery-action-hint">Допрете за достава</span>
      ` : `
        <span class="delivery-empty-text">Нема готови ставки</span>
      `}
    </button>`;
  }).join("");
  const selectedModal = selectedTableNumber !== null && selectedItems.length ? `
    <div class="delivery-modal-overlay" data-modal-overlay="delivery" role="dialog" aria-modal="true" aria-labelledby="delivery-modal-title">
      <div class="delivery-modal-container">
        <header class="delivery-modal-header">
          <div class="delivery-modal-title">
            <span class="table-badge delivery-table-pill">Маса ${selectedTableNumber}</span>
            <h2 id="delivery-modal-title">Готови ставки (${selectedItems.length})</h2>
          </div>
          <div class="delivery-modal-actions">
            <button type="button" class="button button-primary button-batch button-compact-action" data-batch-action="deliver" data-item-ids="${selectedItems.map((i) => i.id).join(",")}">Достави се</button>
            <button type="button" class="back-btn delivery-modal-close" data-action="close-delivery-detail" aria-label="Назад" title="Назад"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="M12 5l-7 7 7 7"/></svg> Назад</button>
          </div>
        </header>
        <div class="delivery-modal-body">
          <div class="delivery-items-list">
            ${selectedItems.map((item) => `<article class="delivery-item-card">
              <div class="delivery-item-card-top">
                <div class="ready-item-title">
                  <h2>${escapeHtml(item.name)}</h2>
                  <span class="ready-delivery-badge">
                    <strong class="ready-qty-num">${item.ready_quantity - item.delivered_quantity}</strong>
                    <span class="ready-qty-label">за достава</span>
                  </span>
                </div>
                <div class="delivery-meta-row">
                  <span class="small muted">Испраќање #${item.order_id} - ${formatTime(item.order_created_at)}</span>
                  ${item.waiter_name ? `<span class="delivery-waiter-badge">Келнер: <strong>${escapeHtml(item.waiter_name)}</strong></span>` : ""}
                </div>
              </div>
              ${item.removals.length ? `<p class="modifier-line">Без: ${item.removals.map(escapeHtml).join(", ")}</p>` : ""}
              ${item.additions.length ? `<p class="modifier-line">Додади: ${item.additions.map((entry) => escapeHtml(entry.name)).join(", ")}</p>` : ""}
              ${item.note ? `<p class="modifier-line">Желба: ${escapeHtml(item.note)}</p>` : ""}
              <button type="button" class="button button-primary button-wide delivery-mark-btn" data-item-action="deliver" data-item="${item.id}">Означи како доставено</button>
            </article>`).join("")}
          </div>
        </div>
      </div>
    </div>
  ` : "";
  return `<div class="view-mode-banner mode-delivering">
      <div class="row-between" style="align-items: center; width: 100%;">
        <div>
          <span class="mode-badge">РЕЖИМ НА РАБОТА</span>
          <h1>ДОСТАВА НА НАРАЧКИ</h1>
        </div>
        <button class="button button-soft button-compact-action" data-action="refresh-ready">Освежи</button>
      </div>
    </div>
    ${state.loading ? `<div class="loading-state" role="status">Се вчитуваат готовите ставки...</div>` : `
      <section class="table-grid delivery-grid">${tableCards}</section>
      ${selectedModal}
    `}`;
}

function adminView() {
  const config = state.adminConfig || { categories: [], ingredients: [], tables: [], users: [], menu: [], restaurant: null, analytics: null };
  const categories = config.categories.map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join("");
  // Sleek selectable pill-tag grid for ingredients in dish management
  const ingredientChecks = (selected = []) => {
    if (!config.ingredients.length) {
      return `<p class="small muted">Нема дефинирано состојки. Додадете состојки во табот "Категории и состојки".</p>`;
    }
    // Highlight top 3 most expensive ingredients and pin them to the top
    const sorted = [...config.ingredients].sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
    const topThreeNames = new Set(sorted.slice(0, 3).map((i) => i.name));
    const ordered = [
      ...sorted.filter((i) => topThreeNames.has(i.name)),
      ...sorted.filter((i) => !topThreeNames.has(i.name))
    ];
    return `<div class="ingredient-selector-block">
      <div class="ingredient-search-bar">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="search" class="ingredient-search-input" placeholder="Пребарај состојка..." aria-label="Пребарај состојка" oninput="filterIngredients(this)" onkeydown="if(event.key==='Enter'){event.preventDefault();}" />
      </div>
      <div class="ingredient-grid">
        ${ordered.map((ingredient) => {
          const isChecked = selected.includes(ingredient.name);
          const isTop = topThreeNames.has(ingredient.name);
          const isVisible = isTop || isChecked;
          return `<label class="ingredient-pill ${isChecked ? "selected" : ""} ${isTop ? "ingredient-pill-top" : ""}" data-top="${isTop ? "true" : "false"}" style="${isVisible ? "" : "display: none;"}">
            <input type="checkbox" name="ingredients" value="${escapeHtml(ingredient.name)}" ${isChecked ? "checked" : ""}/>
            <span class="ingredient-checkbox-box" aria-hidden="true">${ICON_CHECK}</span>
            <span class="ingredient-pill-name">${escapeHtml(ingredient.name)}</span>
            ${isTop ? `<span class="top-ingredient-badge" title="Топ состојка">*</span>` : ""}
            ${ingredient.price ? `<span class="ingredient-pill-price">+${money(ingredient.price)}</span>` : ""}
          </label>`;
        }).join("")}
      </div>
    </div>`;
  };
  const currentTab = state.adminTab || "analytics";
  // Tab 0: Analytics Dashboard
  const analytics = config.analytics || {
    daily_revenue: 0,
    daily_orders: 0,
    daily_aov: 0,
    total_revenue: 0,
    total_orders: 0,
    total_aov: 0,
    top_items: [],
    waiter_sales: []
  };
  const maxItemCount = analytics.top_items.length ? Math.max(...analytics.top_items.map((i) => i.count || 0), 1) : 1;
  const analyticsTabContent = `<section class="admin-panel analytics-panel">
    <div class="admin-panel-head">
      <div>
        <h2>Статистика и аналитика</h2>
      </div>
      <span class="venue-tag">Валута: ${config.currency || "MKD"}</span>
    </div>
    <!-- Apple-style Metric Cards -->
    <div class="analytics-metrics-grid">
      <div class="analytics-metric-card">
        <div class="analytics-metric-head">
          <span class="analytics-metric-title">Дневен промет</span>
          <div class="analytics-metric-icon icon-blue">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          </div>
        </div>
        <div class="analytics-metric-value">${money(analytics.daily_revenue)}</div>
        <div class="analytics-metric-sub">Вкупно досега: <strong>${money(analytics.total_revenue)}</strong></div>
      </div>
      <div class="analytics-metric-card">
        <div class="analytics-metric-head">
          <span class="analytics-metric-title">Послужени нарачки</span>
          <div class="analytics-metric-icon icon-green">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          </div>
        </div>
        <div class="analytics-metric-value">${analytics.daily_orders} <small style="font-size:0.95rem; font-weight:600; color:var(--muted);">денес</small></div>
        <div class="analytics-metric-sub">Вкупно нарачки: <strong>${analytics.total_orders}</strong></div>
      </div>
      <div class="analytics-metric-card">
        <div class="analytics-metric-head">
          <span class="analytics-metric-title">Просечна нарачка (AOV)</span>
          <div class="analytics-metric-icon icon-orange">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
          </div>
        </div>
        <div class="analytics-metric-value">${money(analytics.daily_aov || analytics.total_aov)}</div>
        <div class="analytics-metric-sub">Просек на сите: <strong>${money(analytics.total_aov)}</strong></div>
      </div>
    </div>
    <!-- 2-Column Insights Grid -->
    <div class="analytics-insights-grid">
      <!-- Top 5 Selling Items -->
      <div class="analytics-card">
        <div class="analytics-card-header">
          <div>
            <h3>Топ 5 најпродавани ставки</h3>
            <p class="small muted">Најбарани јадења и пијалаци според бројот на нарачки</p>
          </div>
        </div>
        <div class="analytics-top-list">
          ${analytics.top_items && analytics.top_items.length ? analytics.top_items.map((item, idx) => `
            <div class="analytics-item-row">
              <div class="analytics-rank-badge rank-${idx + 1}">#${idx + 1}</div>
              <div class="analytics-item-info">
                <div class="analytics-item-name-row">
                  <span class="analytics-item-name">${escapeHtml(item.name)}</span>
                  <span class="analytics-item-earnings">${money(item.revenue)}</span>
                </div>
                <div class="analytics-progress-track">
                  <div class="analytics-progress-bar" style="width: ${Math.round(((item.count || 0) / maxItemCount) * 100)}%;"></div>
                </div>
                <div class="analytics-item-count">${item.count} нарачани порции</div>
              </div>
            </div>
          `).join("") : `<p class="muted small" style="padding:16px 0;">Сe уште нема регистрирано нарачки.</p>`}
        </div>
      </div>
      <!-- Staff Sales Breakdown -->
      <div class="analytics-card">
        <div class="analytics-card-header">
          <div>
            <h3>Продажба по персонал</h3>
            <p class="small muted">Број на реализирани нарачки и промет генериран по келнер</p>
          </div>
        </div>
        <div class="analytics-staff-list">
          ${analytics.waiter_sales && analytics.waiter_sales.length ? analytics.waiter_sales.map((waiter) => `
            <div class="analytics-staff-row">
              <div class="analytics-staff-avatar">
                ${escapeHtml((waiter.name || "K").charAt(0).toUpperCase())}
              </div>
              <div class="analytics-staff-details">
                <span class="analytics-staff-name">${escapeHtml(waiter.name)}</span>
                <span class="analytics-staff-orders">${waiter.orders_count} нарачки</span>
              </div>
              <div class="analytics-staff-revenue">
                <span class="analytics-staff-sum">${money(waiter.revenue)}</span>
              </div>
            </div>
          `).join("") : `<p class="muted small" style="padding:16px 0;">Нема податоци за продажба по келнери.</p>`}
        </div>
      </div>
    </div>
  </section>`;
  // Tab 1: Menu & Items
  const menuTabContent = `<section class="admin-panel">
    <div class="admin-panel-head">
      <div>
        <h2>Мени и ставки</h2>
      </div>
      <span class="venue-tag">Валута: ${config.currency || "MKD"}</span>
    </div>
    <form class="admin-form" data-admin-create="menu">
      <h3><span>+</span> Додади нова ставка во менито</h3>
      <div class="admin-form-grid">
        <label>Име на јадење / пијалак<input name="name" placeholder="На пр. Пица Капричоза" required maxlength="120" /></label>
        <label>Категорија<select name="category_id" required>${categories}</select></label>
        <label>Станица за подготовка<select name="station"><option value="kitchen">Кујна</option><option value="bar">Бар</option></select></label>
        <label>Цена (${config.currency || "MKD"})<input name="price" type="number" min="0" step="1" value="0" required /></label>
      </div>
      <div>
        <p class="small" style="font-weight:700; color:#3f554d; margin: 4px 0 6px;">Составни состојки (ова не е задолжително)</p>
        ${ingredientChecks()}
      </div>
      <button class="button button-primary" type="submit">Додади во мени</button>
    </form>
    <div class="admin-records-header" style="margin-top:28px;">
      <div class="row-between">
        <div>
          <h3>Актуелно мени (${config.menu.length} ставки)</h3>
          <p class="small muted">Кликнете на иконата за уредување за измена на цената, категоријата, состојките и станицата.</p>
        </div>
      </div>
    </div>
    <div class="menu-accordion-list" role="list">
      ${config.menu.map((item) => {
        const isOpen = state.editingMenuId === item.id;
        return `
        <div class="menu-accordion-item ${isOpen ? "open" : ""}" data-menu-item-id="${item.id}" role="listitem">
          <div class="admin-menu-row">
            <div class="admin-menu-row-info">
              <strong class="admin-menu-row-name">${escapeHtml(item.name)}</strong>
              <div class="admin-menu-row-meta">
                <span class="admin-station-tag ${item.station === "kitchen" ? "admin-station-kitchen" : "admin-station-bar"}">${item.station === "kitchen" ? "Кујна" : "Бар"}</span>
                <span class="small muted">${escapeHtml(item.category)}</span>
                ${!item.active ? `<span class="status-pill status-inactive">Неактивна</span>` : ""}
              </div>
            </div>
            <div class="admin-menu-row-right">
              <span class="admin-menu-row-price">${money(item.price)}</span>
              <button type="button" class="staff-edit-btn menu-edit-btn ${isOpen ? "active" : ""}" data-edit-menu="${item.id}" aria-label="Уреди ставка" title="Уреди ставка">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M12 20h9"/>
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                </svg>
              </button>
            </div>
          </div>
          ${isOpen ? `
          <div class="menu-drawer">
            <form class="admin-form menu-edit-form" data-admin-update="menu" data-id="${item.id}">
              <div class="menu-drawer-grid">
                <label class="menu-drawer-field">
                  <span>Име на ставка</span>
                  <input name="name" value="${escapeHtml(item.name)}" required maxlength="120" />
                </label>
                <label class="menu-drawer-field">
                  <span>Категорија</span>
                  <select name="category_id">${config.categories.map((category) => `<option value="${category.id}" ${category.name === item.category ? "selected" : ""}>${escapeHtml(category.name)}</option>`).join("")}</select>
                </label>
                <label class="menu-drawer-field">
                  <span>Станица</span>
                  <select name="station">
                    <option value="kitchen" ${item.station === "kitchen" ? "selected" : ""}>Кујна</option>
                    <option value="bar" ${item.station === "bar" ? "selected" : ""}>Бар</option>
                  </select>
                </label>
                <label class="menu-drawer-field">
                  <span>Цена (${config.currency || "MKD"})</span>
                  <input name="price" type="number" min="0" step="1" value="${item.price}" required />
                </label>
              </div>
              <div class="menu-drawer-active-row">
                <label class="ios-switch" title="Активна ставка">
                  <input type="checkbox" class="ios-switch-input" name="active" ${item.active ? "checked" : ""}/>
                  <span class="ios-switch-track" aria-hidden="true"><span class="ios-switch-thumb"></span></span>
                </label>
                <span class="menu-drawer-active-label">Активна во менито</span>
              </div>
              <div class="menu-drawer-ingredients">
                <p class="small" style="font-weight:700; color:#374151; margin: 4px 0 8px;">Составни состојки</p>
                ${ingredientChecks(item.ingredients)}
              </div>
              <div class="menu-drawer-actions">
                <button type="submit" class="button button-primary">Зачувај измени</button>
                <button type="button" class="button button-soft" data-close-menu-drawer="${item.id}">Откажи</button>
              </div>
            </form>
          </div>` : ""}
        </div>`;
      }).join("")}
    </div>
  </section>`;
  // Tab 2: Categories & Ingredients
  const categoriesTabContent = `<section class="admin-panel">
    <div class="admin-panel-head">
      <div>
        <h2>Категории и состојки</h2>
      </div>
    </div>
    <div class="admin-split">
      <div class="admin-card-section" id="admin-section-categories">
        <h3>Категории на менито</h3>
        <form class="admin-form compact-admin-form" data-admin-create="category">
          <label>Име на нова категорија<input name="name" required maxlength="120" placeholder="На пр. Десерти, Салати" /></label>
          <button class="button button-soft" type="submit">Додади</button>
        </form>
        <div class="admin-records">${config.categories.map((item) => `<form class="admin-record admin-record-small" data-admin-update="category" data-id="${item.id}">
          <label>Категорија<input name="name" value="${escapeHtml(item.name)}" required maxlength="120" /></label>
          <button class="button button-soft" type="submit">Зачувај</button>
        </form>`).join("")}</div>
      </div>
      <div class="admin-card-section" id="admin-section-ingredients">
        <div class="row-between" style="margin-bottom: 8px;">
          <h3 style="margin: 0;">Состојки и дополнителни додатоци</h3>
          <span class="small muted">${config.ingredients.length} ${config.ingredients.length === 1 ? "состојка" : "состојки"}</span>
        </div>
        <form class="admin-form compact-admin-form" data-admin-create="ingredient">
          <label>Име на состојка<input name="name" required maxlength="120" placeholder="На пр. дополнителни маслинки" /></label>
          <label>Дополнителна цена (${config.currency || "MKD"})<input name="price" type="number" min="0" value="0" required /></label>
          <button class="button button-soft" type="submit">Додади</button>
        </form>
        <div class="admin-ingredient-search-wrapper" style="margin: 12px 0 10px;">
          <label class="search-input" style="height: 42px;">
            ${ICON_MAGNIFY}
            <input id="admin-ingredient-search" value="${escapeHtml(state.adminIngredientSearch || "")}" placeholder="Пребарај состојка..." aria-label="Пребарај состојка..." />
          </label>
        </div>
        <div class="admin-records admin-ingredient-scroll">
          ${(() => {
            const ingQuery = (state.adminIngredientSearch || "").toLowerCase().trim();
            const visibleIngredients = config.ingredients.filter((item) => item.name.toLowerCase().includes(ingQuery));
            if (!visibleIngredients.length) {
              return `<div class="empty-inline" style="padding: 16px; text-align: center;">Нема пронајдено состојки${ingQuery ? ` за "${escapeHtml(state.adminIngredientSearch)}"` : ""}.</div>`;
            }
            return visibleIngredients.map((item) => `<form class="admin-record admin-record-small" data-admin-update="ingredient" data-id="${item.id}">
              <label>Состојка<input name="name" value="${escapeHtml(item.name)}" required maxlength="120" /></label>
              <label>Цена<input name="price" type="number" min="0" value="${item.price}" required /></label>
              <button class="button button-soft" type="submit">Зачувај</button>
            </form>`).join("");
          })()}
        </div>
      </div>
    </div>
  </section>`;
  // Tab 3: Tables & Staff
  const tablesTabContent = `<section class="admin-panel">
    <div class="admin-panel-head">
      <div>
        <h2>Маси и персонал</h2>
      </div>
    </div>
    <div class="admin-split">
      <div class="admin-card-section">
        <h3>Распоред на маси</h3>
        <form class="admin-form compact-admin-form" data-admin-create="table">
          <label>Број на нова маса<input name="number" type="number" min="1" max="200" required placeholder="1, 2, 3..." /></label>
          <button class="button button-soft" type="submit">Додади маса</button>
        </form>
        <div class="admin-tables-grid">${config.tables.map((table) => `
          <div class="admin-table-pill ${table.active ? "table-active" : "table-inactive"}" data-table-id="${table.id}" data-table-number="${table.number}">
            <span class="admin-table-pill-label">Маса ${table.number}</span>
            <label class="ios-switch" title="Маса ${table.number}: ${table.active ? "Активна" : "Неактивна"}">
              <input type="checkbox" class="ios-switch-input" data-table-toggle="${table.id}" data-table-number="${table.number}" ${table.active ? "checked" : ""}/>
              <span class="ios-switch-track" aria-hidden="true">
                <span class="ios-switch-thumb"></span>
              </span>
            </label>
          </div>`).join("")}</div>
      </div>
      <div class="admin-card-section" id="admin-section-staff">
        <h3>Персонал и улоги</h3>
        <form class="admin-form" data-admin-create="user" style="padding:16px; margin:0 0 16px;">
          <h4 style="margin:0 0 8px; font-size:.95rem;">Додади нов вработен</h4>
          <div class="admin-form-grid" style="grid-template-columns: 1fr 1fr;">
            <label>Корисничко име<input name="username" required maxlength="60" placeholder="waiter2" /></label>
            <label>Прикажано име<input name="name" required maxlength="120" placeholder="Име и презиме" /></label>
            <label>Улога<select name="role"><option value="waiter">Келнер</option><option value="kitchen">Кујна</option><option value="bar">Бар</option><option value="admin">Администратор</option></select></label>
            <label>Лозинка<input name="password" type="text" minlength="6" required placeholder="Внесете лозинка" /></label>
            <label>Брз PIN код
              <input name="pin" type="text" maxlength="4" pattern="[0-9]{4}" inputmode="numeric" required placeholder="4 бројки" style="letter-spacing:0.2em;font-weight:700;" />
            </label>
          </div>
          <button class="button button-primary" type="submit" style="width:fit-content; margin-top:6px;">Додади вработен</button>
        </form>
        <div class="staff-accordion-list">${config.users.map((person) => {
          const isOpen = state.editingUserId === person.id;
          return `
          <div class="staff-accordion-item ${isOpen ? "open" : ""}" data-staff-id="${person.id}">
            <div class="staff-row">
              <span class="staff-row-name">${escapeHtml(person.name || person.username)}</span>
              <div class="staff-row-controls">
                <label class="ios-switch" title="${escapeHtml(person.name || person.username)}: ${person.active ? "Активен" : "Неактивен"}">
                  <input type="checkbox" class="ios-switch-input" data-user-toggle="${person.id}" ${person.active ? "checked" : ""}/>
                  <span class="ios-switch-track" aria-hidden="true">
                    <span class="ios-switch-thumb"></span>
                  </span>
                </label>
                <button type="button" class="staff-edit-btn ${isOpen ? "active" : ""}" data-edit-user="${person.id}" aria-label="Уреди">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M12 20h9"/>
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                  </svg>
                </button>
              </div>
            </div>
            ${isOpen ? `
            <div class="staff-drawer">
              <form class="admin-form staff-edit-form" data-admin-update="user" data-id="${person.id}">
                <div class="staff-drawer-grid">
                  <label>Корисничко име<input value="${escapeHtml(person.username)}" disabled /></label>
                  <label>Прикажано име<input name="name" value="${escapeHtml(person.name)}" required maxlength="120" placeholder="Име и презиме" /></label>
                  <label>Улога<select name="role">
                    <option value="waiter" ${person.role === "waiter" ? "selected" : ""}>Келнер</option>
                    <option value="kitchen" ${person.role === "kitchen" ? "selected" : ""}>Кујна</option>
                    <option value="bar" ${person.role === "bar" ? "selected" : ""}>Бар</option>
                    <option value="admin" ${person.role === "admin" ? "selected" : ""}>Администратор</option>
                  </select></label>
                  <label>Брз PIN код
                    <input name="pin" type="text" maxlength="4" pattern="[0-9]{4}" inputmode="numeric" value="${escapeHtml(person.pin || '')}" placeholder="4 бројки" style="letter-spacing:0.2em;font-weight:700;" />
                  </label>
                  <label>Нова лозинка
                    <input name="password" type="text" minlength="6" placeholder="Остави празно ако нема промена" />
                  </label>
                </div>
                <div class="staff-drawer-bottom">
                  <div class="staff-drawer-active-row">
                    <label class="ios-switch" title="Активен">
                      <input type="checkbox" class="ios-switch-input" name="active" ${person.active ? "checked" : ""}/>
                      <span class="ios-switch-track" aria-hidden="true"><span class="ios-switch-thumb"></span></span>
                    </label>
                    <span class="staff-drawer-active-label">Активен статус</span>
                  </div>
                  <div class="staff-drawer-actions">
                    <button class="button button-primary" type="submit">Зачувај</button>
                    <button class="button button-soft" type="button" data-close-staff-drawer="${person.id}">Откажи</button>
                  </div>
                </div>
              </form>
            </div>` : ""}
          </div>`;
        }).join("")}</div>
      </div>
    </div>
  </section>`;
  return `<div class="page-heading">
      <div>
        <p class="eyebrow">ПОСТАВКИ НА РЕСТОРАНОТ</p>
        <h1>Администрација</h1>
      </div>
    </div>
    <div class="admin-layout">
      <!-- Desktop Left Sidebar (@media (min-width: 769px)) -->
      <aside class="admin-sidebar" aria-label="Администраторско мени">
        <div class="admin-sidebar-header">
          <span class="admin-sidebar-title">Админ Модули</span>
          <span class="admin-sidebar-venue">${escapeHtml(config.restaurant?.name || "Ресторан")}</span>
        </div>
        <nav class="admin-sidebar-nav">
          <button type="button" class="admin-nav-item ${currentTab === "analytics" ? "active" : ""}" data-admin-tab="analytics">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>
            <span>Статистика</span>
          </button>
          <button type="button" class="admin-nav-item ${currentTab === "menu" ? "active" : ""}" data-admin-tab="menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
            <span>Мени и цени</span>
            <span class="nav-badge">${config.menu.length}</span>
          </button>
          <button type="button" class="admin-nav-item ${currentTab === "categories" ? "active" : ""}" data-admin-tab="categories">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            <span>Категории и состојки</span>
            <span class="nav-badge">${config.categories.length + config.ingredients.length}</span>
          </button>
          <button type="button" class="admin-nav-item ${currentTab === "tables" ? "active" : ""}" data-admin-tab="tables">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <span>Маси и персонал</span>
            <span class="nav-badge">${config.tables.length + config.users.length}</span>
          </button>
        </nav>
      </aside>
      <!-- Admin Main Content Area -->
      <main class="admin-main">
        ${currentTab === "analytics" ? analyticsTabContent : currentTab === "menu" ? menuTabContent : currentTab === "categories" ? categoriesTabContent : tablesTabContent}
      </main>
    </div>`;
}

function superAdminView() {
  return `<div class="page-heading">
      <div>
        <p class="eyebrow"><span class="super-admin-badge">СУПЕР-АДМИНИСТРАЦИЈА</span></p>
        <h1>Управување со ресторани</h1>
        <p class="muted">Креирајте и конфигурирајте ресторани и доделувајте почетни администратори.</p>
      </div>
      <button class="button button-soft" data-action="refresh-restaurants">Освежи листа</button>
    </div>
    <section class="admin-panel">
      <h2>Нов ресторан (Multi-Restaurant)</h2>
      <form id="create-restaurant-form" class="admin-form">
        <div class="admin-form-grid">
          <label>Име на ресторан<input name="name" required maxlength="120" placeholder="На пр. Пицерија Рома" /></label>
          <label>Кратенка (Slug)<input name="slug" required maxlength="50" placeholder="На пр. pizzeriaroma" /></label>
          <label>Валута<select name="currency"><option value="MKD" selected>MKD (Денари)</option><option value="EUR">EUR (EUR)</option><option value="USD">USD ($)</option></select></label>
          <label>Почетен админ корисник<input name="admin_username" required maxlength="60" placeholder="На пр. roma_admin" /></label>
        </div>
        <label style="max-width:320px;">Лозинка за админ<input name="admin_password" type="text" minlength="6" value="demo123" required /></label>
        <button class="button button-primary" type="submit">Создади ресторан</button>
      </form>
    </section>
    <section class="admin-panel">
      <h2>Активни ресторани (${state.restaurants.length})</h2>
      ${state.restaurants.length ? `<div class="ticket-list">${state.restaurants.map((rest) => `<article class="restaurant-card">
        <div class="restaurant-card-header">
          <div>
            <strong style="font-size:1.15rem;">${escapeHtml(rest.name)}</strong>
            <span class="small muted"> . slug: <code>${escapeHtml(rest.slug)}</code> . валута: <strong>${escapeHtml(rest.currency)}</strong></span>
            ${rest.admin_username ? `<span class="small muted"> . админ: <code>${escapeHtml(rest.admin_username)}</code></span>` : ""}
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="status-pill status-ready">${rest.active ? "Активен" : "Неактивен"}</span>
            <button type="button" class="button button-soft button-sm" data-edit-restaurant="${rest.id}">Измени</button>
          </div>
        </div>
        <div class="restaurant-stats">
          <span>${rest.tables_count ?? 0} маси</span>
          <span>${rest.staff_count ?? 0} вработени</span>
          <span>${rest.menu_count ?? 0} ставки во мени</span>
        </div>
      </article>`).join("")}</div>` : `<p class="muted">Нема креирани ресторани.</p>`}
    </section>
    <!-- Super Admin Restaurant Edit Modal -->
    ${(() => {
      if (!state.editingRestaurantId) return "";
      const rest = state.restaurants.find((entry) => entry.id === state.editingRestaurantId);
      if (!rest) return "";
      return `<div class="admin-modal-overlay" data-modal-close="restaurant-edit" role="dialog" aria-modal="true" aria-labelledby="edit-rest-title">
        <div class="admin-modal-card">
          <div class="admin-modal-head">
            <div>
              <p class="eyebrow">СУПЕР-АДМИНИСТРАЦИЈА</p>
              <h2 id="edit-rest-title">${escapeHtml(rest.name)}</h2>
            </div>
            <button type="button" class="modal-close-btn" data-action="close-restaurant-modal" aria-label="Затвори">x</button>
          </div>
          <form class="admin-modal-body" data-admin-update="restaurant" data-id="${rest.id}">
            <div class="admin-modal-form-grid">
              <label class="admin-modal-field">
                <span>Име на ресторан</span>
                <input name="name" value="${escapeHtml(rest.name)}" required maxlength="120" />
              </label>
              <label class="admin-modal-field">
                <span>Кратенка (Slug)</span>
                <input name="slug" value="${escapeHtml(rest.slug)}" required maxlength="50" />
              </label>
              <label class="admin-modal-field">
                <span>Валута</span>
                <select name="currency">
                  <option value="MKD" ${rest.currency === "MKD" ? "selected" : ""}>MKD (Денари)</option>
                  <option value="EUR" ${rest.currency === "EUR" ? "selected" : ""}>EUR (EUR)</option>
                  <option value="USD" ${rest.currency === "USD" ? "selected" : ""}>USD ($)</option>
                </select>
              </label>
              <label class="admin-modal-field">
                <span>Админ корисничко име</span>
                <input name="admin_username" value="${escapeHtml(rest.admin_username || "")}" placeholder="На пр. roma_admin" maxlength="60" />
              </label>
            </div>
            <div class="admin-modal-field" style="margin-top: 4px;">
              <span>Ресетирај лозинка за админ</span>
              <input name="admin_password" type="text" minlength="6" placeholder="Оставете празно ако нема промена" />
              <p class="small muted" style="margin: 4px 0 0;">Внесете нова лозинка (мин. 6 знаци) само доколку сакате да ја ресетирате.</p>
            </div>
            <div class="admin-modal-active-row">
              <label class="inline-check">
                <input name="active" type="checkbox" ${rest.active ? "checked" : ""}/>
                <span>Активен ресторан во системот</span>
              </label>
            </div>
            <div class="admin-modal-actions">
              <button type="button" class="button button-soft" data-action="close-restaurant-modal">Откажи</button>
              <button type="submit" class="button button-primary">Зачувај измени</button>
            </div>
          </form>
        </div>
      </div>`;
    })()}`;
}

function hideSplashScreen() {
  state.isSplash = false;
  const splashEl = document.querySelector("#splash-screen") || document.querySelector(".splash-screen") || document.querySelector(".splash-container");
  if (splashEl) {
    splashEl.style.display = "none";
    splashEl.classList.add("hidden");
    // Also remove from DOM after fade out transition completes
    setTimeout(() => {
      try { splashEl.remove(); } catch (_) {}
    }, 450);
  }
}

function renderFailSafe(error) {
  console.error("[render] fatal UI error:", error);
  if (!app) return;
  document.body.classList.remove("kds-dark", "order-tray-open", "order-taking-mode", "delivery-mode", "profile-mode");
  app.innerHTML = `<main class="login-page">
    <section class="login-card" style="text-align:center;max-width:440px">
      <div class="brand-mark" aria-hidden="true">M</div>
      <p class="eyebrow">MAESTRO SMARTRESTO POS</p>
      <h1>Апликацијата не може да се прикаже</h1>
      <p class="muted">Настана неочекувана грешка при вчитувањето. Освежете ја страницата за да продолжите.</p>
      <button class="button button-primary button-wide" type="button" onclick="window.location.reload()">Освежи</button>
    </section>
  </main>`;
}



function render() {
  try {
    renderView();
  } catch (error) {
    renderFailSafe(error);
  }

}



function renderView() {
  if (!app) return;
  if (state.isSplash) {
    document.body.classList.remove("kds-dark", "order-tray-open", "profile-mode");
    // If the overlay exists in DOM, it displays the splash
    return;
  }



  if (!state.user) {
    document.body.classList.remove("kds-dark", "order-tray-open", "profile-mode");
    // If no active venue selected, show venue selection screen
    if (!state.activeVenueSlug) {
      if (!state.publicVenues.length) {
        loadPublicVenues().then(() => render());
      }

      app.innerHTML = venueSelectView();
      return;
    }

    app.innerHTML = state.loginMode === "standard" ? loginView() : quickAuthView();
    return;
  }



  // Kitchen Display System (KDS) dark theme
  const isKDS = state.view === "kitchen" || state.view === "bar";
  document.body.classList.toggle("kds-dark", isKDS);
  // Delivery Notifications view vs Order Taking view background modes
  document.body.classList.toggle("delivery-mode", state.view === "ready");
  document.body.classList.toggle("order-taking-mode", state.view === "tables");
  document.body.classList.toggle("profile-mode", state.view === "profile");
  // Reserve space at the bottom of the page while the persistent order bar is
  // visible, so no content or button ends up underneath it.
  document.body.classList.toggle("order-tray-open", state.view === "new-order" && state.cart.length > 0);
  let content = "";
  if (state.view === "tables") content = tablesView();
  else if (state.view === "table-detail") content = tableDetailView();
  else if (state.view === "new-order") content = newOrderView();
  else if (state.view === "kitchen" || state.view === "bar") content = stationView(state.view);
  else if (state.view === "ready") content = readyView();
  else if (state.view === "admin") content = state.loading ? `<div class="loading-state" role="status">Се вчитуваат поставките...</div>` : adminView();
  else if (state.view === "profile") content = profileView();
  else if (state.view === "super-admin") content = superAdminView();
  app.innerHTML = shell(content);
}

async function loadTables() {
  const result = await api("/api/tables");
  state.tables = result.tables;
}

async function loadOrders() {
  const result = await api(`/api/orders?table_id=${state.tableId}`);
  state.orders = result.orders;
}

async function loadQueue() {
  const result = await api(`/api/stations/${state.view}/queue`);
  state.queue = result.items;
}

async function loadAdminConfig() {
  const [config, analytics] = await Promise.all([
    api("/api/admin/config"),
    api("/api/admin/stats").catch(() => null),
  ]);
  state.adminConfig = { ...config, analytics };
  state.menu = config.menu;
}

async function loadAdminAnalytics() {
  const analytics = await api("/api/admin/stats");
  if (state.adminConfig) state.adminConfig = { ...state.adminConfig, analytics };
  return analytics;
}

function refreshAdminAnalytics() {
  loadAdminAnalytics()
    .then(() => {
      if (state.view === "admin" && state.adminTab === "analytics") render();
    })
    .catch((error) => toast(error.message, "error"));
}

async function loadReady() {
  state.ready = (await api("/api/ready")).items;
}

async function loadRestaurants() {
  const res = await api("/api/restaurants");
  state.restaurants = res.restaurants || [];
}

async function openTable(tableId) {
  state.tableId = tableId;
  state.view = "table-detail";
  state.loading = true;
  render();
  try {
    await Promise.all([loadTables(), loadOrders()]);
    state.loading = false;
    render();
  } catch (error) {
    state.loading = false;
    render();
    toast(error.message, "error");
  }
}

async function navigate(view) {
  state.view = view;
  state.editingMenuId = null;
  state.editingRestaurantId = null;
  state.loading = true;
  render();
  try {
    if (view === "tables") await loadTables();
    if (view === "kitchen" || view === "bar") await loadQueue();
    if (view === "ready") { await loadTables(); await loadReady(); }
    if (view === "admin") await loadAdminConfig();
    if (view === "super-admin") await loadRestaurants();
    state.loading = false;
    render();
  } catch (error) {
    state.loading = false;
    render();
    toast(error.message, "error");
  }
}

async function enterApp(user) {
  state.user = user;
  state.view = (roles[user.role] || ["tables"])[0];
  state.category = "";
  state.cart = [];
  state.cartExpanded = false;
  state.openAccordions = new Set();
  state.editingMenuId = null;
  state.editingRestaurantId = null;
  state.adminTab = "menu";
  state.adminMenuSearch = "";
  state.adminMenuCategory = "Сите";
  state.adminIngredientSearch = "";
  state.notifications = [];
  state.notificationSeeded = false;
  state.loading = true;
  render();
  try {
    if (user.role === "waiter" || user.role === "admin") {
      await loadTables();
      const catalog = await api("/api/menu");
      state.menu = catalog.items;
      state.ingredients = catalog.ingredients;
    }
    if (user.role === "waiter") {
      await loadReady();
    }
    if (user.role === "kitchen" || user.role === "bar") await loadQueue();
    if (user.role === "admin") await loadAdminConfig();
    if (user.role === "super_admin") await loadRestaurants();
    state.loading = false;
    render();
    await pollNotifications();
  } catch (error) {
    state.loading = false;
    render();
    toast(error.message, "error");
  }
}

async function sendOrder() {
  if (!state.cart.length) return;
  try {
    // Expand portioned food items into individual send lines so each portion
    // can carry its own mods to the kitchen. Beverages and un-customised multi-
    // quantity items collapse back into a single line (quantity > 1, no mods).
    const sendLines = [];
    for (const item of state.cart) {
      if (item.portions && item.portions.length > 1) {
        // Group consecutive identical portions to reduce line count
        let batch = null;
        for (const p of item.portions) {
          const same = batch &&
            JSON.stringify(batch.removals) === JSON.stringify(p.removals) &&
            JSON.stringify(batch.additions) === JSON.stringify(p.additions) &&
            batch.note === p.note &&
            JSON.stringify(batch.allergies) === JSON.stringify(p.allergies);
          if (same) { batch.quantity++; }
          else {
            if (batch) sendLines.push(batch);
            batch = { menu_item_id: item.id, quantity: 1, removals: p.removals, additions: p.additions, note: p.note, allergies: p.allergies };
          }
        }
        if (batch) sendLines.push(batch);
      } else {
        sendLines.push({ menu_item_id: item.id, quantity: item.quantity, removals: item.removals, additions: item.additions, note: item.note, allergies: item.allergies });
      }
    }
    await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        table_id: state.tableId,
        items: sendLines,
      }),
    });
    state.cart = [];
    await Promise.all([loadTables(), loadOrders()]);
    state.view = "table-detail";
    render();
    toast("Нарачката е испратена.");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function updateItem(itemId, action, quantity) {
  try {
    await api(`/api/items/${itemId}`, { method: "PATCH", body: JSON.stringify({ action, ...(quantity ? { quantity } : {}) }) });
    if (state.view === "kitchen" || state.view === "bar") {
      await loadQueue();
    } else if (state.view === "ready") {
      await Promise.all([loadTables(), loadReady()]);
    } else if (state.view === "table-detail") {
      await Promise.all([loadOrders(), loadTables()]);
    } else if (state.view === "tables") {
      await loadTables();
    }
    render();
    toast(action === "ready" ? "Ставката е означена како готова." : action === "deliver" ? "Ставката е означена како доставена." : "Состојбата е ажурирана.");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function updateItemsBatch(itemIds, action) {
  if (!itemIds || !itemIds.length) return;
  try {
    await api("/api/items/batch", { method: "PATCH", body: JSON.stringify({ item_ids: itemIds, action }) });
    if (state.view === "kitchen" || state.view === "bar") {
      await loadQueue();
    } else if (state.view === "ready") {
      await Promise.all([loadTables(), loadReady()]);
    } else if (state.view === "table-detail") {
      await Promise.all([loadOrders(), loadTables()]);
    } else if (state.view === "tables") {
      await loadTables();
    }
    render();
    toast(action === "ready" ? "Сите ставки за масата се готови." : "Сите ставки за масата се доставени.");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function submitItemRequest(itemId, action) {
  const payload = { action };
  if (action === "amend") {
    payload.changes = {
      note: app.querySelector(`[data-change-note="${itemId}"]`)?.value || "",
      removals: Array.from(app.querySelectorAll(`[data-change-removal="${itemId}"]:checked`)).map((input) => input.value),
      additions: Array.from(app.querySelectorAll(`[data-change-addition="${itemId}"]:checked`)).map((input) => input.value),
    };
  }
  try {
    const result = await api(`/api/items/${itemId}/requests`, { method: "POST", body: JSON.stringify(payload) });
    await Promise.all([loadOrders(), loadTables()]);
    render();
    toast(result.request ? "Барањето е испратено до станицата за потврда." : "Ставката е ажурирана.");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function decideItemRequest(itemId, requestId, decision) {
  try {
    await api(`/api/items/${itemId}/requests/${requestId}/decision`, { method: "POST", body: JSON.stringify({ decision }) });
    await loadQueue();
    render();
    toast(decision === "approve" ? "Барањето е одобрено." : "Барањето е одбиено.");
  } catch (error) {
    toast(error.message, "error");
  }
}

app.addEventListener("submit", async (event) => {
  if (event.target.id === "login-form") {
    event.preventDefault();
    const form = new FormData(event.target);
    const errorBox = document.querySelector("#login-error");
    try {
      const result = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password"),
          venueSlug: state.activeVenueSlug,
        }),
      });
      if (result.token) {
        localStorage.setItem("maestro_token", result.token);
      }
      if (result.user && result.user.restaurant && result.user.restaurant.slug) {
        state.activeVenueSlug = result.user.restaurant.slug;
        state.currentVenue = result.user.restaurant;
        localStorage.setItem("activeVenueSlug", result.user.restaurant.slug);
      }
      await enterApp(result.user);
    } catch (error) {
      if (errorBox) errorBox.textContent = error.message;
      toast(error.message, "error");
    }
    return;
  }

  if (event.target.id === "create-restaurant-form") {
    event.preventDefault();
    const form = new FormData(event.target);
    try {
      await api("/api/restaurants", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          slug: form.get("slug"),
          currency: form.get("currency"),
          admin_username: form.get("admin_username"),
          admin_password: form.get("admin_password"),
        }),
      });
      await loadRestaurants();
      render();
      toast("Ресторанот и почетниот администратор се успешно креирани.");
    } catch (error) {
      toast(error.message, "error");
    }
    return;
  }

  if (event.target.id === "custom-venue-form") {
    event.preventDefault();
    const form = new FormData(event.target);
    const slug = form.get("venue_slug");
    await switchActiveVenue(slug);
    return;
  }

  const formElement = event.target.closest("[data-admin-create], [data-admin-update]");
  if (!formElement) return;
  event.preventDefault();
  const form = new FormData(formElement);
  const asJson = (names = []) => {
    const data = Object.fromEntries(form.entries());
    for (const name of names) data[name] = form.getAll(name);
    return data;
  };
  try {
    const create = formElement.dataset.adminCreate;
    const update = formElement.dataset.adminUpdate;
    const createRoutes = { menu: "menu", category: "categories", ingredient: "ingredients", table: "tables", user: "users" };
    let url = `/api/admin/${create ? createRoutes[create] : `${update}s`}`;
    let method = "POST";
    let data;
    if (create === "menu") data = asJson(["ingredients"]);
    else if (create === "table") data = { number: Number(form.get("number")) };
    else if (create === "ingredient") data = { name: form.get("name"), price: Number(form.get("price")) };
    else if (create === "user") data = asJson();
    else if (create === "category") data = asJson();
    else if (update === "menu") {
      url = `/api/admin/menu/${formElement.dataset.id}`;
      method = "PATCH";
      data = asJson(["ingredients"]);
      data.category_id = Number(data.category_id); data.price = Number(data.price); data.active = form.has("active");
    } else if (update === "table") {
      url = `/api/admin/tables/${formElement.dataset.id}`;
      method = "PATCH";
      data = { number: Number(form.get("number")), active: form.has("active") };
    } else if (update === "category" || update === "ingredient") {
      url = `/api/admin/${update === "category" ? "categories" : "ingredients"}/${formElement.dataset.id}`;
      method = "PATCH";
      data = asJson();
      if (update === "ingredient") data.price = Number(data.price);
    } else if (update === "user") {
      url = `/api/admin/users/${formElement.dataset.id}`;
      method = "PATCH";
      data = { name: form.get("name"), role: form.get("role"), active: form.has("active") };
      if (form.get("password")) data.password = form.get("password");
      if (form.get("pin")) data.pin = form.get("pin");
    } else if (update === "restaurant") {
      url = `/api/restaurants/${formElement.dataset.id}`;
      method = "PATCH";
      data = {
        name: form.get("name"),
        slug: form.get("slug"),
        currency: form.get("currency"),
        active: form.has("active"),
        admin_username: form.get("admin_username") || undefined,
        admin_password: form.get("admin_password") || undefined,
      };
    }
    if (data.category_id) data.category_id = Number(data.category_id);
    if (data.price !== undefined) data.price = Number(data.price);
    await api(url, { method, body: JSON.stringify(data) });
    if (update === "restaurant") {
      await loadRestaurants();
      state.editingRestaurantId = null;
    } else {
      await loadAdminConfig();
      state.editingMenuId = null;
    }
    render();
    toast("Промените се зачувани.");
  } catch (error) {
    toast(error.message, "error");
  }
});
async function loadActiveVenue(slug) {
  const targetSlug = slug || state.activeVenueSlug;
  if (!targetSlug) return null; // no venue selected, skip fetch
  try {
    const res = await api(`/api/venue?slug=${encodeURIComponent(targetSlug)}`, { timeoutMs: 2500 });
    if (res && res.venue) {
      state.currentVenue = res.venue;
      state.activeVenueSlug = res.venue.slug;
      localStorage.setItem("activeVenueSlug", res.venue.slug);
      return res.venue;
    }
  } catch (e) {
    console.warn("Could not load venue details:", e.message);
  }
  return null;
}

async function loadPublicVenues() {
  try {
    const res = await api("/api/venues");
    state.publicVenues = res.venues || [];
  } catch (e) {
    console.warn("Could not load public venues:", e);
  }
}

async function switchActiveVenue(slug) {
  const clean = String(slug || "").trim().toLowerCase();
  if (!clean) return;
  state.activeVenueSlug = clean;
  localStorage.setItem("activeVenueSlug", clean);
  try {
    const url = new URL(window.location);
    url.searchParams.set("venue", clean);
    window.history.pushState({}, "", url);
  } catch (_) {}
  state.loading = true;
  state.showVenueModal = false;
  state.currentPin = "";
  state.pinError = "";
  render();
  const venue = await loadActiveVenue(clean);
  state.loading = false;
  render();
  toast(`Ресторан: ${venue?.name || state.currentVenue?.name || clean}`, "success");
}

async function submitPinLogin() {
  if (state.currentPin.length !== 4) return;
  const enteredPin = state.currentPin;
  const currentVenueSlug = state.activeVenueSlug || "maestro-skopje";
  try {
    const res = await api("/api/auth/pin-login", {
      method: "POST",
      body: JSON.stringify({ pin: enteredPin, venueSlug: currentVenueSlug }),
    });
    if (res.token) {
      localStorage.setItem("maestro_token", res.token);
    }
    state.currentPin = "";
    state.pinError = "";
    if (res.user && res.user.restaurant && res.user.restaurant.slug) {
      state.activeVenueSlug = res.user.restaurant.slug;
      state.currentVenue = res.user.restaurant;
      localStorage.setItem("activeVenueSlug", res.user.restaurant.slug);
    }
    await enterApp(res.user);
    toast(`Добредојде, ${res.user.name}!`, "success");
  } catch (error) {
    state.currentPin = "";
    state.pinError = "Погрешен ПИН";
    state.pinShaking = true;
    render();
    toast("Погрешен ПИН", "error");
    setTimeout(() => {
      state.pinShaking = false;
      state.pinError = "";
      render();
    }, 600);
  }
}


app.addEventListener("click", async (event) => {
  const venueOption = event.target.closest("[data-select-venue-slug]");
  if (venueOption) {
    const slug = venueOption.dataset.selectVenueSlug;
    await switchActiveVenue(slug);
    return;
  }

  const pinKey = event.target.closest("[data-pin-digit]");
  if (pinKey) {
    const digit = pinKey.dataset.pinDigit;
    if (state.currentPin.length < 4) {
      state.currentPin += digit;
      state.pinError = "";
      if (state.currentPin.length === 4) {
        render(); // update dots immediately before async call
        submitPinLogin();
      } else {
        render();
      }
    }
    return;
  }
  const adminTab = event.target.closest("[data-admin-tab]");
  if (adminTab) {
    state.adminTab = adminTab.dataset.adminTab;
    state.adminMobileTab = adminTab.dataset.adminTab === "tables" ? "staff" : adminTab.dataset.adminTab;
    render();
    window.scrollTo({ top: 0, behavior: "instant" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    if (state.adminTab === "analytics") refreshAdminAnalytics();
    return;
  }
  const adminBottomNav = event.target.closest("[data-admin-bottom-nav]");
  if (adminBottomNav) {
    const target = adminBottomNav.dataset.adminBottomNav;
    state.adminMobileTab = target;
    if (target === "analytics") {
      state.adminTab = "analytics";
    } else if (target === "menu") {
      state.adminTab = "menu";
    } else if (target === "categories") {
      state.adminTab = "categories";
    } else if (target === "staff") {
      state.adminTab = "tables";
    }
    render();
    window.scrollTo({ top: 0, behavior: "instant" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "instant" });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    });
    if (target === "analytics") refreshAdminAnalytics();
    return;
  }
  const nav = event.target.closest("[data-nav]");
  if (nav) { await navigate(nav.dataset.nav); return; }
  const deliveryTable = event.target.closest("[data-delivery-table]");
  if (deliveryTable) {
    const tableNum = Number(deliveryTable.dataset.deliveryTable);
    const count = Number(deliveryTable.dataset.readyCount) || 0;
    if (count > 0) {
      state.selectedDeliveryTable = state.selectedDeliveryTable === tableNum ? null : tableNum;
      render();
    }
    return;
  }
  const table = event.target.closest("[data-table]");
  if (table) { await openTable(Number(table.dataset.table)); return; }
  const addItem = event.target.closest("[data-add-menu]");
  if (addItem) {
    const item = state.menu.find((entry) => entry.id === Number(addItem.dataset.addMenu));
    if (!item) return;
    const existing = state.cart.find((entry) => entry.id === item.id && !entry.removals.length && !entry.additions.length && !entry.allergies.length && !entry.note);
    if (existing) {
      existing.quantity = Math.min(99, existing.quantity + 1);
      if (!isBeverage(existing)) {
        if (!existing.portions) existing.portions = [{ removals: [], additions: [], note: "", allergies: [] }];
        while (existing.portions.length < existing.quantity) {
          existing.portions.push({ removals: [], additions: [], note: "", allergies: [] });
        }
      }
      syncCartUI();
      renderCartRegions();
      return;
    }
    const newUid = ++cartUid;
    state.cart.push({ ...item, uid: newUid, quantity: 1, removals: [], additions: [], note: "", allergies: [], portions: isBeverage(item) ? null : [{ removals: [], additions: [], note: "", allergies: [] }] });
    // Only build the cart surfaces once they exist; the very first item needs
    // the full view so the tray and the detail panel appear.
    if (document.querySelector(".compact-summary-tray")) renderCartRegions();
    else render();
    return;
  }
  const portionTab = event.target.closest("[data-portion-tab]");
  if (portionTab) {
    const uid = Number(portionTab.dataset.portionTab);
    const pIdx = Number(portionTab.dataset.portionIndex);
    state.activePortions[uid] = pIdx;
    // If mobile modal is open:
    const modal = document.querySelector(".customization-modal-container");
    if (modal && state.customizingItemUid === uid) {
      const item = cartEntry(uid);
      if (item) {
        const body = modal.querySelector(".customization-modal-body");
        if (body) {
          const bodyScroll = body.scrollTop;
          const beverage = isBeverage(item);
          const hasPortions = !beverage && item.quantity >= 2 && item.portions && item.portions.length >= 2;
          const portion = item.portions[pIdx] || item.portions[0];
          const portionKey = `${uid}:${pIdx}`;
          body.innerHTML = `
            ${hasPortions ? `
              <div class="portion-tabs-container">
                <span class="portion-tabs-label">Избери порција (${item.quantity} вкупно):</span>
                <div class="portion-tabs" role="tablist" aria-label="Порција">
                  ${item.portions.map((_, i) => `<button type="button" role="tab" class="portion-tab${i === pIdx ? " portion-tab-active" : ""}" data-portion-tab="${uid}" data-portion-index="${i}" aria-selected="${i === pIdx}">${i + 1}</button>`).join("")}
                </div>
              </div>
              <p class="small muted portion-tab-hint">Порција ${pIdx + 1} од ${item.quantity} - прилагоди посебно</p>
            ` : ""}
            ${portionBody(portion, portionKey, item)}
          `;
          body.scrollTop = bodyScroll;
        }
      }
      return;
    }

    // On desktop:
    const card = document.querySelector(`.cart-card[data-cart-uid="${uid}"]`);
    if (card) {
      const item = cartEntry(uid);
      if (item) {
        const body = card.querySelector(".food-customization-body");
        if (body) {
          const beverage = isBeverage(item);
          const hasPortions = !beverage && item.quantity >= 2 && item.portions && item.portions.length >= 2;
          const portion = item.portions[pIdx] || item.portions[0];
          const portionKey = `${uid}:${pIdx}`;
          body.innerHTML = `
            ${hasPortions ? `
              <div class="portion-tabs-container">
                <span class="portion-tabs-label">Избери порција (${item.quantity} вкупно):</span>
                <div class="portion-tabs" role="tablist" aria-label="Порција">
                  ${item.portions.map((_, i) => `<button type="button" role="tab" class="portion-tab${i === pIdx ? " portion-tab-active" : ""}" data-portion-tab="${uid}" data-portion-index="${i}" aria-selected="${i === pIdx}">${i + 1}</button>`).join("")}
                </div>
              </div>
              <p class="small muted portion-tab-hint">Порција ${pIdx + 1} од ${item.quantity} - прилагоди посебно</p>
            ` : ""}
            ${portionBody(portion, portionKey, item)}
          `;
        }
      }
    }
    return;
  }
  const customizeBtn = event.target.closest("[data-customize-item]");
  if (customizeBtn) {
    const uid = Number(customizeBtn.dataset.customizeItem);
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      if (state.customizingItemUid === uid) {
        state.customizingItemUid = null;
        state.openAccordions.delete(uid);
      } else {
        state.customizingItemUid = uid;
        state.openAccordions = new Set([uid]);
      }
      render();
      return;
    }

    // Desktop: toggle inline accordion directly on that card
    if (state.openAccordions.has(uid)) {
      state.openAccordions.delete(uid);
      const card = document.querySelector(`.cart-card[data-cart-uid="${uid}"]`);
      if (card) {
        const acc = card.querySelector(".food-customization-accordion");
        if (acc) acc.open = false;
      }
    } else {
      state.openAccordions.clear();
      state.openAccordions.add(uid);
      // Close other accordions
      document.querySelectorAll(".food-customization-accordion[open]").forEach((d) => {
        d.open = false;
      });
      const card = document.querySelector(`.cart-card[data-cart-uid="${uid}"]`);
      if (card) {
        const acc = card.querySelector(".food-customization-accordion");
        if (acc) {
          acc.open = true;
          const cartList = document.getElementById("cart-list");
          if (cartList) {
            cartList.scrollTo({ top: card.offsetTop - cartList.offsetTop, behavior: "smooth" });
          } else {
            card.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
        }
      }
    }
    syncArrowIcons();
    return;
  }
  const category = event.target.closest("[data-category]");
  if (category) { state.category = category.dataset.category; render(); return; }
  const removeItem = event.target.closest("[data-remove-item]");
  if (removeItem) {
    const uid = Number(removeItem.dataset.removeItem);
    const index = state.cart.findIndex((entry) => entry.uid === uid);
    if (index === -1) return;
    state.cart.splice(index, 1);
    state.openAccordions.delete(uid);
    if (!state.cart.length) {
      state.cartExpanded = false;
      render();
    } else {
      renderCartRegions();
    }
    return;
  }
  const quantity = event.target.closest("[data-quantity]");
  if (quantity) {
    const item = cartEntry(quantity.dataset.quantity);
    if (!item) return;
    const next = clamp(item.quantity + Number(quantity.dataset.delta), 1, 99);
    if (next === item.quantity) return;
    item.quantity = next;
    // Keep portions array in sync with quantity for food items
    if (item.portions) {
      while (item.portions.length < next) item.portions.push({ removals: [], additions: [], note: "", allergies: [] });
      if (item.portions.length > next) {
        item.portions.length = next;
        if ((state.activePortions[item.uid] || 0) >= next) state.activePortions[item.uid] = next - 1;
      }
      syncPortionToFlat(item, 0);
    }
    // Surgical update: no full re-render, buttons stay completely responsive without UI freeze
    syncCartUI();
    document.querySelectorAll(`[data-qty-display="${item.uid}"]`).forEach(node => { node.textContent = next; });
    document.querySelectorAll(`.tray-step-btn[data-quantity="${item.uid}"]`).forEach(btn => {
      if (btn.dataset.delta === "-1") btn.disabled = next <= 1;
    });
    document.querySelectorAll(`.quantity-control [data-quantity="${item.uid}"][data-delta="-1"]`).forEach(btn => {
      btn.disabled = next <= 1;
      btn.setAttribute("aria-disabled", next <= 1 ? "true" : "false");
    });
    updatePortionTabs(item);
    return;
  }
  // Dismiss customization modal when clicking backdrop
  if (event.target.dataset.modalOverlay === "customization" || event.target.classList.contains("customization-modal-overlay")) {
    state.customizingItemUid = null;
    state.openAccordions.clear();
    render();
    return;
  }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "close-customization") {
    state.customizingItemUid = null;
    state.openAccordions.clear();
    render();
    return;
  }
  if (action === "open-venue-modal") {
    state.showVenueModal = true;
    render();
    if (!state.publicVenues.length) {
      await loadPublicVenues();
      render();
    }
    return;
  }
  if (action === "close-venue-modal") {
    state.showVenueModal = false;
    render();
    return;
  }
  if (action === "pin-backspace") {
    state.currentPin = state.currentPin.slice(0, -1);
    state.pinError = "";
    render();
    return;
  }
  if (action === "pin-clear") {
    state.currentPin = "";
    state.pinError = "";
    render();
    return;
  }
  if (action === "switch-standard-auth") {
    state.loginMode = "standard";
    state.showVenueModal = false;
    render();
    return;
  }
  if (action === "switch-quick-auth") {
    state.loginMode = "quick";
    state.currentPin = "";
    state.pinError = "";
    state.showVenueModal = false;
    render();
    return;
  }
  if (action === "profile-back") {
    const primaryView = (roles[state.user?.role] || ["tables"])[0];
    await navigate(primaryView);
    return;
  }

  if (action === "logout") {
    await api("/api/logout", { method: "POST", body: "{}" }).catch(() => {});
    localStorage.removeItem("maestro_token");
    localStorage.removeItem("activeVenueSlug");
    state.activeVenueSlug = null;
    state.user = null;
    state.cart = [];
    state.currentPin = "";
    state.pinError = "";
    state.loginMode = "quick";
    state.showVenueModal = false;
    await loadPublicVenues().catch(() => {});
    render();
    return;
  }
  if (action === "close-delivery-detail" || (event.target.dataset && event.target.dataset.modalOverlay === "delivery")) { state.selectedDeliveryTable = null; render(); return; }
  if (action === "home" || action === "back-tables") { await navigate("tables"); return; }
  if (action === "back-detail") { await openTable(state.tableId); return; }
  if (action === "new-order") {
    try {
      const catalog = await api("/api/menu");
      state.menu = catalog.items;
      state.ingredients = catalog.ingredients;
      state.category = "";
      state.search = "";
      state.cart = [];
      state.cartExpanded = false;
      state.openAccordions = new Set();
      state.view = "new-order";
      render();
    } catch (error) { toast(error.message, "error"); }
    return;
  }
  if (action === "toggle-cart-details") {
    state.cartExpanded = !state.cartExpanded;
    render();
    return;
  }
  if (action === "send-order") { await sendOrder(); return; }
  if (action === "refresh-tables") { await loadTables(); render(); return; }
  if (action === "refresh-queue") { await loadQueue(); render(); return; }
  if (action === "refresh-ready") { await loadReady(); render(); return; }
  if (action === "refresh-restaurants") { await loadRestaurants(); render(); return; }
  if (action === "refresh-table") { await loadOrders(); render(); return; }
  if (action === "reset-table") { state.showResetModal = true; render(); return; }
  if (action === "cancel-reset-modal" || (event.target.dataset && event.target.dataset.modalOverlay === "reset")) {
    state.showResetModal = false;
    render();
    return;
  }
  if (action === "confirm-reset-table") {
    try {
      const result = await api(`/api/tables/${state.tableId}/reset`, { method: "PATCH", body: "{}" });
      state.showResetModal = false;
      await loadOrders();
      await loadTables();
      render();
      if (result.archived > 0) {
        toast(`Масата е ослободена. ${result.archived} нарачки се архивирани.`, "success");
      } else {
        toast("Нема завршени нарачки за архивирање. Активните нарачки се зачувани.", "success");
      }
    } catch (error) {
      state.showResetModal = false;
      render();
      toast(error.message, "error");
    }
    return;
  }
    const editUserBtn = event.target.closest("[data-edit-user]");
  if (editUserBtn) {
    event.preventDefault();
    const userId = Number(editUserBtn.dataset.editUser);
    state.editingUserId = state.editingUserId === userId ? null : userId;
    render();
    return;
  }
  const closeStaffDrawerBtn = event.target.closest("[data-close-staff-drawer]");
  if (closeStaffDrawerBtn) {
    event.preventDefault();
    state.editingUserId = null;
    render();
    return;
  }
  const editMenu = event.target.closest("[data-edit-menu]");
  if (editMenu) {
    event.preventDefault();
    const itemId = Number(editMenu.dataset.editMenu);
    state.editingMenuId = state.editingMenuId === itemId ? null : itemId;
    render();
    return;
  }
  if (event.target.closest("[data-close-menu-drawer]") || event.target.closest('[data-action="close-menu-modal"]') || (event.target.dataset && event.target.dataset.modalClose === "menu-edit")) {
    event.preventDefault();
    state.editingMenuId = null;
    render();
    return;
  }
  const editRestaurant = event.target.closest("[data-edit-restaurant]");
  if (editRestaurant) {
    state.editingRestaurantId = Number(editRestaurant.dataset.editRestaurant);
    render();
    return;
  }
  if (event.target.closest('[data-action="close-restaurant-modal"]') || (event.target.dataset && event.target.dataset.modalClose === "restaurant-edit")) {
    state.editingRestaurantId = null;
    render();
    return;
  }
  const batchAction = event.target.closest("[data-batch-action]");
  if (batchAction) {
    const action = batchAction.dataset.batchAction;
    const rawIds = batchAction.dataset.itemIds || "";
    const ids = rawIds.split(",").map(Number).filter(Boolean);
    await updateItemsBatch(ids, action);
    return;
  }
  const stationAction = event.target.closest("[data-item-action]");
  if (stationAction) {
    const itemId = Number(stationAction.dataset.item);
    const requested = stationAction.dataset.itemAction;
    await updateItem(itemId, requested);
    return;
  }
  const requestButton = event.target.closest("[data-request-amend]");
  if (requestButton) { await submitItemRequest(Number(requestButton.dataset.requestAmend), "amend"); return; }
  const cancelButton = event.target.closest("[data-request-cancel]");
  if (cancelButton) { await submitItemRequest(Number(cancelButton.dataset.requestCancel), "cancel"); return; }
  const decisionButton = event.target.closest("[data-request-decision]");
  if (decisionButton) { await decideItemRequest(Number(decisionButton.dataset.item), Number(decisionButton.dataset.request), decisionButton.dataset.requestDecision); }
});
app.addEventListener("input", (event) => {
  if (event.target.id === "menu-search") {
    state.search = event.target.value;
    render();
    const search = app.querySelector("#menu-search");
    if (search) {
      search.focus();
      search.setSelectionRange(search.value.length, search.value.length);
    }
  }
  if (event.target.id === "admin-ingredient-search") {
    state.adminIngredientSearch = event.target.value;
    render();
    const search = app.querySelector("#admin-ingredient-search");
    if (search) {
      search.focus();
      search.setSelectionRange(search.value.length, search.value.length);
    }
  }
  if (event.target.matches("[data-note]")) {
    const [uidStr, portionStr] = String(event.target.dataset.note).split(":");
    const item = cartEntry(uidStr);
    if (item) {
      const pIdx = portionStr !== undefined ? Number(portionStr) : 0;
      if (item.portions && item.portions[pIdx]) {
        item.portions[pIdx].note = event.target.value;
        syncPortionToFlat(item, pIdx);
      } else {
        item.note = event.target.value;
      }
      refreshModSummary(item.uid);
    }
  }
  if (event.target.matches("[data-allergy]")) {
    const [uidStr, portionStr] = String(event.target.dataset.allergy).split(":");
    const item = cartEntry(uidStr);
    if (item) {
      const pIdx = portionStr !== undefined ? Number(portionStr) : 0;
      const val = event.target.value.split(",").map((v) => v.trim()).filter(Boolean);
      if (item.portions && item.portions[pIdx]) {
        item.portions[pIdx].allergies = val;
        syncPortionToFlat(item, pIdx);
      } else {
        item.allergies = val;
      }
      refreshModSummary(item.uid);
    }
  }
  if (event.target.matches("[data-remove-ingredient]")) {
    const [uidStr, portionStr] = String(event.target.dataset.removeIngredient).split(":");
    const item = cartEntry(uidStr);
    if (item) {
      const pIdx = portionStr !== undefined ? Number(portionStr) : 0;
      const vals = Array.from(app.querySelectorAll(`[data-remove-ingredient="${event.target.dataset.removeIngredient}"]:checked`)).map((input) => input.value);
      if (item.portions && item.portions[pIdx]) {
        item.portions[pIdx].removals = vals;
        syncPortionToFlat(item, pIdx);
      } else {
        item.removals = vals;
      }
      refreshModSummary(item.uid);
    }
  }
});
app.addEventListener("change", async (event) => {
    const userToggle = event.target.closest("[data-user-toggle]");
  if (userToggle) {
    const userId = userToggle.dataset.userToggle;
    const active = userToggle.checked;
    const userObj = (state.adminConfig?.users || []).find((u) => String(u.id) === String(userId));
    if (userObj) userObj.active = active;
    try {
      await api(`/api/admin/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ active })
      });
      toast(`${userObj?.name || "Корисникот"} е ${active ? "активиран" : "деактивиран"}.`);
    } catch (err) {
      userToggle.checked = !active;
      if (userObj) userObj.active = !active;
      toast(err.message || "Грешка при ажурирање на статусот", "danger");
    }
    return;
  }
  const tableToggle = event.target.closest("[data-table-toggle]");
  if (tableToggle) {
    const tableId = tableToggle.dataset.tableToggle;
    const tableNumber = Number(tableToggle.dataset.tableNumber);
    const active = tableToggle.checked;
    const pill = tableToggle.closest(".admin-table-pill");
    if (pill) {
      pill.classList.toggle("table-active", active);
      pill.classList.toggle("table-inactive", !active);
    }
    const tbl = (state.adminConfig?.tables || []).find((t) => String(t.id) === String(tableId));
    if (tbl) tbl.active = active;
    const publicTbl = (state.tables || []).find((t) => String(t.id) === String(tableId));
    if (publicTbl) publicTbl.active = active;
    try {
      await api(`/api/admin/tables/${tableId}`, {
        method: "PATCH",
        body: JSON.stringify({ number: tableNumber, active })
      });
      toast(`Маса ${tableNumber} е ${active ? "активирана" : "деактивирана"}.`);
    } catch (err) {
      tableToggle.checked = !active;
      if (pill) {
        pill.classList.toggle("table-active", !active);
        pill.classList.toggle("table-inactive", active);
      }
      if (tbl) tbl.active = !active;
      if (publicTbl) publicTbl.active = !active;
      toast("Грешка при ажурирање на масата", "danger");
    }
    return;
  }

  if (event.target.matches('.ingredient-pill input[type="checkbox"]')) {
    const pill = event.target.closest(".ingredient-pill");
    if (pill) pill.classList.toggle("selected", event.target.checked);
  }
  if (event.target.matches("[data-remove-ingredient]")) {
    const [uidStr, portionStr] = String(event.target.dataset.removeIngredient).split(":");
    const item = cartEntry(uidStr);
    if (item) {
      const pIdx = portionStr !== undefined ? Number(portionStr) : 0;
      const vals = Array.from(app.querySelectorAll(`[data-remove-ingredient="${event.target.dataset.removeIngredient}"]:checked`)).map((input) => input.value);
      if (item.portions && item.portions[pIdx]) {
        item.portions[pIdx].removals = vals;
        syncPortionToFlat(item, pIdx);
      } else {
        item.removals = vals;
      }
      refreshModSummary(item.uid);
    }
  }
  if (event.target.matches("[data-add-ingredient]")) {
    const [uidStr, portionStr] = String(event.target.dataset.addIngredient).split(":");
    const item = cartEntry(uidStr);
    if (item) {
      const pIdx = portionStr !== undefined ? Number(portionStr) : 0;
      const vals = Array.from(app.querySelectorAll(`[data-add-ingredient="${event.target.dataset.addIngredient}"]:checked`)).map((input) => {
        const ingredient = state.ingredients.find((entry) => entry.name === input.value);
        return { name: ingredient.name, price: ingredient.price };
      });
      if (item.portions && item.portions[pIdx]) {
        item.portions[pIdx].additions = vals;
        syncPortionToFlat(item, pIdx);
      } else {
        item.additions = vals;
      }
      refreshModSummary(item.uid);
    }
    syncCartUI();
  }
});
// Track which food-customization accordions are open so they survive re-renders
// (quantity changes, checkbox changes, background refreshes).
app.addEventListener("toggle", (event) => {
  const details = event.target;
  if (!(details instanceof HTMLDetailsElement) || !details.classList.contains("food-customization-accordion")) return;
  const card = details.closest(".cart-card");
  const uid = Number(card?.dataset.cartUid);
  if (!Number.isFinite(uid)) return;
  if (details.open) {
    state.openAccordions.clear();
    state.openAccordions.add(uid);
  } else {
    state.openAccordions.delete(uid);
  }
  syncArrowIcons();
}, true);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (state.customizingItemUid) {
      state.customizingItemUid = null;
      state.openAccordions.clear();
      render();
      return;
    }
    if (state.editingMenuId) {
      state.editingMenuId = null;
      render();
    } else if (state.editingRestaurantId) {
      state.editingRestaurantId = null;
      render();
    }
  }
});
async function pollNotifications() {
  if (!state.user) return;
  try {
    const result = await api("/api/notifications");
    const current = result.notifications || [];
    if (state.notificationSeeded) {
      const oldIds = new Set(state.notifications.map((item) => item.id));
      const fresh = current.filter((item) => !oldIds.has(item.id));
      for (const item of fresh) {
        toast(item.message);
        // Alert sound and vibration when item is ready
        if (item.message.toLowerCase().includes("готово") || item.message.toLowerCase().includes("готов")) {
          playReadyBeep();
          vibrateReady();
          notifyReady(item.message);
        }
      }
    }
    state.notifications = current;
    state.notificationSeeded = true;
    if (state.user.role === "kitchen" || state.user.role === "bar") {
      const queueRes = await api(`/api/stations/${state.user.role}/queue`).catch((err) => {
        console.warn("[Poll] Queue fetch error:", err.message);
        return null;
      });
      if (queueRes && queueRes.items) {
        const nextQueue = queueRes.items;
        const changed = JSON.stringify(nextQueue) !== JSON.stringify(state.queue);
        state.queue = nextQueue;
        if (changed && state.view === state.user.role) render();
      }
    } else if (state.user.role === "waiter") {
      const oldTables = JSON.stringify(state.tables);
      await loadTables().catch((err) => console.warn("[Poll] Tables fetch error:", err.message));
      let changed = oldTables !== JSON.stringify(state.tables);
      const oldReady = JSON.stringify(state.ready);
      await loadReady().catch((err) => console.warn("[Poll] Ready fetch error:", err.message));
      changed = changed || oldReady !== JSON.stringify(state.ready);
      if (state.view === "table-detail") {
        const oldOrders = JSON.stringify(state.orders);
        await loadOrders().catch((err) => console.warn("[Poll] Orders fetch error:", err.message));
        changed = changed || oldOrders !== JSON.stringify(state.orders);
      }
      if (changed) render();
    }
  } catch (error) {
    /* Quietly log background polling errors without toast notification spam */
    console.warn("[Background Poll Disconnected]:", error.message);
  }
}

async function boot() {
  state.isSplash = true;
  state.activeVenueSlug = detectVenueSlug();
  // 1. Strict splash screen timeout: guaranteed max 1.5 seconds
  const forceSplashTimeout = setTimeout(() => {
    if (state.isSplash) {
      console.warn("[Splash] Safety timeout fired (1.5s max) - forcing transition to login/quick view.");
      hideSplashScreen();
      render();
    }
  }, 1500);
  const minSplashPromise = new Promise((resolve) => setTimeout(resolve, 800));
  try {
    // 2. Wrap all token verification and staff fetch calls in try-catch-finally
    let sessionUser = null;
    try {
      // Race session check with a 1.5s max cap so token verification never hangs
      const sessionPromise = api("/api/session", { timeoutMs: 1500 });
      const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 1500));
      const result = await Promise.race([sessionPromise, timeoutPromise]);
      if (result && result.user) {
        sessionUser = result.user;
      }
    } catch (err) {
      console.warn("[Session check failed or unauthenticated]:", err.message);
    }

    if (sessionUser) {
      if (sessionUser.restaurant && sessionUser.restaurant.slug) {
        state.activeVenueSlug = sessionUser.restaurant.slug;
        state.currentVenue = sessionUser.restaurant;
        localStorage.setItem("activeVenueSlug", sessionUser.restaurant.slug);
      }
      await enterApp(sessionUser);
      return;
    }

    // 3. Fallback: if a venue slug is set, load its details from DB
    if (state.activeVenueSlug) {
      try {
        const venuePromise = loadActiveVenue(state.activeVenueSlug);
        const venueTimeout = new Promise((resolve) => setTimeout(() => resolve(null), 1200));
        await Promise.race([venuePromise, venueTimeout]);
      } catch (err) {
        console.warn("[Venue load failed]:", err.message);
      }
    } else {
      // No venue slug - pre-load the list for the venue selector screen
      try { await loadPublicVenues(); } catch (_) {}
    }

    // Ensure smooth display duration for branded splash feel (min 800ms)
    await minSplashPromise;
  } catch (globalBootError) {
    console.error("[Boot Error]:", globalBootError);
  } finally {
    clearTimeout(forceSplashTimeout);
    // GUARANTEED execution: hide splash screen and render Quick Login
    hideSplashScreen();
    render();
  }
}

window.addEventListener("popstate", async () => {
  const newSlug = detectVenueSlug();
  if (newSlug !== state.activeVenueSlug) {
    state.activeVenueSlug = newSlug;
    await loadActiveVenue(newSlug);
    render();
  }
});
boot();
// Last-resort guard: a rejected promise or uncaught exception must never leave
// the staff staring at a blank white screen. If the app container is empty we
// paint the branded recovery card; otherwise the error is only logged.
window.addEventListener("unhandledrejection", (event) => {
  console.error("[unhandled promise rejection]", event.reason);
  if (app && !app.innerHTML.trim()) renderFailSafe(event.reason);
});
window.addEventListener("error", (event) => {
  if (event.error) console.error("[window error]", event.error);
  if (app && !app.innerHTML.trim()) renderFailSafe(event.error || new Error(event.message));
});
//  HARD SPLASH KILL TIMER 
// Independent 1500 ms deadline that forcibly hides the splash element and
// flips the isSplash flag.  Runs entirely outside boot() so it cannot be
// blocked by any failed fetch, hanging promise, or async error.
// 
(function () {
  var _splashDeadline = setTimeout(function () {
    // Force-remove the DOM element directly - no state, no render() call
    var el = document.getElementById('splash-screen')
          || document.querySelector('.splash-screen');
    if (el) {
      el.style.display = 'none';
      el.style.visibility = 'hidden';
      el.setAttribute('aria-hidden', 'true');
      try { el.remove(); } catch (_) {}
    }
    // Sync the state flag so render() knows splash is gone
    if (typeof state !== 'undefined' && state.isSplash) {
      state.isSplash = false;
      try { render(); } catch (_) {}
    }
  }, 1500);
  // If boot() finishes early and hides the splash itself, cancel the deadline
  // by watching for the element to disappear from the DOM.
  if (typeof window.MutationObserver !== 'undefined') {
    var _obs = new MutationObserver(function () {
      var el = document.getElementById('splash-screen')
             || document.querySelector('.splash-screen');
      if (!el || el.classList.contains('hidden') || el.style.display === 'none') {
        clearTimeout(_splashDeadline);
        _obs.disconnect();
      }
    });
    _obs.observe(document.body || document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
  }
})();
setInterval(pollNotifications, 4000);
