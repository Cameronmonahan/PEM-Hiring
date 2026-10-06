// Shared helpers for the candidate portal: brand theming, field rendering,
// validation feedback and API calls.
window.PEM = (() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function applyBrand(brand) {
    if (!brand) return;
    const r = document.documentElement.style, c = brand.colors || {};
    if (c.navyDeep) r.setProperty("--navy-deep", c.navyDeep);
    if (c.navy) r.setProperty("--navy", c.navy);
    if (c.gold) r.setProperty("--gold", c.gold);
    if (c.goldLight) r.setProperty("--gold-light", c.goldLight);
    if (c.muted) r.setProperty("--muted", c.muted);
    if (c.muted2) r.setProperty("--muted-2", c.muted2);
    if (brand.fonts?.display) r.setProperty("--font-display", brand.fonts.display);
    if (brand.fonts?.body) r.setProperty("--font-body", brand.fonts.body);
    document.querySelectorAll("[data-logo]").forEach((img) => { img.src = brand.logoGold; img.alt = brand.company; });
    document.querySelectorAll("[data-icon]").forEach((img) => { img.src = brand.icon; });
    document.querySelectorAll("[data-company]").forEach((el) => { el.textContent = brand.company; });
    const ico = document.querySelector("link[rel=icon]"); if (ico) ico.href = brand.icon;
  }

  async function api(path, opts = {}) {
    const res = await fetch("/api" + path, { headers: { "content-type": "application/json" }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || "Something went wrong"); e.data = data; e.status = res.status; throw e; }
    return data;
  }

  const wc = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;

  function renderField(f) {
    const req = f.required ? '<span class="req">*</span>' : "";
    const help = f.help ? `<p class="help">${esc(f.help)}</p>` : "";
    const group = f.group ? `<div class="group-title">${esc(f.group)}</div>` : "";
    let input = "";
    const common = `id="f_${f.id}" name="${f.id}" ${f.required ? "required" : ""}`;
    switch (f.type) {
      case "textarea":
        input = `<textarea ${common} placeholder="${esc(f.placeholder || "")}"></textarea>${f.maxWords ? `<div class="count" data-count-for="${f.id}">0 / ${f.maxWords} words</div>` : ""}`; break;
      case "select":
        input = `<select ${common}><option value="">Choose…</option>${f.options.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}</select>`; break;
      case "currency":
        input = `<div class="currency"><input type="number" min="1" step="1" inputmode="numeric" id="f_${f.id}_amount" placeholder="Amount"><select id="f_${f.id}_currency">${f.currencies.map((c) => `<option value="${c}" ${c === "USD" ? "selected" : ""}>${c}</option>`).join("")}</select></div>`; break;
      case "rating": {
        const min = f.min ?? 1, max = f.max ?? 5; let b = "";
        for (let i = min; i <= max; i++) b += `<button type="button" data-rating="${f.id}" data-v="${i}">${i}</button>`;
        input = `<div class="rating">${b}${f.scaleLabels ? `<div class="scale"><span>${esc(f.scaleLabels[0])}</span><span>${esc(f.scaleLabels[1])}</span></div>` : ""}</div><input type="hidden" id="f_${f.id}" name="${f.id}">`; break; }
      case "number":
        input = `<input type="number" ${common} ${f.min !== undefined ? `min="${f.min}"` : ""} ${f.max !== undefined ? `max="${f.max}"` : ""} step="${f.step || 1}" inputmode="decimal">`; break;
      case "date": input = `<input type="date" ${common}>`; break;
      case "datetime": input = `<input type="datetime-local" ${common}>`; break;
      case "email": input = `<input type="email" ${common} autocomplete="email">`; break;
      case "url": input = `<input type="url" ${common} placeholder="https://" inputmode="url">`; break;
      default: input = `<input type="text" ${common} placeholder="${esc(f.placeholder || "")}" ${f.id === "name" ? 'autocomplete="name"' : ""}>`;
    }
    return `${group}<div class="field" data-field="${f.id}"><label for="f_${f.id}">${esc(f.label)}${req}</label>${help}${input}<div class="err"></div></div>`;
  }

  function wireFields(root, fields) {
    root.querySelectorAll("[data-rating]").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.rating; root.querySelectorAll(`[data-rating="${id}"]`).forEach((x) => x.classList.toggle("on", x === b));
      root.querySelector(`#f_${id}`).value = b.dataset.v;
    }));
    fields.filter((f) => f.maxWords).forEach((f) => {
      const ta = root.querySelector(`#f_${f.id}`), c = root.querySelector(`[data-count-for="${f.id}"]`);
      if (!ta || !c) return;
      ta.addEventListener("input", () => { const n = wc(ta.value); c.textContent = `${n} / ${f.maxWords} words`; c.classList.toggle("over", n > f.maxWords); });
    });
  }

  function collect(root, fields) {
    const out = {};
    for (const f of fields) {
      if (f.type === "currency") {
        const a = root.querySelector(`#f_${f.id}_amount`).value, c = root.querySelector(`#f_${f.id}_currency`).value;
        out[f.id] = a ? { amount: Number(a), currency: c } : "";
      } else {
        const el = root.querySelector(`#f_${f.id}`); let v = el ? el.value : "";
        if ((f.type === "number" || f.type === "rating") && v !== "") v = Number(v);
        if (typeof v === "string") v = v.trim();
        out[f.id] = v;
      }
    }
    return out;
  }

  function showErrors(root, errors) {
    root.querySelectorAll(".field").forEach((el) => el.classList.remove("invalid"));
    let first = null;
    for (const [id, msg] of Object.entries(errors || {})) {
      const el = root.querySelector(`[data-field="${id}"]`); if (!el) continue;
      el.classList.add("invalid"); el.querySelector(".err").textContent = msg; first = first || el;
    }
    if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function clientValidate(fields, answers) {
    const errors = {};
    for (const f of fields) {
      const v = answers[f.id];
      const empty = v === "" || v === undefined || v === null;
      if (f.required && empty) { errors[f.id] = "Required"; continue; }
      if (empty) continue;
      if (f.type === "url" && !/^https?:\/\/\S+$/i.test(v)) errors[f.id] = "Enter a full link starting with http";
      if (f.maxWords && wc(v) > f.maxWords) errors[f.id] = `Keep it under ${f.maxWords} words`;
      if (f.type === "currency" && (!v.amount || v.amount <= 0)) errors[f.id] = "Enter an amount";
    }
    return errors;
  }

  function fmtDate(iso) { if (!iso) return ""; return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }

  return { $, esc, applyBrand, api, renderField, wireFields, collect, showErrors, clientValidate, wc, fmtDate };
})();
