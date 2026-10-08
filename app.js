/* CHT Inventory Scanner — iPad web app, Prototype 1.
   Mirrors the Windows app (gui_app.py, inventory.py, barcode_database.py, app.py). */
(function () {
  "use strict";

  const APP_VERSION = "Prototype 1 · v0.3.4";

  const STORES = [
    "Franklin Street", "Carrboro", "Cole Park", "Woodcroft", "University Place",
    "Fordham Boulevard", "Atlantic Avenue", "Crabtree", "Vineyard Station", "Havensite",
    "Hillsborough Road", "Homestead", "Baileywick",
  ];
  const STORE_FILE_KEYWORDS = {
    "Franklin Street": ["franklin"],
    "Carrboro": ["carrboro"],
    "Cole Park": ["cole park"],
    "Woodcroft": ["woodcroft"],
    "University Place": ["university place"],
    "Fordham Boulevard": ["fordham"],
    "Atlantic Avenue": ["atlantic"],
    "Crabtree": ["crabtree"],
    "Vineyard Station": ["vineyard"],
    "Havensite": ["havensite"],
    "Hillsborough Road": ["hillsborough"],
    "Homestead": ["homestead"],
    "Baileywick": ["baileywick"],
  };
  const MODES = { "Full Inventory Count": "FULL", "Partial / Cycle Count": "PARTIAL", "Test Mode": "TEST" };
  const SCOPES = {
    "Parts + Tires (exclude Batteries)": "PARTS_AND_TIRES",
    "Batteries Only": "BATTERIES_ONLY",
    "Tires Only": "TIRES_ONLY",
    "All Inventory": "ALL_INVENTORY",
  };

  const KEYS = {
    master: "cht.master.v1",
    storeAlt: "cht.storeAlt.v1",
    unknown: "cht.unknown.v1",
    session: "cht.session.v1",
    lastReport: "cht.lastReport.v1",
    tanks: "cht.tanks.v1",
  };

  // ---------------- Storage ----------------
  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function store(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }
  function remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  // ---------------- CSV ----------------
  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // utf-8-sig
    const rows = [];
    let row = [], field = "", i = 0, inQuotes = false;
    while (i < text.length) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === ",") { row.push(field); field = ""; i++; continue; }
      if (ch === "\r" || ch === "\n") {
        row.push(field); field = "";
        rows.push(row); row = [];
        if (ch === "\r" && text[i + 1] === "\n") i++;
        i++; continue;
      }
      field += ch; i++;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => !(r.length === 1 && r[0] === "")); // DictReader skips blank lines
  }

  function csvDicts(text) {
    const rows = parseCSV(text);
    if (!rows.length) return { headers: [], records: [] };
    const headers = rows[0];
    const records = rows.slice(1).map((r) => {
      const o = {};
      headers.forEach((h, idx) => { o[h] = idx < r.length ? r[idx] : undefined; });
      return o;
    });
    return { headers, records };
  }

  function csvField(v) {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csvText(rows) {
    return rows.map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
  }
  // Python str() of a float, so CSV output matches the Windows app
  function pyFloat(x) {
    if (Object.is(x, -0)) return "-0.0";
    if (Number.isInteger(x) && Math.abs(x) < 1e16) return x + ".0";
    return String(x);
  }

  // ---------------- Inventory (inventory.py) ----------------
  const REQUIRED = ["Part Number", "Part Name", "Brand", "BIN#", "Part Type", "In-Stock"];

  function toNumber(value) {
    if (value === undefined || value === null) return 0;
    const s = String(value).trim().replace(/_/g, "");
    if (s === "" || /^[+-]?0x/i.test(s)) return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  const clean = (v) => (v === undefined || v === null ? "" : String(v).trim());

  class Inventory {
    constructor() { this.items = new Map(); }
    load(text) {
      const { headers, records } = csvDicts(text);
      const missing = REQUIRED.filter((h) => !headers.includes(h)).sort();
      if (missing.length) throw new Error("Missing required Tekmetric columns: " + missing.join(", "));
      this.items.clear();
      for (const row of records) {
        const part = clean(row["Part Number"]);
        if (!part) continue;
        this.items.set(part.toUpperCase(), {
          part_number: part,
          name: clean(row["Part Name"]),
          brand: clean(row["Brand"]),
          bin: clean(row["BIN#"]),
          part_type: clean(row["Part Type"]),
          in_stock: toNumber(row["In-Stock"]),
          wip: toNumber(row["WIP"]),
          available: toNumber(row["Available"]),
          ordered: toNumber(row["Ordered"]),
          net: toNumber(row["Net"]),
          cost: toNumber(row["Cost"]),
          retail: toNumber(row["Retail"]),
          inventory_total: toNumber(row["Total"]),
          vendor: clean(row["Vendor"]),
          alternate_part_numbers: clean(row["Alternate Part Numbers"]),
          physical_count: 0,
        });
      }
      return this.items.size;
    }
    find(part) { return this.items.get(String(part).trim().toUpperCase()); }
    countByType() {
      const t = {};
      for (const it of this.items.values()) {
        const k = it.part_type || "Unknown";
        t[k] = (t[k] || 0) + 1;
      }
      return t;
    }
  }

  function inScope(item, scope) {
    const isBattery = item.part_type.trim().toUpperCase() === "BATTERY";
    if (scope === "PARTS_AND_TIRES") return !isBattery;
    if (scope === "BATTERIES_ONLY") return isBattery;
    if (scope === "TIRES_ONLY") return item.part_type.trim().toUpperCase() === "TIRE";
    return true;
  }

  // ---------------- Barcode list (barcode_database.py) ----------------
  const Barcodes = {
    master() { return load(KEYS.master, {}); },
    find(barcode) { return this.master()[barcode.trim()] || null; },
    add(barcode, part) {
      barcode = barcode.trim(); part = part.trim();
      if (!barcode || !part) throw new Error("Barcode and Part Number cannot be blank");
      const map = this.master();
      const existing = map[barcode];
      if (existing && existing !== part) {
        throw new Error(`Barcode ${barcode} is already mapped to part ${existing} and cannot be changed to ${part}.`);
      }
      map[barcode] = part;
      if (!store(KEYS.master, map)) throw new Error("The barcode could not be saved on this iPad (storage full).");
    },
    storeAlt(storeName, barcode) {
      const all = load(KEYS.storeAlt, {});
      return (all[storeName] || {})[barcode] || null;
    },
    setStoreAlt(storeName, barcode, part) {
      const all = load(KEYS.storeAlt, {});
      all[storeName] = all[storeName] || {};
      all[storeName][barcode] = part;
      if (!store(KEYS.storeAlt, all)) throw new Error("The store-specific part could not be saved (storage full).");
    },
  };

  // ---------------- Bulk tanks (oil and fluids measured by gauge) ----------------
  // Each tank gets its own printable barcode: "29" + store number + "0000" + tank number.
  // Barcodes starting with 2 are reserved for in-store use, so they never clash with products.
  const r2 = (x) => Math.round(x * 100) / 100;
  const Tanks = {
    all() { return load(KEYS.tanks, []); },
    save(list) { if (!store(KEYS.tanks, list)) throw new Error("Tanks could not be saved on this iPad (storage full)."); },
    byCode(code) { return this.all().find((t) => t.code === code) || null; },
    forStore(storeName) { return this.all().filter((t) => t.store === storeName); },
    nextCode(storeName) {
      const storeNo = String(STORES.indexOf(storeName) + 1).padStart(2, "0");
      const seq = this.all().reduce((m, t) => Math.max(m, Number(t.code.slice(-4)) || 0), 0) + 1;
      return `29${storeNo}0000${String(seq).padStart(4, "0")}`;
    },
    add(t) {
      const list = this.all();
      list.push(t);
      this.save(list);
    },
    remove(code) { this.save(this.all().filter((t) => t.code !== code)); },
  };
  const unitWord = (u, n) => (u === "GAL" ? (n === 1 ? "gallon" : "gallons") : (n === 1 ? "quart" : "quarts"));

  function logSkipped(barcode, storeName, note) {
    const list = load(KEYS.unknown, []);
    list.push([barcode, storeName, pyTimestamp(new Date()), note || ""]);
    store(KEYS.unknown, list);
  }

  // ---------------- Time formats (match Python strftime) ----------------
  const pad = (n) => String(n).padStart(2, "0");
  function fileStamp(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  }
  function pyTimestamp(d) {
    const h = d.getHours() % 12 || 12;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(h)}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${d.getHours() < 12 ? "AM" : "PM"}`;
  }
  function friendlyDate(ms) {
    const d = new Date(ms);
    const h = d.getHours() % 12 || 12;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(h)}:${pad(d.getMinutes())} ${d.getHours() < 12 ? "AM" : "PM"}`;
  }
  const fmtG = (x) => String(Number(Number(x).toPrecision(6)));
  const signed = (x) => (x > 0 ? "+" : "") + fmtG(x);
  const money = (x) => (x < 0 ? "-" : "") + "$" + Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ---------------- Report (app.export_inventory_count) ----------------
  function buildReports(inventory, storeName, mode, scope, when) {
    const timestamp = fileStamp(when);
    const countTimestamp = pyTimestamp(when);
    const safe = storeName.replace(/ /g, "_");
    const base = `${safe}_Inventory_Count_${timestamp}`;

    const csvRows = [[
      "Store", "Count Timestamp", "Part Number", "Part Name", "Brand", "BIN#", "Part Type",
      "Count Scope", "Included", "Tekmetric In-Stock", "WIP", "Available", "Net",
      "Physical Count", "Difference", "Unit Cost", "Retail", "Value Impact", "Status",
      "Reconciliation Note",
    ]];
    const reportRows = [];

    for (const item of inventory.items.values()) {
      if (mode !== "FULL" && item.physical_count === 0) continue;
      const included = inScope(item, scope);
      const difference = item.physical_count - item.in_stock;
      let status = "MATCH";
      if (!included) status = "EXCLUDED";
      else if (difference < 0) status = "SHORT";
      else if (difference > 0) status = "OVER";
      const valueImpact = included ? difference * item.cost : 0;
      let note = "";
      if (!included) note = "Excluded from selected count scope";
      else if (item.wip !== 0 && difference !== 0) note = "Possible WIP movement - verify against active repair order";

      csvRows.push([
        storeName, countTimestamp, item.part_number, item.name, item.brand, item.bin, item.part_type,
        scope, included ? "Yes" : "No", pyFloat(item.in_stock), pyFloat(item.wip), pyFloat(item.available),
        pyFloat(item.net), String(item.physical_count), pyFloat(difference), pyFloat(item.cost),
        pyFloat(item.retail), included ? pyFloat(valueImpact) : "0", status, note,
      ]);
      reportRows.push({
        store: storeName, count_timestamp: countTimestamp, part_number: item.part_number, name: item.name,
        brand: item.brand, bin: item.bin, part_type: item.part_type, count_scope: scope, included,
        in_stock: item.in_stock, wip: item.wip, available: item.available, net: item.net,
        physical_count: item.physical_count, cost: item.cost, retail: item.retail, note,
      });
    }

    return {
      csvName: base + ".csv",
      xlsxName: base + ".xlsx",
      csvBlob: new Blob([csvText(csvRows)], { type: "text/csv" }),
      xlsxBlob: window.CHTXlsx.buildInventoryReport(reportRows, storeName, countTimestamp, mode, scope),
    };
  }

  // ---------------- Saving files on iPad ----------------
  async function saveFile(blob, filename) {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.share) {
      try {
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: filename });
          return true;
        }
      } catch (e) {
        if (e && e.name === "AbortError") return false; // user closed the share sheet
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
  }

  // ---------------- UI helpers ----------------
  const $ = (id) => document.getElementById(id);
  const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let currentScreen = "home";
  function show(name) {
    currentScreen = name;
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === "screen-" + name));
    window.scrollTo(0, 0);
  }

  // Modal: returns the chosen button's value; input buttons can validate before closing.
  let modalOpen = false;
  function modal({ title, body = "", html = false, input = null, buttons }) {
    return new Promise((resolve) => {
      modalOpen = true;
      $("modal-title").textContent = title;
      if (html) $("modal-body").innerHTML = body; else $("modal-body").textContent = body;
      const inp = $("modal-input");
      inp.style.display = input ? "block" : "none";
      inp.value = "";
      inp.placeholder = input ? input.placeholder || "" : "";
      inp.setAttribute("inputmode", input && input.inputmode ? input.inputmode : "text");
      $("modal-err").textContent = "";
      $("modal-hint").textContent = "";
      inp.oninput = input && input.hint ? () => { $("modal-hint").textContent = input.hint(inp.value.trim()); } : null;
      const wrap = $("modal-buttons");
      wrap.innerHTML = "";
      let enterButton = null;
      const finish = (value) => {
        $("overlay").classList.remove("show");
        modalOpen = false;
        inp.onkeydown = null;
        inp.oninput = null;
        resolve(value);
      };
      buttons.forEach((b) => {
        const el = document.createElement("button");
        el.textContent = b.label;
        el.className = b.cls || "secondary";
        el.onclick = () => {
          const value = inp.value.trim();
          if (b.validate) {
            const err = b.validate(value);
            if (err) { $("modal-err").textContent = err; inp.focus(); return; }
          }
          finish(input && b.returnsInput ? { button: b.value, text: value } : b.value);
        };
        if (b.enter) enterButton = el;
        wrap.appendChild(el);
      });
      inp.onkeydown = (e) => {
        if ((e.key === "Enter" || e.key === "Tab") && enterButton) { e.preventDefault(); enterButton.click(); }
      };
      $("overlay").classList.add("show");
      if (input) setTimeout(() => inp.focus(), 50);
    });
  }
  const alertBox = (title, body) => modal({ title, body, buttons: [{ label: "OK", value: true, cls: "primary", enter: true }] });
  const confirmBox = (title, body, yes = "Yes", no = "No") =>
    modal({ title, body, html: /^<div/.test(body), buttons: [{ label: no, value: false }, { label: yes, value: true, cls: "primary" }] });

  function productHtml(item, intro) {
    return (
      (intro ? `<div>${escHtml(intro)}</div>` : "") +
      '<div class="kv">' +
      `<b>Part #</b><span>${escHtml(item.part_number)}</span>` +
      `<b>Name</b><span>${escHtml(item.name || "—")}</span>` +
      `<b>Brand</b><span>${escHtml(item.brand || "—")}</span>` +
      `<b>BIN</b><span>${escHtml(item.bin || "—")}</span>` +
      `<b>Type</b><span>${escHtml(item.part_type || "—")}</span>` +
      "</div>"
    );
  }

  // ---------------- App state ----------------
  const state = {
    inventory: null,
    csvTextRaw: null,
    csvName: null,
    csvModified: null,
    storeName: null,
    mode: null,
    scope: null,
    last: null,
    lastQty: 1,
    lastTank: null,
    tankReadings: {},
    scannerMissing: false,
    scannerWaiting: false,
    active: false,
    busy: false,
    lastReports: null,
  };

  function saveSession() {
    if (!state.active || !state.inventory) return true;
    const counts = {};
    for (const it of state.inventory.items.values()) if (it.physical_count > 0) counts[it.part_number] = it.physical_count;
    const ok = store(KEYS.session, {
      v: 1,
      store_name: state.storeName,
      count_mode: state.mode,
      count_scope: state.scope,
      csv_name: state.csvName,
      csv_modified: state.csvModified,
      csv_text: state.csvTextRaw,
      last_scanned_part: state.last,
      last_qty: state.lastQty,
      last_tank: state.lastTank,
      tank_readings: state.tankReadings,
      counts,
      saved_at: Date.now(),
    });
    if (!ok) {
      alertBox("Progress could not be saved",
        "This iPad's browser storage is full or blocked. Do not close the app. Finish the count now to create the report.");
    }
    return ok;
  }

  // ---------------- Home ----------------
  function renderHome() {
    const session = load(KEYS.session, null);
    const last = load(KEYS.lastReport, null);
    $("btn-resume").disabled = !session;
    $("btn-last-report").disabled = !last;
    const n = Object.keys(Barcodes.master()).length;
    let status = session
      ? `A saved count is ready to resume: ${session.store_name}, ${Object.values(session.counts || {}).reduce((a, b) => a + b, 0)} items scanned.`
      : "No unfinished count was found.";
    status += ` • ${n.toLocaleString()} barcodes on this iPad.`;
    $("home-status").textContent = status;
    show("home");
  }

  // ---------------- Setup ----------------
  function fillSelect(id, values, selected) {
    const sel = $(id);
    sel.innerHTML = "";
    values.forEach((v) => {
      const o = document.createElement("option");
      o.value = v; o.textContent = v;
      if (v === selected) o.selected = true;
      sel.appendChild(o);
    });
  }

  function showSetup() {
    state.inventory = null; state.csvTextRaw = null; state.csvName = null;
    fillSelect("sel-store", STORES, STORES[0]);
    fillSelect("sel-mode", Object.keys(MODES), "Full Inventory Count");
    fillSelect("sel-scope", Object.keys(SCOPES), "Parts + Tires (exclude Batteries)");
    $("csv-name").textContent = "No file selected";
    $("file-summary").innerHTML = "";
    $("btn-begin").disabled = true;
    show("setup");
  }

  async function onCsvChosen(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const inv = new Inventory();
      const loaded = inv.load(text);
      const t = inv.countByType();
      state.inventory = inv;
      state.csvTextRaw = text;
      state.csvName = file.name;
      state.csvModified = file.lastModified || null;
      $("csv-name").textContent = file.name;
      $("file-summary").innerHTML =
        `<b>Inventory file ready</b><br>${loaded.toLocaleString()} usable inventory records<br>` +
        `Parts: ${(t.Part || 0).toLocaleString()} &nbsp;&nbsp; Tires: ${(t.Tire || 0).toLocaleString()} &nbsp;&nbsp; Batteries: ${(t.Battery || 0).toLocaleString()}` +
        (file.lastModified ? `<br>File modified: ${friendlyDate(file.lastModified)}` : "");
      $("btn-begin").disabled = false;
    } catch (e) {
      alertBox("Inventory file could not be loaded", e.message || String(e));
    }
  }

  function normalizedFileName(name) {
    return name.toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ");
  }

  async function beginCount() {
    if (!state.inventory) return alertBox("Choose an inventory file", "Select the latest Tekmetric inventory CSV first.");
    const storeName = $("sel-store").value;
    const keywords = STORE_FILE_KEYWORDS[storeName] || [];
    const fname = normalizedFileName(state.csvName);
    if (!keywords.length || !keywords.some((k) => fname.includes(k))) {
      return alertBox("Store and inventory file do not match",
        `You selected:\n\nStore: ${storeName}\nInventory file: ${state.csvName}\n\nChoose the inventory CSV for ${storeName} before starting.`);
    }
    if (load(KEYS.session, null)) {
      const ok = await confirmBox("Replace saved count?",
        "An unfinished count already exists. Starting a new count will replace that saved session. Continue?",
        "Replace It", "Cancel");
      if (!ok) return;
    }
    state.storeName = storeName;
    state.mode = MODES[$("sel-mode").value];
    state.scope = SCOPES[$("sel-scope").value];
    for (const it of state.inventory.items.values()) it.physical_count = 0;
    state.last = null;
    state.lastQty = 1;
    state.lastTank = null;
    state.tankReadings = {};
    state.active = true;
    if (!saveSession()) return;
    showScanning();
  }

  function resumeCount() {
    const s = load(KEYS.session, null);
    if (!s) return;
    try {
      const inv = new Inventory();
      inv.load(s.csv_text);
      for (const [part, count] of Object.entries(s.counts || {})) {
        const it = inv.find(part);
        if (it) it.physical_count = parseFloat(count) || 0;
      }
      Object.assign(state, {
        inventory: inv, csvTextRaw: s.csv_text, csvName: s.csv_name, csvModified: s.csv_modified,
        storeName: s.store_name, mode: s.count_mode, scope: s.count_scope,
        last: s.last_scanned_part || null, lastQty: parseFloat(s.last_qty) || 1, active: true,
        lastTank: s.last_tank || null, tankReadings: s.tank_readings || {},
      });
      showScanning();
    } catch (e) {
      alertBox("Saved count could not be resumed", e.message || String(e));
    }
  }

  // ---------------- Scanning ----------------
  function showScanning() {
    $("scan-meta").textContent = `${state.storeName}  •  ${state.mode}  •  ${state.scope}`;
    setMessage("Ready to scan", "The scanned item will appear here.", "info");
    $("stat-part").textContent = state.last || "—";
    $("stat-diff").textContent = "—";
    updateTotals();
    show("scan");
    focusScan();
  }

  // Scanner status: "ok" (green), "missing" (red), "waiting" (amber: re-armed,
  // waiting for the first scan to prove the scanner is back).
  function focusScan(userTap) {
    if (currentScreen !== "scan" || modalOpen) return;
    const inp = $("scan-input");
    if (userTap === true && state.scannerMissing) {
      // Re-arm without letting the on-screen keyboard pop up again.
      state.scannerMissing = false;
      state.scannerWaiting = true;
    }
    inp.setAttribute("inputmode", state.scannerWaiting ? "none" : "text");
    inp.value = "";
    try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); }
    updateReady();
  }

  function scannerProvedConnected() {
    if (!state.scannerMissing && !state.scannerWaiting) return;
    state.scannerMissing = false;
    state.scannerWaiting = false;
    $("scan-input").setAttribute("inputmode", "text"); // turn disconnect detection back on
    updateReady();
  }

  // iPad tells us a scanner (hardware keyboard) is missing by sliding up the
  // on-screen keyboard when the scan box is active. Detect that and warn.
  let fullHeight = 0;
  function rememberFullHeight() {
    const vv = window.visualViewport;
    const a = document.activeElement;
    if (vv && !(a && (a.tagName === "INPUT" || a.tagName === "SELECT"))) fullHeight = vv.height;
  }
  function softKeyboardUp() {
    const vv = window.visualViewport;
    if (!vv) return false;
    return Math.max(window.innerHeight, fullHeight) - vv.height > 150;
  }

  let kbTimer = null;
  function updateReady() {
    const scan = $("scan-input");
    const watching = currentScreen === "scan" && !modalOpen && document.activeElement === scan && !state.scannerWaiting;
    if (watching && softKeyboardUp() && !kbTimer) {
      // Confirm it's still up a moment later so a passing animation doesn't trigger it.
      kbTimer = setTimeout(() => {
        kbTimer = null;
        if (currentScreen === "scan" && !modalOpen && document.activeElement === scan && !state.scannerWaiting && softKeyboardUp()) {
          state.scannerMissing = true;
          scan.blur(); // put the on-screen keyboard away
        }
        updateReady();
      }, 350);
    }
    const focused = document.activeElement === scan;
    const missing = state.scannerMissing && !focused;
    const waiting = state.scannerWaiting && focused;
    const tag = $("ready-tag");
    tag.className = "ready-tag " + (missing ? "bad" : waiting ? "off" : focused ? "on" : "off");
    $("ready-text").textContent = missing ? "Scanner not connected"
      : waiting ? "Waiting for scanner: scan any barcode"
      : focused ? "Scanner connected" : "Tap here if scans don't appear";
    scan.classList.toggle("ready", focused && !waiting);
    scan.classList.toggle("missing", missing);
    const banner = $("btn-refocus");
    banner.classList.toggle("show", !focused && currentScreen === "scan" && !modalOpen);
    banner.classList.toggle("bad", missing);
    banner.textContent = missing
      ? "Scanner not connected. Turn the scanner on and check Bluetooth, then tap here."
      : "Scanning paused. Tap here, then scan again.";
    $("btn-add-qty").disabled = !state.last || !!state.lastTank;
  }

  function setMessage(title, details, kind, html = false) {
    const m = $("scan-msg");
    m.className = "msg " + kind;
    m.textContent = title;
    if (html) $("scan-details").innerHTML = details; else $("scan-details").textContent = details;
  }

  function updateTotals() {
    if (!state.inventory) return;
    let total = 0, unique = 0;
    for (const it of state.inventory.items.values()) {
      if (it.physical_count > 0 && inScope(it, state.scope)) { total += it.physical_count; unique++; }
    }
    $("stat-total").textContent = total.toLocaleString();
    $("stat-unique").textContent = unique.toLocaleString();
  }

  async function askForPart(title, intro) {
    // Returns a confirmed inventory item, or null if skipped.
    while (true) {
      const res = await modal({
        title,
        body: intro,
        input: { placeholder: "Tekmetric part number", inputmode: "text" },
        buttons: [
          { label: "Skip", value: "skip" },
          {
            label: "Look Up Part", value: "ok", cls: "primary", enter: true, returnsInput: true,
            validate: (v) => {
              if (!v) return "Type a part number, or tap Skip.";
              if (v.toUpperCase() === "SKIP") return null;
              return state.inventory.find(v) ? null
                : `${v} is not in this store's inventory file. Check for typos and leading zeros.`;
            },
          },
        ],
      });
      if (res === "skip" || !res || res.text.toUpperCase() === "SKIP") return null;
      const item = state.inventory.find(res.text);
      const ok = await confirmBox("Is this the right product?", productHtml(item, "Check this against the item in your hand."), "Yes, Correct", "No, Re-enter");
      if (ok) return item;
    }
  }

  async function resolveUnknown(barcode) {
    const item = await askForPart("Unknown barcode",
      `Barcode ${barcode} is not in the barcode list yet.\n\nType the Tekmetric part number from the item's label, or tap Skip.`);
    if (!item) {
      logSkipped(barcode, state.storeName, "Unknown barcode");
      setMessage("Barcode saved for review", `Unknown barcode: ${barcode}\nThis item was NOT counted. Set it aside for the count lead.`, "warning");
      return null;
    }
    const save = await confirmBox("Save this barcode?",
      `Save ${barcode} → ${item.part_number} for future counts?\n\nOnly save if you're sure. Either way, this item will be counted now.`,
      "Save Barcode", "Don't Save");
    if (save) {
      try { Barcodes.add(barcode, item.part_number); }
      catch (e) { await alertBox("Barcode not saved", e.message); }
    }
    return item;
  }

  async function resolveAlternate(barcode, masterPart) {
    const use = await confirmBox("Mapped part not found",
      `Barcode ${barcode} is linked to part ${masterPart}, but that part is not in ${state.storeName}'s inventory file.\n\n` +
        "Is this item listed under a different Tekmetric part number at this store?",
      "Yes, Enter It", "No, Skip It");
    const skipped = () => {
      logSkipped(barcode, state.storeName, `Linked to ${masterPart}, not in this store's file`);
      setMessage("Item skipped",
        `Barcode ${barcode} was not counted. The barcode list (${barcode} → ${masterPart}) was left unchanged.\nSet the item aside for the count lead.`,
        "warning");
      return null;
    };
    if (!use) return skipped();
    const item = await askForPart("Enter store part number",
      `Type the Tekmetric part number for this item at ${state.storeName}, or tap Skip.`);
    if (!item) return skipped();
    const remember = await confirmBox("Remember for this store?",
      `Use ${item.part_number} every time barcode ${barcode} is scanned at ${state.storeName}?\n\nOther stores keep using ${masterPart}.`,
      "Yes, Remember", "Just This Once");
    if (remember) {
      try { Barcodes.setStoreAlt(state.storeName, barcode, item.part_number); }
      catch (e) { await alertBox("Not saved", e.message); }
    }
    return item;
  }

  async function processBarcode(raw) {
    const barcode = String(raw || "").trim();
    $("scan-input").value = "";
    if (!barcode || state.busy) return;
    if (!/^\d{8,14}$/.test(barcode)) {
      setMessage("Barcode not recognized", `Received: ${barcode}\nScan a numeric barcode containing 8 to 14 digits.`, "error");
      return;
    }
    state.busy = true;
    try {
      const tank = Tanks.byCode(barcode);
      if (tank) { await measureTank(tank); return; }
      let item = null;
      const storePart = Barcodes.storeAlt(state.storeName, barcode);
      if (storePart) item = state.inventory.find(storePart);
      if (!item) {
        const masterPart = Barcodes.find(barcode);
        if (masterPart) {
          item = state.inventory.find(masterPart);
          if (!item) item = await resolveAlternate(barcode, masterPart);
        } else {
          item = await resolveUnknown(barcode);
        }
      }
      if (!item) return;

      if (!inScope(item, state.scope)) {
        setMessage("Item outside selected count scope",
          `Part #: ${item.part_number}    Type: ${item.part_type}\nThis item was not counted.`, "warning");
        return;
      }

      item.physical_count += 1;
      state.last = item.part_number;
      state.lastQty = 1;
      state.lastTank = null;
      saveSession();
      showRecorded(item, "Scan recorded");
    } finally {
      state.busy = false;
      focusScan();
    }
  }

  function showRecorded(item, title) {
    const difference = item.physical_count - item.in_stock;
    const value = difference * item.cost;
    setMessage(title,
      `<div class="name">${escHtml(item.name || item.brand || "Inventory item")}</div>` +
        `Part #: ${escHtml(item.part_number)} &nbsp;&nbsp; Brand: ${escHtml(item.brand || "—")} &nbsp;&nbsp; BIN: ${escHtml(item.bin || "—")}<br>` +
        `Type: ${escHtml(item.part_type)} &nbsp;&nbsp; Tekmetric: ${fmtG(item.in_stock)} &nbsp;&nbsp; WIP: ${fmtG(item.wip)}<br>` +
        `Physical count: <b>${item.physical_count}</b> &nbsp;&nbsp; Difference: ${signed(difference)}<br>` +
        `Value difference: ${money(value)}`,
      "success", true);
    $("stat-part").textContent = item.part_number;
    $("stat-diff").textContent = signed(difference);
    updateTotals();
    updateReady();
  }

  async function addQuantity() {
    const item = state.last && state.inventory.find(state.last);
    if (!item || state.lastTank) { await alertBox("Scan an item first", "Scan one of the items, then tap Add Quantity to add the rest. (For bulk tanks, scan the tank again to replace the reading.)"); return focusScan(); }
    const now = item.physical_count;
    const res = await modal({
      title: "Add quantity",
      html: true,
      body:
        `<div class="name" style="font-weight:800;color:var(--ink)">${escHtml(item.name || item.brand || "Inventory item")}</div>` +
        `Part #: ${escHtml(item.part_number)}<br>Counted so far: <b>${now}</b><br><br>How many <b>more</b> of this item do you see?`,
      input: {
        placeholder: "How many more",
        inputmode: "numeric",
        hint: (v) => (/^\d+$/.test(v) && Number(v) > 0 ? `New total will be ${now + Number(v)}` : ""),
      },
      buttons: [
        { label: "Cancel", value: "cancel" },
        {
          label: "Add", value: "ok", cls: "primary", enter: true, returnsInput: true,
          validate: (v) => (!/^\d+$/.test(v) || Number(v) < 1 ? "Type a whole number, like 11."
            : Number(v) > 999 ? "That's more than 999. Check the number." : null),
        },
      ],
    });
    if (!res || res.button !== "ok") return focusScan();
    const n = Number(res.text);
    item.physical_count += n;
    state.last = item.part_number;
    state.lastQty = n;
    state.lastTank = null;
    saveSession();
    showRecorded(item, `Added ${n} more (total ${item.physical_count})`);
    focusScan();
  }

  async function measureTank(tank) {
    if (tank.store !== state.storeName) {
      setMessage("Tank belongs to another store",
        `This label is for "${tank.name}" at ${tank.store}. You are counting ${state.storeName}.\nNothing was counted.`, "warning");
      return;
    }
    const item = state.inventory.find(tank.part);
    if (!item) {
      await alertBox("Tank part not found",
        `The tank "${tank.name}" is set up as part ${tank.part}, but that part is not in ${state.storeName}'s inventory file.\n\nCheck the part number in Barcodes & Data → Bulk Tanks.`);
      return;
    }
    if (!inScope(item, state.scope)) {
      setMessage("Item outside selected count scope", `Part #: ${item.part_number}    Type: ${item.part_type}\nThis tank was not counted.`, "warning");
      return;
    }
    const prev = state.tankReadings[tank.code];
    const u = tank.unit === "GAL" ? "GAL" : "QT";
    if (prev !== undefined) {
      const again = await confirmBox("Tank already measured",
        `"${tank.name}" was already measured this count: ${fmtG(prev)} ${unitWord(u, prev)}.\n\nMeasure it again and replace that reading?`,
        "Replace Reading", "Cancel");
      if (!again) return;
    }
    const toUnit = (v, entered) => r2(u === "QT" ? (entered === "GAL" ? v * 4 : v) : (entered === "GAL" ? v : v / 4));
    const valid = (v) => /^\d*\.?\d+$/.test(v) && Number(v) <= 10000;
    const res = await modal({
      title: "Bulk tank reading",
      html: true,
      body:
        `<div class="name" style="font-weight:800;color:var(--ink)">${escHtml(tank.name)}</div>` +
        `Part #: ${escHtml(item.part_number)} – ${escHtml(item.name || "")}<br>` +
        `Tekmetric counts this in <b>${u === "QT" ? "quarts" : "gallons"}</b> (Tekmetric shows ${fmtG(item.in_stock)}).<br><br>` +
        "Read the level on the tank, type it, then tap <b>Gallons</b> or <b>Quarts</b>.",
      input: {
        placeholder: "Amount on the tank gauge",
        inputmode: "decimal",
        hint: (v) => (valid(v)
          ? `${fmtG(Number(v))} gallons = ${fmtG(toUnit(Number(v), "GAL"))} ${unitWord(u)}` +
            (u === "QT" ? "" : `   •   ${fmtG(Number(v))} quarts = ${fmtG(toUnit(Number(v), "QT"))} gallons`)
          : ""),
      },
      buttons: [
        { label: "Cancel", value: "cancel" },
        { label: "Quarts", value: "QT", returnsInput: true,
          validate: (v) => (valid(v) ? null : "Type the amount, like 82.5") },
        { label: "Gallons", value: "GAL", cls: "primary", enter: true, returnsInput: true,
          validate: (v) => (valid(v) ? null : "Type the amount, like 82.5") },
      ],
    });
    if (!res || typeof res !== "object") return; // Cancel
    const entered = Number(res.text);
    const amount = toUnit(entered, res.button);
    const delta = r2(amount - (prev || 0));
    item.physical_count = r2(item.physical_count + delta);
    state.tankReadings[tank.code] = amount;
    state.last = item.part_number;
    state.lastQty = delta;
    state.lastTank = { code: tank.code, prev: prev === undefined ? null : prev };
    saveSession();
    const shown = res.button === "GAL"
      ? `${fmtG(entered)} gal = ${fmtG(amount)} ${unitWord(u, amount)}`
      : `${fmtG(entered)} qt${u === "GAL" ? ` = ${fmtG(amount)} gal` : ""}`;
    showRecorded(item, `${prev !== undefined ? "Tank re-measured" : "Tank measured"}: ${shown}`);
  }

  async function chooseTank() {
    const tanks = Tanks.forStore(state.storeName);
    if (!tanks.length) {
      await alertBox("No bulk tanks set up",
        `There are no bulk tanks set up for ${state.storeName} yet.\n\nAdd them in Barcodes & Data → Bulk Tanks.`);
      return focusScan();
    }
    const code = await modal({
      title: "Measure a bulk tank",
      body: "Pick the tank you're reading:",
      buttons: [{ label: "Cancel", value: null },
        ...tanks.map((t) => ({ label: t.name + (state.tankReadings[t.code] !== undefined ? " ✓" : ""), value: t.code, cls: "secondary" }))],
    });
    if (code) await measureTank(Tanks.byCode(code));
    focusScan();
  }

  async function typeBarcode() {
    const res = await modal({
      title: "Type a barcode",
      body: "Use this only when a barcode won't scan.",
      input: { placeholder: "Barcode digits", inputmode: "numeric" },
      buttons: [
        { label: "Cancel", value: "cancel" },
        { label: "Enter", value: "ok", cls: "primary", enter: true, returnsInput: true },
      ],
    });
    if (res && res.button === "ok") await processBarcode(res.text);
    else focusScan();
  }

  async function undoLast() {
    if (!state.last) { await alertBox("Nothing to undo", "There is no recent scan to undo."); return focusScan(); }
    const it = state.inventory.find(state.last);
    if (it && state.lastTank) {
      const t = state.lastTank;
      it.physical_count = r2(it.physical_count - state.lastQty);
      if (t.prev === null) delete state.tankReadings[t.code]; else state.tankReadings[t.code] = t.prev;
      state.last = null; state.lastQty = 1; state.lastTank = null;
      saveSession();
      const d = it.physical_count - it.in_stock;
      setMessage("Tank reading undone", `Part #: ${it.part_number}\nPhysical count: ${fmtG(it.physical_count)}\nDifference: ${signed(d)}`, "warning");
      $("stat-part").textContent = it.part_number;
      $("stat-diff").textContent = signed(d);
      updateTotals();
      updateReady();
      return focusScan();
    }
    if (!it || it.physical_count <= 0) { await alertBox("Nothing to undo", "The last scanned item cannot be undone."); return focusScan(); }
    const qty = Math.min(state.lastQty || 1, it.physical_count);
    it.physical_count -= qty;
    state.last = null;
    state.lastQty = 1;
    saveSession();
    const difference = it.physical_count - it.in_stock;
    setMessage(qty > 1 ? `Last entry undone (${qty} removed)` : "Last scan undone",
      `Part #: ${it.part_number}\nPhysical count: ${it.physical_count}\nDifference: ${signed(difference)}`, "warning");
    updateReady();
    $("stat-part").textContent = it.part_number;
    $("stat-diff").textContent = signed(difference);
    updateTotals();
    focusScan();
  }

  async function pauseCount() {
    saveSession();
    state.active = false;
    await alertBox("Count saved", "The inventory count has been saved and can be resumed from the start screen.");
    renderHome();
  }

  async function finishCount() {
    const prompt = state.mode === "FULL"
      ? "Finish this Full count? Included items that were not scanned will be counted as zero."
      : "Finish this count and create the CSV and Excel reports?";
    if (!(await confirmBox("Finish inventory count", prompt, "Finish Count", "Keep Scanning"))) return focusScan();
    let reports;
    const when = new Date();
    try {
      reports = buildReports(state.inventory, state.storeName, state.mode, state.scope, when);
    } catch (e) {
      await alertBox("Reports could not be created", (e && e.message) || String(e));
      return focusScan();
    }
    const counts = {};
    for (const it of state.inventory.items.values()) if (it.physical_count > 0) counts[it.part_number] = it.physical_count;
    store(KEYS.lastReport, {
      store_name: state.storeName, count_mode: state.mode, count_scope: state.scope,
      csv_text: state.csvTextRaw, counts, finished_at: when.getTime(),
    });
    remove(KEYS.session);
    state.active = false;
    state.lastReports = reports;
    showDone(reports);
  }

  function showDone(reports) {
    $("done-xlsx").textContent = reports.xlsxName;
    $("done-csv").textContent = reports.csvName;
    show("done");
  }

  function reopenLastReport() {
    const r = load(KEYS.lastReport, null);
    if (!r) return;
    try {
      const inv = new Inventory();
      inv.load(r.csv_text);
      for (const [part, count] of Object.entries(r.counts || {})) {
        const it = inv.find(part);
        if (it) it.physical_count = count;
      }
      state.lastReports = buildReports(inv, r.store_name, r.count_mode, r.count_scope, new Date(r.finished_at));
      showDone(state.lastReports);
    } catch (e) {
      alertBox("Last report could not be rebuilt", e.message || String(e));
    }
  }

  // ---------------- Data screen ----------------
  function renderData() {
    const alt = load(KEYS.storeAlt, {});
    $("data-master").textContent = Object.keys(Barcodes.master()).length.toLocaleString();
    $("data-alt").textContent = Object.values(alt).reduce((n, m) => n + Object.keys(m).length, 0).toLocaleString();
    $("data-unknown").textContent = load(KEYS.unknown, []).length.toLocaleString();
    $("data-tanks").textContent = Tanks.all().length.toLocaleString();
    show("data");
  }

  async function importMaster(file) {
    if (!file) return;
    try {
      const { headers, records } = csvDicts(await file.text());
      if (!headers.includes("Barcode") || !headers.includes("Part Number")) {
        throw new Error("This file needs the columns Barcode and Part Number.");
      }
      const map = Barcodes.master();
      let added = 0, same = 0;
      const conflicts = [];
      for (const row of records) {
        const b = clean(row["Barcode"]), p = clean(row["Part Number"]);
        if (!b || !p) continue;
        if (!(b in map)) { map[b] = p; added++; }
        else if (map[b] === p) same++;
        else conflicts.push(`${b}: iPad has ${map[b]}, file has ${p}`);
      }
      if (!store(KEYS.master, map)) throw new Error("Storage is full; nothing was imported.");
      await alertBox("Barcode list imported",
        `${added} new barcodes added.\n${same} were already on this iPad.\n${conflicts.length} conflicts (kept the iPad's part):` +
          (conflicts.length ? "\n\n" + conflicts.slice(0, 12).join("\n") + (conflicts.length > 12 ? `\n…and ${conflicts.length - 12} more` : "") : ""));
    } catch (e) {
      await alertBox("Import failed", e.message || String(e));
    }
    renderData();
  }

  function exportMaster() {
    const rows = [["Barcode", "Part Number"], ...Object.entries(Barcodes.master())];
    saveFile(new Blob([csvText(rows)], { type: "text/csv" }), "barcode_master.csv");
  }
  function exportAlt() {
    const rows = [["Store", "Barcode", "Part Number"]];
    for (const [s, m] of Object.entries(load(KEYS.storeAlt, {}))) for (const [b, p] of Object.entries(m)) rows.push([s, b, p]);
    saveFile(new Blob([csvText(rows)], { type: "text/csv" }), "store_specific_parts.csv");
  }
  function renderTanks() {
    fillSelect("tank-store", STORES, $("tank-store").value || state.storeName || STORES[0]);
    const list = Tanks.all();
    const box = $("tank-list");
    if (!list.length) {
      box.innerHTML = '<p class="muted">No bulk tanks yet. Add one above, then print its label.</p>';
    } else {
      box.innerHTML = STORES.filter((st) => list.some((t) => t.store === st)).map((st) =>
        `<h3 style="margin:18px 0 8px;color:var(--navy)">${escHtml(st)}</h3>` +
        list.filter((t) => t.store === st).map((t) =>
          `<div class="tank-row"><div><b>${escHtml(t.name)}</b><br><span class="muted small">Part ${escHtml(t.part)} • counted in ${t.unit === "GAL" ? "gallons" : "quarts"} • code ${t.code}</span></div>` +
          `<button class="secondary" data-remove="${t.code}">Remove</button></div>`).join("")).join("");
    }
    box.querySelectorAll("[data-remove]").forEach((b) => {
      b.onclick = async () => {
        const t = Tanks.byCode(b.dataset.remove);
        if (await confirmBox("Remove tank?", `Remove "${t.name}" at ${t.store}? Its printed label will stop working.`, "Remove", "Keep")) {
          Tanks.remove(t.code);
          renderTanks();
        }
      };
    });
    $("tank-count").textContent = `${list.length} tank${list.length === 1 ? "" : "s"}`;
    show("tanks");
  }

  async function addTank() {
    const storeName = $("tank-store").value;
    const name = $("tank-name").value.trim();
    const part = $("tank-part").value.trim();
    const unit = $("tank-unit").value;
    if (!name || !part) return alertBox("Missing information", "Give the tank a name (like \"5W-30 tank by bay 3\") and its Tekmetric part number.");
    const code = Tanks.nextCode(storeName);
    try { Tanks.add({ code, store: storeName, name, part, unit }); }
    catch (e) { return alertBox("Not saved", e.message); }
    $("tank-name").value = ""; $("tank-part").value = "";
    renderTanks();
  }

  async function printTankLabels() {
    const storeName = $("tank-store").value;
    const tanks = Tanks.forStore(storeName);
    if (!tanks.length) return alertBox("No tanks to print", `There are no bulk tanks set up for ${storeName}.`);
    let pdf;
    try { pdf = window.CHTBarcode.labelsPdf(tanks); }
    catch (e) { return alertBox("Labels could not be made", e.message || String(e)); }
    // Opens the iPad share sheet: choose Print, Save to Files, or AirDrop.
    await saveFile(pdf, `Tank_Labels_${storeName.replace(/ /g, "_")}.pdf`);
  }

  function exportTanks() {
    const rows = [["Store", "Tank Name", "Part Number", "Tekmetric Unit", "Barcode"],
      ...Tanks.all().map((t) => [t.store, t.name, t.part, t.unit, t.code])];
    saveFile(new Blob([csvText(rows)], { type: "text/csv" }), "bulk_tanks.csv");
  }

  async function importTanks(file) {
    if (!file) return;
    try {
      const { headers, records } = csvDicts(await file.text());
      for (const h of ["Store", "Tank Name", "Part Number", "Tekmetric Unit", "Barcode"]) if (!headers.includes(h)) throw new Error(`Missing column: ${h}`);
      const list = Tanks.all();
      let added = 0;
      for (const r of records) {
        const code = clean(r["Barcode"]);
        if (!/^29\d{10}$/.test(code) || list.some((t) => t.code === code)) continue;
        list.push({ code, store: clean(r["Store"]), name: clean(r["Tank Name"]), part: clean(r["Part Number"]), unit: clean(r["Tekmetric Unit"]) === "GAL" ? "GAL" : "QT" });
        added++;
      }
      Tanks.save(list);
      await alertBox("Tanks imported", `${added} tank${added === 1 ? "" : "s"} added.`);
    } catch (e) {
      await alertBox("Import failed", e.message || String(e));
    }
    renderTanks();
  }

  function exportUnknown() {
    const rows = [["Barcode", "Store", "Date/Time", "Note"], ...load(KEYS.unknown, [])];
    saveFile(new Blob([csvText(rows)], { type: "text/csv" }), "unknown_barcodes.csv");
  }

  // ---------------- Wiring ----------------
  function wire() {
    $("version").textContent = `${APP_VERSION} · data is stored on this iPad`;
    $("btn-start").onclick = showSetup;
    $("btn-resume").onclick = resumeCount;
    $("btn-last-report").onclick = reopenLastReport;
    $("btn-data").onclick = renderData;
    $("btn-setup-back").onclick = renderHome;
    $("btn-choose-csv").onclick = () => { $("file-csv").value = ""; $("file-csv").click(); };
    $("file-csv").onchange = (e) => onCsvChosen(e.target.files[0]);
    $("btn-begin").onclick = beginCount;
    $("btn-undo").onclick = undoLast;
    $("btn-add-qty").onclick = addQuantity;
    $("btn-pause").onclick = pauseCount;
    $("btn-finish").onclick = finishCount;
    $("btn-type-barcode").onclick = typeBarcode;
    $("btn-refocus").onclick = () => focusScan(true);
    $("ready-tag").onclick = () => focusScan(true);
    $("btn-save-xlsx").onclick = () => state.lastReports && saveFile(state.lastReports.xlsxBlob, state.lastReports.xlsxName);
    $("btn-save-csv").onclick = () => state.lastReports && saveFile(state.lastReports.csvBlob, state.lastReports.csvName);
    $("btn-done-home").onclick = renderHome;
    $("btn-data-back").onclick = renderHome;
    $("btn-import-master").onclick = () => { $("file-master").value = ""; $("file-master").click(); };
    $("file-master").onchange = (e) => importMaster(e.target.files[0]);
    $("btn-export-master").onclick = exportMaster;
    $("btn-export-alt").onclick = exportAlt;
    $("btn-export-unknown").onclick = exportUnknown;
    $("btn-tanks").onclick = renderTanks;
    $("btn-tanks-back").onclick = renderData;
    $("btn-add-tank").onclick = addTank;
    $("btn-print-tanks").onclick = printTankLabels;
    $("tank-store").onchange = () => {};
    $("btn-export-tanks").onclick = exportTanks;
    $("btn-import-tanks").onclick = () => { $("file-tanks").value = ""; $("file-tanks").click(); };
    $("file-tanks").onchange = (e) => importTanks(e.target.files[0]);
    $("btn-measure-tank").onclick = chooseTank;

    const scan = $("scan-input");
    scan.addEventListener("focus", updateReady);
    scan.addEventListener("blur", () => setTimeout(updateReady, 0));
    scan.addEventListener("keydown", (e) => {
      if (/^\d$/.test(e.key)) scannerProvedConnected();
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        processBarcode(scan.value);
      }
    });
    // Tapping the scan card (not a button) puts the cursor back in the scan box
    $("scan-card").addEventListener("click", (e) => { if (e.target.tagName !== "BUTTON") focusScan(true); });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", () => { rememberFullHeight(); setTimeout(updateReady, 60); });
    }
    window.addEventListener("orientationchange", () => { fullHeight = 0; setTimeout(rememberFullHeight, 400); });
    rememberFullHeight();

    // Scanner keystrokes that arrive while nothing is focused still get counted
    document.addEventListener("keydown", (e) => {
      if (modalOpen || currentScreen !== "scan") return;
      if (e.target === scan || e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
      if (/^\d$/.test(e.key)) {
        scannerProvedConnected();
        scan.value += e.key;
        e.preventDefault();
      } else if ((e.key === "Enter" || e.key === "Tab") && scan.value) {
        e.preventDefault();
        processBarcode(scan.value);
      }
    });

    window.addEventListener("pagehide", () => { if (state.active) saveSession(); });
    document.addEventListener("visibilitychange", () => { if (document.hidden && state.active) saveSession(); });

    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if ("serviceWorker" in navigator && location.protocol === "https:") {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  // Expose a small test hook (harmless in production)
  window.__cht = { state, Inventory, Barcodes, Tanks, buildReports, parseCSV, KEYS };

  wire();
  renderHome();
})();
