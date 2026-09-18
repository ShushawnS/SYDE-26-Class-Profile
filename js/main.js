/* ===========================================================================
   SYDE 26 Class Profile — rendering

   Colour is never decorative here. The data is drawn in one monochrome
   ramp (d1..d6, dark to light) and the accent is spent only where the
   reader should look twice: an adverse answer, the mark under the cursor.
   A plain bar chart whose x-axis already names every category gets one
   flat grey, because per-bar hue would repeat what the label says.

   Charts are labelled directly — the series name sits at the end of its
   own line, the value sits at the end of its own bar — so almost nothing
   here needs a legend or a second glance at a key.
   ======================================================================== */

document.addEventListener("DOMContentLoaded", async () => {
  const ROOT = getComputedStyle(document.documentElement);
  const tok = (n) => ROOT.getPropertyValue(n).trim();

  const RAMP = ["--d1", "--d2", "--d3", "--d4", "--d5", "--d6"].map(tok);
  // Unordered answers get hues that jump, not a scale that implies rank.
  const CAT = ["--m1", "--m2", "--m3", "--m4", "--m5", "--m6"].map(tok);
  const INK = tok("--ink");
  const INK2 = tok("--ink-2");
  const INK3 = tok("--ink-3");
  const RULE = tok("--rule");
  const RULE2 = tok("--rule-2");
  const ACCENT = tok("--accent");
  const FLAT = tok("--flat");
  const NEUTRAL = tok("--neutral");
  const GROUND = tok("--ground");
  const SURFACE = tok("--surface");

  const SANS = "Geist, system-ui, sans-serif";
  const MONO = "'Geist Mono', ui-monospace, Menlo, monospace";

  // Course titles for the code fields, so "SYDE 223" can say what it is.
  // Loaded from data/course-names.json; if that file is missing, or a code is
  // not in it, the code simply carries no name rather than a guess.
  let COURSE = {};
  const courseName = (text) => {
    const t = String(text).trim();
    if (COURSE[t]) return COURSE[t];
    const up = t.toUpperCase();
    // People typed "BIOL239" as well as "BIOL 239".
    return COURSE[up] || COURSE[up.replace(/^([A-Z]+)(\d)/, "$1 $2")] || null;
  };

  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)");
  const PHONE = matchMedia("(max-width: 42rem)");

  /* ----------------------------------------------------------- small utils */

  const sum = (a) => a.reduce((x, y) => x + y, 0);

  const median = (a) => {
    const s = [...a].sort((x, y) => x - y);
    return s.length % 2 ? s[(s.length - 1) / 2]
                        : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };

  const longest = (labels) =>
    Math.max(0, ...(labels || []).map((l) => String(l).length));

  // Only ever fed a URL from the data file; an id that does not match the
  // 11-character YouTube shape is refused rather than embedded.
  const getYouTubeId = (url) => {
    if (!url) return null;
    const m = String(url).match(
      /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/
    );
    return m ? m[1] : null;
  };

  /* --------------------------------------------------- what colour, and why */

  // Questions where answering "yes" is the bad news.
  const ADVERSE =
    /reneg|rescind|fail|cheat|mental health|suicid|concern|drug|substance|situationship|balding|taking your job/i;

  const ORDERED_WORDS = [
    ["outstanding", "excellent", "very good", "good", "satisfactory"],
    ["micro", "small", "medium", "large", "extra large"],
  ];

  // Co-op #1..#6, or the eight study terms 1A..4B.
  const isTermSeries = (labels) =>
    !!labels &&
    labels.length >= 3 &&
    labels.every((l) => /^(co-?op\s*#?\s*\d|[1-4][ab])$/i.test(String(l).trim()));

  // A label set is ordinal if it reads as a scale: money bands, percent
  // bands, age bands, year counts, term names, or a known ranked vocabulary.
  const isOrdinal = (labels) => {
    if (!labels || labels.length < 3) return false;
    const low = labels.map((l) => String(l).toLowerCase().trim());

    for (const vocab of ORDERED_WORDS) {
      if (low.filter((l) => vocab.some((w) => l.startsWith(w))).length >= 3) return true;
    }
    const banded = low.filter((l) => /\d/.test(l) && /[-–%$+<>]|\byear|\bmo\b/.test(l));
    if (banded.length >= Math.ceil(labels.length * 0.6)) return true;

    // Bare numbers are a scale too — an admission average of 89..100 is a
    // distribution, and ranking it by headcount would destroy the shape.
    if (low.every((l) => l !== "" && Number.isFinite(Number(l)))) return true;

    return isTermSeries(labels);
  };

  // Spread n picks evenly across the 6-step ramp so a 5- or 8-band scale
  // still runs the full dark-to-light distance.
  const rampOf = (n) =>
    n <= 1
      ? [RAMP[2]]
      : Array.from({ length: n }, (_, i) =>
          RAMP[Math.round((i * (RAMP.length - 1)) / (n - 1))]
        );

  const YESISH = /^(yes|no|maybe|unsure|not sure|still searching)/i;

  const isBinary = (labels) =>
    !!labels &&
    labels.length <= 4 &&
    labels.filter((l) => YESISH.test(String(l).trim())).length >= 2;

  // Yes / No / Maybe reads better as one stance against a neutral than as
  // two arbitrary greys. When "yes" is the bad news it takes the accent.
  const binaryColors = (labels, title) => {
    const bad = ADVERSE.test(title);
    return labels.map((l) => {
      const s = String(l).toLowerCase();
      if (/^maybe|^unsure|^not sure|^still searching/.test(s)) return RAMP[3];
      if (s.startsWith("yes")) return bad ? ACCENT : RAMP[0];
      return NEUTRAL;
    });
  };

  // Working from a childhood bedroom, or not working, is the neutral state
  // rather than a destination.
  const IS_NEUTRAL = /^(remote\/at-home|unemployed|none|n\/a)$/i;

  // The one entry point. `distinct` is true where a series has no axis
  // label of its own — stacked segments, donut slices — and false for plain
  // bars, where the axis already names every category.
  const colorsFor = (chart, labels, distinct) => {
    const title = chart.title || "";
    if (isBinary(labels)) return binaryColors(labels, title);

    if (isOrdinal(labels)) {
      const r = rampOf(labels.length);
      // A ranked vocabulary reads best with the best outcome darkest.
      return ORDERED_WORDS[0].some((w) =>
        String(labels[0]).toLowerCase().startsWith(w)
      )
        ? r
        : r.slice().reverse();
    }

    if (!distinct) return labels.map(() => FLAT);

    let i = 0;
    return labels.map((l) =>
      IS_NEUTRAL.test(String(l).trim()) ? NEUTRAL : CAT[i++ % CAT.length]
    );
  };

  // A ring does not lay its slices along an axis, so a position in the ramp
  // means nothing there. In a donut the ramp is spent on magnitude instead:
  // the biggest share takes the darkest tone, which is also the share the
  // centre figure reports, so the ring and the number agree. Categorical
  // hues are left alone — those are already handed out biggest-first — and
  // an adverse "yes" keeps the accent wherever it lands, because that mark
  // is there to be looked at twice regardless of its size.
  const pieColors = (chart, pairs) => {
    const names = pairs.map((p) => p.name);
    const title = chart.title || "";

    if (isBinary(names)) {
      const bad = ADVERSE.test(title);
      const top = pairs.reduce((a, b) => (b.value > a.value ? b : a), pairs[0]);
      return pairs.map((p) => {
        const t = String(p.name).toLowerCase();
        if (/^maybe|^unsure|^not sure|^still searching/.test(t)) return RAMP[3];
        if (bad && t.startsWith("yes")) return ACCENT;
        return p === top ? RAMP[0] : NEUTRAL;
      });
    }

    if (isOrdinal(names)) {
      // Slices stay in scale order so the key still reads as a scale; only
      // the tone is reassigned, by rank.
      const r = rampOf(pairs.length);
      const out = new Array(pairs.length);
      pairs
        .map((p, i) => [i, p.value])
        .sort((a, b) => b[1] - a[1])
        .forEach(([i], place) => { out[i] = r[place]; });
      return out;
    }

    return colorsFor(chart, names, true);
  };

  /* ------------------------------------------------ the rolling digit reel */

  // A column is a strip of digits behind a one-cell window; only the
  // columns whose digit changed turn. Built once, at the value it lands on,
  // so the first paint is already correct for anyone who never sees it move.
  const reel = (value) => {
    const el = document.createElement("span");
    el.className = "reel";
    el.setAttribute("aria-label", String(value));

    const chars = String(value).split("");
    chars.forEach((ch, i) => {
      if (!/\d/.test(ch)) {
        const sep = document.createElement("span");
        sep.className = "reel-sep";
        sep.setAttribute("aria-hidden", "true");
        sep.textContent = ch;
        el.appendChild(sep);
        return;
      }
      const col = document.createElement("span");
      col.className = "reel-col";
      col.setAttribute("aria-hidden", "true");

      const strip = document.createElement("span");
      strip.className = "reel-strip";
      for (let d = 0; d <= 9; d++) {
        const cell = document.createElement("span");
        cell.className = "reel-digit";
        cell.textContent = String(d);
        strip.appendChild(cell);
      }
      col.appendChild(strip);
      el.appendChild(col);

      // Parked on the real digit from the first paint. If the roll never
      // runs — observer never fires, tab never shown, JS half-loaded — the
      // number on screen is still the right one. The animation rewinds and
      // replays from here rather than counting up into place.
      strip.dataset.target = ch;
      strip.style.transform = `translateY(${-Number(ch) * 1.25}em)`;
    });
    return el;
  };

  const spinReel = (el) => {
    if (el.dataset.spun) return;
    el.dataset.spun = "1";
    const strips = [...el.querySelectorAll(".reel-strip")];
    if (REDUCED.matches) return;   // already showing the right digit
    strips.forEach((strip, i) => {
      const d = Number(strip.dataset.target || 0);
      // Rewind to zero with no transition, then roll back to the digit it
      // is already parked on.
      strip.style.transition = "none";
      strip.style.transform = "translateY(0)";
      void strip.offsetHeight;
      strip.style.transition =
        `transform var(--reel-dur) var(--reel-ease) ${i * 40}ms`;
      requestAnimationFrame(() => {
        strip.style.transform = `translateY(${-d * 1.25}em)`;
      });
    });
  };

  const reelWatcher = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        spinReel(e.target);
        reelWatcher.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -10% 0px" }
  );

  /* ---------------------------------------------------- shared chart config */

  const AXIS_LABEL = {
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: 500,
    color: INK3,
  };

  // Uppercase is the instrument-panel voice, but it is only legible on
  // short ticks; a 56-character answer stays sentence case.
  const tickLabel = (labels) => {
    const up = longest(labels) <= 12;
    return {
      ...AXIS_LABEL,
      formatter: (v) => (up ? String(v).toUpperCase() : String(v)),
    };
  };

  const VALUE_LABEL = {
    fontFamily: MONO,
    fontSize: 10.5,
    fontWeight: 500,
    color: INK2,
  };

  // Hairline, dotted, and only on the value axis — the category axis never
  // needs a grid to be read.
  const splitLine = {
    show: true,
    lineStyle: { color: RULE, width: 1, type: [2, 3] },
  };

  const noAxisLine = { show: false };
  const noTick = { show: false };

  // ECharts accepts a DOM node back from a tooltip formatter. Survey text
  // is author-supplied, so it is always set with textContent and never
  // interpolated into an HTML string.
  const tipNode = (rows, heading) => {
    const box = document.createElement("div");
    box.style.cssText =
      `font-family:${SANS};min-width:0;display:grid;gap:3px;`;
    if (heading) {
      const h = document.createElement("div");
      h.style.cssText =
        `font-family:${MONO};font-size:10px;letter-spacing:.09em;` +
        `text-transform:uppercase;color:${INK3};padding-bottom:2px`;
      h.textContent = heading;
      box.appendChild(h);
    }
    for (const [k, v, swatch] of rows) {
      const r = document.createElement("div");
      r.style.cssText =
        "display:flex;align-items:baseline;gap:8px;justify-content:space-between;font-size:13px";
      const left = document.createElement("span");
      left.style.cssText = "display:flex;align-items:center;gap:6px;min-width:0";
      if (swatch) {
        const s = document.createElement("span");
        s.style.cssText =
          `width:8px;height:8px;flex:none;border-radius:2px;background:${swatch}`;
        left.appendChild(s);
      }
      const kt = document.createElement("span");
      kt.style.cssText = `color:${INK2}`;
      kt.textContent = k;
      left.appendChild(kt);
      const vt = document.createElement("span");
      vt.style.cssText =
        `font-family:${MONO};font-variant-numeric:tabular-nums;color:${INK};font-weight:500`;
      vt.textContent = v;
      r.append(left, vt);
      box.appendChild(r);
    }
    return box;
  };

  const TOOLTIP = {
    // token, not white: a pure-white card reads cold on the warm ground
    backgroundColor: SURFACE,
    borderColor: RULE2,
    borderWidth: 1,
    padding: [9, 11],
    extraCssText:
      "border-radius:8px;box-shadow:0 8px 24px -8px rgba(0,0,0,.18);",
    textStyle: { fontFamily: SANS, fontSize: 13, color: INK },
  };

  const base = () => ({
    animation: !REDUCED.matches,
    animationDuration: 500,
    animationEasing: "cubicOut",
    textStyle: { fontFamily: SANS },
    grid: { left: 2, right: 10, top: 12, bottom: 2, containLabel: true },
    tooltip: { ...TOOLTIP },
  });

  // Keys are HTML, not chart furniture. ECharts reserves one row of
  // headroom for a legend and then wraps it onto two on a narrow screen,
  // where it lands on the plot; a list in the page just flows.
  const keyList = (labels, colors) => {
    const ul = document.createElement("ul");
    ul.className = "key";
    labels.forEach((l, i) => {
      const li = document.createElement("li");
      const sw = document.createElement("span");
      sw.className = "sw";
      sw.style.background = colors[i];
      const nm = document.createElement("span");
      nm.textContent = l;
      li.append(sw, nm);
      ul.appendChild(li);
    });
    return ul;
  };

  const respondents = (chart) => {
    if (chart.total) return chart.total;
    if (["bar", "pie", "doughnut"].includes(chart.type) &&
        Array.isArray(chart.data) && typeof chart.data[0] === "number") {
      return sum(chart.data);
    }
    return null;
  };

  // Stacked and grouped charts carry no `total`, so derive the count from
  // the tallest column.
  const stackedCount = (chart) => {
    const sets = chart.datasets;
    if (!Array.isArray(sets) || !sets.length) return null;
    const n = sets[0].data.length;
    const totals = Array.from({ length: n }, (_, i) =>
      sets.reduce((a, d) => a + (d.data[i] || 0), 0)
    );
    const top = Math.max(...totals);
    if (!top) return null;
    // Some grouped charts plot averages, and summing those is not a count of
    // anyone — that is what produced "up to 4.699999999999999 answered".
    if (!Number.isInteger(top)) return null;
    return { n: top };
  };

  /* --------------------------------------------------- free-text treatments */

  // Short answers (course codes, companies, countries) become a weighted
  // field. Long answers stay sentences and are printed as written, because
  // they are the class talking rather than the survey counting.
  const wantsVerbatim = (words) => median(words.map((w) => w.text.trim().length)) > 18;

  const renderField = (words, host) => {
    const top = Math.max(...words.map((w) => w.weight));
    const scale = (w) => {
      const t = top > 1 ? (Math.sqrt(w) - 1) / (Math.sqrt(top) - 1) : 0;
      return (1.0 + t * 1.85).toFixed(2) + "rem";
    };
    const sorted = [...words].sort(
      (a, b) => b.weight - a.weight || a.text.localeCompare(b.text)
    );

    const field = document.createElement("div");
    field.className = "field";
    for (const w of sorted) {
      const b = document.createElement("b");
      b.style.setProperty("--sz", scale(w.weight));
      if (w.weight === 1) b.className = "is-one";
      b.textContent = w.text.trim();
      const name = courseName(w.text);
      if (name) {
        b.dataset.name = name;
        // Reachable without a pointer, and announced by a screen reader.
        b.tabIndex = 0;
        b.setAttribute("aria-label", `${w.text.trim()} \u2014 ${name}`);
      }
      if (w.weight > 1) {
        const sup = document.createElement("sup");
        sup.textContent = w.weight;
        b.appendChild(sup);
      }
      field.appendChild(b);
    }
    host.appendChild(field);
    return field;
  };

  const renderVerbatim = (words, host) => {
    const sorted = [...words].sort(
      (a, b) => b.weight - a.weight || b.text.length - a.text.length
    );
    const ul = document.createElement("ul");
    ul.className = "answers";
    for (const w of sorted) {
      const li = document.createElement("li");
      li.textContent = w.text.trim();
      if (w.weight > 1) {
        const n = document.createElement("small");
        n.textContent = `said ${w.weight}x`;
        li.appendChild(n);
      }
      ul.appendChild(li);
    }
    host.appendChild(ul);
    return ul;
  };

  /* ------------------ paging the weighted term fields down to phone size */

  // Short terms stay a single weighted field — there is nothing to read
  // one at a time — so these only need dealing out on a narrow screen.

  // Fields page on a phone so a 48-company list is not a wall of text. The
  // label names the totals rather than the page number: "1-14 of 48" answers
  // "am I seeing all of them?", which a bare "1 / 4" did not — the companies
  // held back simply read as missing.
  const paginateField = (fig, items, per) => {
    if (items.length <= per) return;
    const pages = Math.ceil(items.length / per);
    let page = 0;

    const pager = document.createElement("div");
    pager.className = "pager pager-field";

    const mk = (label, text) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pager-btn";
      b.setAttribute("aria-label", label);
      b.textContent = text;
      return b;
    };
    const prev = mk("Previous page", "\u2039");
    const next = mk("Next page", "\u203A");
    const at = document.createElement("span");
    at.className = "pager-at";
    at.setAttribute("aria-live", "polite");
    pager.append(prev, at, next);
    fig.appendChild(pager);

    const draw = () => {
      items.forEach((el, i) =>
        el.classList.toggle("is-hidden", Math.floor(i / per) !== page)
      );
      const from = page * per + 1;
      const to = Math.min(items.length, (page + 1) * per);
      at.textContent = `${from}\u2013${to} of ${items.length}`;
      prev.disabled = page === 0;
      next.disabled = page === pages - 1;
    };
    const go = (step) => {
      page = Math.min(pages - 1, Math.max(0, page + step));
      draw();
    };
    prev.addEventListener("click", () => go(-1));
    next.addEventListener("click", () => go(1));

    const sync = () => {
      if (PHONE.matches) {
        fig.classList.add("paged");
        page = 0;
        draw();
      } else {
        fig.classList.remove("paged");
        items.forEach((el) => el.classList.remove("is-hidden"));
      }
    };
    PHONE.addEventListener("change", sync);
    sync();
  };

  /* --------------------------- reading the answers: a deck, or a list */

  // The class's own writing is worth reading rather than scanning, but a
  // list scans faster and is what most people reach for, so that is the
  // default; the deck is a click away. Either way the answers are paged
  // rather than poured out in one column, because ninety in a row gets
  // skimmed. The choice is remembered — with 26 of these panels, setting
  // it once has to be enough.
  const VIEW_KEY = "syde26:answers-view";
  const VIEWS = ["cards", "list"];
  const DEFAULT_VIEW = "list";

  // How many answers a list page holds. One column on a phone, two or
  // three on a wider screen, so the page is a readable block either way.
  const LIST_PER = 9;
  const LIST_PER_PHONE = 5;

  const readView = () => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      return VIEWS.includes(v) ? v : DEFAULT_VIEW;
    } catch {
      return DEFAULT_VIEW;
    }
  };
  const writeView = (v) => {
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ }
  };

  // Every panel listens, so flipping one flips them all.
  const viewWatchers = new Set();
  const setViewEverywhere = (v) => {
    writeView(v);
    viewWatchers.forEach((fn) => fn(v));
  };

  const deck = (fig, items) => {
    let view = readView();
    let page = 0;

    const head = fig.querySelector(".fig-head");
    const stage = fig.querySelector(".answers");

    // The toggle belongs with the question, not under the answers.
    const toggle = document.createElement("div");
    toggle.className = "seg";
    toggle.setAttribute("role", "group");
    toggle.setAttribute("aria-label", "How to show the answers");

    const mkSeg = (v, label) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "seg-btn";
      b.dataset.view = v;
      b.textContent = label;
      b.addEventListener("click", () => setViewEverywhere(v));
      return b;
    };
    const segCards = mkSeg("cards", "Cards");
    const segList = mkSeg("list", "List");
    toggle.append(segCards, segList);
    // Before the respondent count, which stays hard right.
    head.insertBefore(toggle, head.querySelector(".chart-count"));

    const bar = document.createElement("div");
    bar.className = "deck-bar";

    const pager = document.createElement("div");
    pager.className = "pager";
    const mk = (label, text) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pager-btn";
      b.setAttribute("aria-label", label);
      b.textContent = text;
      return b;
    };
    const prev = mk("Previous answer", "\u2039");
    const next = mk("Next answer", "\u203A");
    const at = document.createElement("span");
    at.className = "pager-at";
    at.setAttribute("aria-live", "polite");
    pager.append(prev, at, next);
    bar.appendChild(pager);
    fig.appendChild(bar);

    const perPage = () =>
      view === "cards" ? 1 : PHONE.matches ? LIST_PER_PHONE : LIST_PER;

    // Cards are stacked on top of each other, so the stage needs a height
    // of its own — taken from the tallest card once it has laid out,
    // rather than guessed, so a long answer is never clipped.
    // Each answer is a different length, and forcing them all to the
    // tallest wastes a screen of air on "Free lunch" so that one long
    // answer fits. So every card keeps its own height and the panel
    // resizes to whichever is in front — measured once, in natural flow,
    // because a card asked for its height while stacked just reports the
    // stage's.
    let heights = [];
    const measure = () => {
      if (view !== "cards") { stage.style.height = ""; return; }
      stage.classList.add("is-measuring");
      stage.style.height = "";
      heights = items.map((el) => el.offsetHeight);
      stage.classList.remove("is-measuring");
      fit();
    };
    const fit = () => {
      const h = heights[page];
      if (h) stage.style.height = h + "px";
    };

    const draw = () => {
      const per = perPage();
      const pages = Math.max(1, Math.ceil(items.length / per));
      page = Math.min(page, pages - 1);

      if (view === "cards") {
        // Depth is how far back in the deck a card sits. The two behind
        // the front one stay visible so the stack reads as a stack, and
        // everything else waits out of sight above or below it.
        items.forEach((el, i) => {
          const depth = i - page;
          // Already read cards are parked at the back of the pile, so the
          // front card animates *into* the stack rather than off it.
          const d = depth < 0 ? 3 : Math.min(depth, 3);
          el.classList.remove("is-hidden", "is-last");
          el.style.setProperty("--d", String(d));
          // An attribute, not a match on the serialised inline style.
          el.dataset.depth = String(d);
          el.classList.toggle("is-gone", depth < 0 || depth >= 3);
          el.setAttribute("aria-hidden", String(depth !== 0));
        });
      } else {
        let last = null;
        items.forEach((el, i) => {
          const hide = Math.floor(i / per) !== page;
          el.classList.toggle("is-hidden", hide);
          el.classList.remove("is-last", "is-gone");
          el.style.removeProperty("--d");
          delete el.dataset.depth;
          el.removeAttribute("aria-hidden");
          if (!hide) last = el;
        });
        // The rule under the final visible answer would otherwise dangle.
        if (last) last.classList.add("is-last");
      }

      if (view === "cards") fit();

      at.textContent =
        view === "cards" ? `${page + 1} / ${items.length}` : `${page + 1} / ${pages}`;
      prev.disabled = page === 0;
      next.disabled = page === pages - 1;
      bar.hidden = pages <= 1;

      segCards.setAttribute("aria-pressed", String(view === "cards"));
      segList.setAttribute("aria-pressed", String(view === "list"));
      fig.dataset.view = view;
      // Only remeasure when the view changes; paging just refits.
      if (!heights.length || view !== fig.dataset.lastView) {
        fig.dataset.lastView = view;
        measure();
      }
    };

    const go = (step) => {
      const per = perPage();
      const pages = Math.max(1, Math.ceil(items.length / per));
      const was = page;
      page = Math.min(pages - 1, Math.max(0, page + step));
      if (page !== was) draw();
    };
    prev.addEventListener("click", () => go(-1));
    next.addEventListener("click", () => go(1));

    // Flick between cards. Only a clearly horizontal drag counts, so a
    // vertical swipe still scrolls the page.
    let x0 = null, y0 = null;
    fig.addEventListener("pointerdown", (e) => {
      if (view !== "cards" || e.pointerType === "mouse") return;
      x0 = e.clientX; y0 = e.clientY;
    }, { passive: true });
    fig.addEventListener("pointerup", (e) => {
      if (x0 == null) return;
      const dx = e.clientX - x0, dy = e.clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
    }, { passive: true });

    const apply = (v) => { view = v; page = 0; draw(); };
    viewWatchers.add(apply);
    PHONE.addEventListener("change", draw);
    // Width changes re-wrap the text, so the tallest card changes with it.
    addEventListener("resize", measure);
    draw();
    // One more pass once the webfont has swapped in under the text.
    if (document.fonts?.ready) document.fonts.ready.then(measure);
  };

  /* ---------------------------------------------------------- one chart cell */

  // Charts that carry a term series, a distribution or a flow lead their
  // section at full measure; small single-question charts pair up.
  const LEADS = new Set([
    "sankey", "boxplot", "percent-stacked-bar", "stacked-bar",
    "line", "grouped-bar", "metrics-bar",
  ]);

  // A bar chart whose labels are long or many is drawn lying down, where
  // the label has a whole line to itself instead of a 45-degree slant.
  // A scale with short ticks is the exception: a distribution belongs on
  // its side up, running left to right like the axis it is.
  const isHorizontal = (chart) => {
    if (chart.type !== "bar") return false;
    const labels = chart.labels || [];
    if (isOrdinal(labels) && longest(labels) <= 8) return false;
    return longest(labels) > 14 || labels.length > 8;
  };

  // One track, two tracks, or the whole row — nothing in between, so a row
  // always tiles exactly. Small questions sit three-up on a wide screen and
  // only the charts that genuinely need the room take the full measure.
  const tierOf = (chart) => {
    const labels = chart.labels || [];
    const n = labels.length;
    const m = longest(labels);

    if (LEADS.has(chart.type)) return " fig--full";
    if (isHorizontal(chart)) return n > 10 || m > 30 ? " fig--full" : " fig--half";
    if (chart.type === "pie" || chart.type === "doughnut") {
      // The ring's key sits beside it, so a long answer needs two tracks
      // or the key runs back over the hole.
      return n > 6 || m > 20 ? " fig--half" : "";
    }
    if (n > 8) return " fig--full";
    if (n <= 6 && m <= 16) return "";
    return " fig--half";
  };

  const renderChart = (chart, grid) => {
    const words = chart.type === "wordcloud" ? chart.words || [] : null;
    const verbatim = words && words.length && wantsVerbatim(words);

    const fig = document.createElement("figure");
    fig.className = verbatim ? "fig verbatim" : "fig" + tierOf(chart);

    const head = document.createElement("div");
    head.className = "fig-head";

    const title = document.createElement("h3");
    title.className = "fig-title";
    title.textContent = chart.title;
    head.appendChild(title);

    let count = respondents(chart);
    if (!count) {
      const st = stackedCount(chart);
      // The tallest column, stated plainly: "up to" read as hedging.
      if (st) count = st.n;
    }
    if (count) {
      const c = document.createElement("p");
      c.className = "chart-count micro";
      c.append(reel(count), " answered");
      head.appendChild(c);
      reelWatcher.observe(c.querySelector(".reel"));
    }
    fig.appendChild(head);

    if (chart.description) {
      const d = document.createElement("p");
      d.className = "fig-desc";
      d.textContent = chart.description;
      fig.appendChild(d);
    }

    grid.appendChild(fig);

    if (words) {
      if (!words.length) return;
      if (verbatim) {
        deck(fig, [...renderVerbatim(words, fig).children]);
      } else {
        // A term field's length varies too much to sit in a third.
        fig.className = "fig fig--half";
        paginateField(fig, [...renderField(words, fig).children], 14);
      }
      return;
    }

    const plot = document.createElement("div");
    plot.className = "fig-plot";
    fig.appendChild(plot);
    drawPlot(chart, plot);
  };

  /* -------------------------------------------------------------- the plots */

  const charts = [];

  const mount = (host, height, option) => {
    // A key may already be sitting in the plot, so the chart gets its own
    // box rather than taking the host's full height.
    if (host.firstChild) {
      const slot = document.createElement("div");
      host.appendChild(slot);
      host = slot;
    }
    host.style.height = height + "px";
    const inst = echarts.init(host, null, { renderer: "svg" });
    inst.setOption(option);
    charts.push(inst);
    return inst;
  };

  const drawPlot = (chart, plot) => {
    const type = chart.type;

    if (type === "sankey") return drawSankey(chart, plot);
    if (type === "line") return drawLine(chart, plot);
    if (type === "percent-stacked-bar" || type === "stacked-bar")
      return drawStacked(chart, plot);
    if (type === "grouped-bar") return drawGrouped(chart, plot);
    if (type === "boxplot") return drawBox(chart, plot);
    if (type === "pie" || type === "doughnut") return drawPie(chart, plot);
    return drawBar(chart, plot);
  };

  /* ----- flow ----- */

  // Rendered in the page. The old build put this in an iframe because
  // loading svg.js beside ApexCharts poisoned shared SVG prototypes; with
  // one charting library and a native sankey, the frame is unnecessary.
  const drawSankey = (chart, plot) => {
    // The id is namespaced by column ("c3:KW"), which is also how we know
    // which nodes sit in the last column — their names have to hang to the
    // left or they are clipped by the edge of the cell.
    const columns = [...new Set((chart.nodes || []).map((n) => String(n.id).split(":")[0]))];
    const lastColumn = columns[columns.length - 1];


    // Colour carries the one thing the diagram is about: how far through
    // the six work terms you are. Nodes take the ordered ramp by column,
    // and because links draw from their source, every ribbon inherits the
    // shade of the term it leaves — so the flow reads cold-to-warm left to
    // right instead of as one grey tangle.
    const columnRamp = rampOf(Math.max(columns.length, 2));
    const shadeOf = (id) =>
      columnRamp[Math.max(0, columns.indexOf(String(id).split(":")[0]))] || RAMP[1];

    const nodes = (chart.nodes || []).map((n) => ({
      name: n.id,
      itemStyle: { color: shadeOf(n.id) },
      label: {
        formatter: () => n.title || n.id,
        // Laid out sideways, the last column's names would run off the
        // edge, so they hang back inside instead.
        position: PHONE.matches
          ? "bottom"
          : String(n.id).split(":")[0] === lastColumn ? "left" : "right",
      },
    }));
    const links = (chart.edges || []).map((e) => ({
      source: e.source, target: e.target, value: e.value,
    }));
    const titleOf = new Map((chart.nodes || []).map((n) => [n.id, n.title || n.id]));

    // Six columns of place names cannot be read across a phone. An
    // earlier attempt gave the diagram a horizontal scroll lane, but
    // ECharts swallows the touch events inside it so it never actually
    // scrolled, and the lane's fixed width stayed behind on a window that
    // later grew. Standing the flow upright needs neither: the columns
    // become rows and the page scrolls them the way it scrolls everything
    // else.
    const upright = () => PHONE.matches;

    const layout = () => ({
      orient: upright() ? "vertical" : "horizontal",
      label: {
        fontFamily: MONO, fontSize: 9.5, fontWeight: 500, color: INK,
        // Standing up, a name sits under its bar rather than beside it.
        position: upright() ? "bottom" : "right",
        distance: 6,
        // The ribbons run under the names; a ground-coloured halo keeps
        // them readable without a solid label box.
        textBorderColor: GROUND,
        textBorderWidth: 3,
      },
    });

    const inst = mount(plot, PHONE.matches ? 1100 : 860, {
      ...base(),
      grid: undefined,
      tooltip: {
        ...TOOLTIP,
        formatter: (p) =>
          p.dataType === "edge"
            ? tipNode(
                [[`${titleOf.get(p.data.source) || ""} → ${titleOf.get(p.data.target) || ""}`,
                  String(p.data.value)]]
              )
            : tipNode([[titleOf.get(p.name) || p.name, String(p.value)]]),
      },
      series: [{
        type: "sankey",
        data: nodes,
        links,
        left: 2, right: 8, top: 8, bottom: 8,
        nodeWidth: 9,
        nodeGap: 9,
        nodeAlign: "justify",
        itemStyle: { borderWidth: 0, borderRadius: 2 },
        lineStyle: { color: "source", opacity: 0.3, curveness: 0.5 },
        // Tracing one path lights it in the accent, the same as hovering
        // any other mark on the page.
        emphasis: {
          focus: "adjacency",
          lineStyle: { opacity: 0.55 },
          itemStyle: { color: ACCENT },
        },
        select: { disabled: true },
        ...layout(),
      }],
    });

    // The orientation is a layout decision, not a size one, so a window
    // that crosses the phone breakpoint has to be told — resize() alone
    // would leave a vertical flow stretched across a desktop.
    PHONE.addEventListener("change", () => {
      const host = inst.getDom();
      host.style.height = (PHONE.matches ? 1100 : 860) + "px";
      inst.setOption({ series: [{ type: "sankey", ...layout() }] });
      inst.resize();
    });
  };

  /* ----- trend ----- */

  const drawLine = (chart, plot) => {
    const sets = chart.datasets || [];
    const multi = sets.length > 1;
    // A 1px stroke needs more weight than a filled bar does, so lines take
    // only the darker half of the ramp — d5 and d6 vanish on the ground.
    const colors = multi
      ? Array.from({ length: sets.length }, (_, i) =>
          RAMP[sets.length === 1 ? 0 : Math.round((i * 3) / (sets.length - 1))]
        )
      : [RAMP[0]];

    const series = sets.map((d, i) => ({
      name: d.label,
      type: "line",
      data: d.data,
      smooth: 0.28,
      symbol: "circle",
      symbolSize: 5,
      showSymbol: !multi,
      lineStyle: { width: 2, color: colors[i] },
      itemStyle: { color: colors[i] },
      // The series names itself at its own end rather than in a key.
      endLabel: {
        show: true,
        fontFamily: MONO, fontSize: 10, fontWeight: 500,
        color: colors[i],
        formatter: () => String(d.label).toUpperCase(),
        distance: 6,
      },
      // At rest the line is just a line. Hovering fills underneath it with
      // a soft wash of its own colour, so the series being read separates
      // from the others without anything changing position.
      areaStyle: { opacity: 0 },
      emphasis: {
        focus: "series",
        lineStyle: { width: 2.5 },
        areaStyle: {
          opacity: 1,
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: colors[i] + "2E" },
            { offset: 1, color: colors[i] + "00" },
          ]),
        },
      },
      // Two series that finish at the same value would print their names on
      // top of each other; nudge them apart vertically instead.
      labelLayout: { moveOverlap: "shiftY" },
    }));

    mount(plot, 300, {
      ...base(),
      grid: { left: 2, right: 96, top: 14, bottom: 2, containLabel: true },
      tooltip: {
        ...TOOLTIP,
        trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: RULE2, type: [2, 3] } },
        formatter: (ps) =>
          tipNode(
            ps.map((p) => [p.seriesName, String(p.value), p.color]),
            ps[0]?.axisValueLabel
          ),
      },
      xAxis: {
        type: "category",
        data: chart.xLabels,
        boundaryGap: false,
        axisLine: { lineStyle: { color: RULE2 } },
        axisTick: noTick,
        axisLabel: tickLabel(chart.xLabels),
      },
      yAxis: {
        type: "value",
        min: chart.beginAtZero === false ? undefined : 0,
        axisLine: noAxisLine,
        axisTick: noTick,
        splitLine,
        axisLabel: AXIS_LABEL,
      },
      series,
    });
  };

  /* ----- composition over terms ----- */

  const drawStacked = (chart, plot) => {
    const sets = chart.datasets || [];
    const labels = sets.map((d) => d.label);
    const colors = colorsFor({ ...chart, data: [] }, labels, true);
    const pct = chart.type === "percent-stacked-bar";

    const cols = sets[0]?.data.length || 0;
    const totals = Array.from({ length: cols }, (_, i) =>
      sets.reduce((a, s) => a + (s.data[i] || 0), 0)
    );

    const series = sets.map((d, i) => ({
      name: d.label,
      type: "bar",
      stack: "s",
      data: pct
        ? d.data.map((v, j) => (totals[j] ? +((v / totals[j]) * 100).toFixed(1) : 0))
        : d.data,
      // Each segment is a bar too, so it takes the same soft corner. The
      // ground-coloured hairline keeps the rounding legible where two
      // segments meet instead of notching into each other.
      itemStyle: {
        color: colors[i],
        borderRadius: 3,
        borderColor: GROUND,
        borderWidth: 1.5,
      },
      barMaxWidth: 58,
      emphasis: { focus: "series" },
    }));

    plot.appendChild(keyList(labels, colors));

    mount(plot, 320, {
      ...base(),
      grid: { left: 2, right: 10, top: 10, bottom: 2, containLabel: true },
      tooltip: {
        ...TOOLTIP,
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(0,0,0,.035)" } },
        formatter: (ps) =>
          tipNode(
            ps.map((p) => [p.seriesName, pct ? p.value + "%" : String(p.value), p.color]),
            ps[0]?.axisValueLabel
          ),
      },
      xAxis: {
        type: "category",
        data: chart.xLabels,
        axisLine: { lineStyle: { color: RULE2 } },
        axisTick: noTick,
        axisLabel: tickLabel(chart.xLabels),
      },
      yAxis: {
        type: "value",
        min: 0,
        max: pct ? 100 : undefined,
        axisLine: noAxisLine,
        axisTick: noTick,
        splitLine,
        axisLabel: { ...AXIS_LABEL, formatter: (v) => (pct ? v + "%" : v) },
      },
      series,
    });
  };

  /* ----- comparison ----- */

  const drawGrouped = (chart, plot) => {
    const sets = chart.datasets || [];
    const labels = sets.map((d) => d.label);
    // Two groups are a comparison, not a scale: hold them far apart in value.
    const colors = sets.length === 2 ? [CAT[0], CAT[1]] : rampOf(sets.length);
    const unit = chart.unit || "";

    const series = sets.map((d, i) => ({
      name: d.label,
      type: "bar",
      data: d.data,
      itemStyle: { color: colors[i], borderRadius: [3, 3, 0, 0] },
      barMaxWidth: 34,
      emphasis: { focus: "series" },
    }));

    plot.appendChild(keyList(labels, colors));

    mount(plot, 310, {
      ...base(),
      grid: { left: 2, right: 10, top: 10, bottom: 2, containLabel: true },
      tooltip: {
        ...TOOLTIP,
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(0,0,0,.035)" } },
        formatter: (ps) =>
          tipNode(
            ps.map((p) => [p.seriesName, p.value + unit, p.color]),
            ps[0]?.axisValueLabel
          ),
      },
      xAxis: {
        type: "category",
        data: chart.xLabels,
        axisLine: { lineStyle: { color: RULE2 } },
        axisTick: noTick,
        axisLabel: tickLabel(chart.xLabels),
      },
      yAxis: {
        type: "value",
        min: 0,
        max: chart.max || undefined,
        axisLine: noAxisLine,
        axisTick: noTick,
        splitLine,
        axisLabel: { ...AXIS_LABEL, formatter: (v) => v + unit },
      },
      series,
    });
  };

  /* ----- distribution ----- */

  const drawBox = (chart, plot) => {
    const fmt = (v) => (chart.boxFormat ? chart.boxFormat.replace("%s", v) : String(v));
    const unit = chart.unit ? ` ${chart.unit}` : "";

    // Five numbers per term, drawn with weight rather than outline. An
    // outlined box was the only hollow shape on a page where every other
    // mark is a solid bar, and it read as a gap. Here the middle half is a
    // solid bar, the full range is a hairline behind it, and the median is
    // cut out of the bar in the ground colour — so the eye gets the same
    // five values with none of the chart junk.
    const five = chart.data;               // [low, q1, median, q3, high]
    const at = (k) => five.map((d) => d[k]);
    const low = at(0), q1 = at(1), med = at(2), q3 = at(3), high = at(4);

    const cells = five.map((d, i) => [i, ...d]);
    const ENC = { x: 0, y: [1, 2, 3, 4, 5] };

    // Which column the cursor is over, read by renderItem below.
    let hot = -1;

    const renderItem = (params, api) => {
      const cat = api.value(0);
      const lit = cat === hot;
      const yOf = (v) => api.coord([cat, v])[1];
      const x = api.coord([cat, api.value(1)])[0];

      // Wide enough to read as a bar, never wider than its own slot. The
      // cap rises when there are only two or three groups, or the marks
      // swim in a plot sized for six terms.
      const cap = five.length <= 3 ? 52 : 26;
      const w = Math.max(10, Math.min(cap, api.size([1, 0])[0] * 0.34));
      const yHigh = yOf(api.value(5));
      const yQ3 = yOf(api.value(4));
      const yMed = yOf(api.value(3));
      const yQ1 = yOf(api.value(2));
      const yLow = yOf(api.value(1));

      return {
        type: "group",
        children: [
          {
            type: "rect",
            shape: { x: x - 0.75, y: yHigh, width: 1.5, height: yLow - yHigh, r: 0.75 },
            style: { fill: lit ? ACCENT : RAMP[4] },
          },
          {
            type: "rect",
            shape: {
              x: x - w / 2, y: yQ3, width: w,
              height: Math.max(1, yQ1 - yQ3),
              // The same soft corner the bars carry.
              r: 3,
            },
            style: { fill: lit ? ACCENT : RAMP[2] },
          },
          // The median is a slot cut through the bar, so it stays legible
          // whether it sits high or low inside the middle half.
          {
            type: "rect",
            shape: { x: x - w / 2, y: yMed - 1, width: w, height: 2, r: 1 },
            style: { fill: GROUND },
          },
        ],
      };
    };

    const inst = mount(plot, 320, {
      ...base(),
      tooltip: {
        ...TOOLTIP,
        trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: RULE2, type: [2, 3] } },
        formatter: (ps) => {
          const i = ps[0]?.dataIndex ?? 0;
          return tipNode(
            [
              ["high", fmt(high[i]) + unit],
              ["75th", fmt(q3[i]) + unit],
              ["median", fmt(med[i]) + unit],
              ["25th", fmt(q1[i]) + unit],
              ["low", fmt(low[i]) + unit],
            ],
            String(chart.labels[i])
          );
        },
      },
      xAxis: {
        type: "category",
        data: chart.labels,
        axisLine: { lineStyle: { color: RULE2 } },
        axisTick: noTick,
        axisLabel: tickLabel(chart.labels),
      },
      yAxis: {
        type: "value",
        min: (() => {
          const lo = Math.min(...low);
          const fit = Math.max(lo >= 0 ? 0 : -Infinity, Math.floor((lo - 4) / 5) * 5);
          return chart.yMin != null ? Math.max(chart.yMin, fit) : fit;
        })(),
        scale: true,
        axisLine: noAxisLine,
        axisTick: noTick,
        splitLine,
        axisLabel: { ...AXIS_LABEL, formatter: (v) => fmt(v) },
      },
      series: [{ type: "custom", data: cells, encode: ENC, renderItem }],
    });

    // Custom-series children ignore a declarative `emphasis`, so the
    // highlight is driven from the axis pointer instead: note which column
    // the cursor is over and re-render, so the whole column takes the
    // accent the bars use.
    inst.on("updateAxisPointer", (e) => {
      const info = e.axesInfo && e.axesInfo[0];
      const next = info && info.value != null ? Number(info.value) : -1;
      if (next === hot) return;
      hot = next;
      inst.setOption({ series: [{ type: "custom", data: cells, encode: ENC, renderItem }] });
    });
    inst.getZr().on("globalout", () => {
      if (hot === -1) return;
      hot = -1;
      inst.setOption({ series: [{ type: "custom", data: cells, encode: ENC, renderItem }] });
    });
  };

  /* ----- part of a whole ----- */

  const drawPie = (chart, plot) => {
    const denom = chart.total ?? sum(chart.data);
    const ordinal = isOrdinal(chart.labels);
    // A scale (income bands, ratings) has to stay in its own order or the
    // ramp stops meaning anything. Everything else is ranked, biggest first.
    const pairs = chart.labels.map((l, i) => ({ name: l, value: chart.data[i] }));
    if (!ordinal) pairs.sort((a, b) => b.value - a.value);

    // Above six slices a ring is a colour-matching exercise; the same
    // part-of-whole reads instantly as a ranked bar with its share printed.
    if (pairs.length > 6) {
      return drawBar(
        {
          ...chart,
          type: "bar",
          labels: pairs.map((p) => p.name),
          data: pairs.map((p) => p.value),
          _share: denom,
          _sorted: !ordinal,
        },
        plot
      );
    }

    const colors = pieColors(chart, pairs);
    const top = pairs[0];

    // Three HTML boxes: the ring, the figure sitting in its hole, and the
    // key beside it. Laying these out in the page rather than inside the
    // chart is what keeps the centre actually centred and lets a long
    // answer wrap instead of being clipped.
    const box = document.createElement("div");
    box.className = "donut";

    const ringHost = document.createElement("div");
    ringHost.className = "donut-ring";
    const SIZE = 200;
    ringHost.style.width = SIZE + "px";

    const mid = document.createElement("div");
    mid.className = "donut-mid";
    const pct = document.createElement("strong");
    pct.className = "donut-pct";
    pct.textContent = denom ? Math.round((top.value / denom) * 100) + "%" : "\u2014";
    const of = document.createElement("span");
    of.className = "donut-of micro";
    of.textContent = top.name;
    mid.append(pct, of);

    const key = document.createElement("ul");
    key.className = "donut-key";
    pairs.forEach((p, i) => {
      const li = document.createElement("li");
      const sw = document.createElement("span");
      sw.className = "sw";
      sw.style.background = colors[i];
      const nm = document.createElement("span");
      nm.textContent = p.name;
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = String(p.value);
      li.append(sw, nm, n);
      key.appendChild(li);
    });

    ringHost.appendChild(mid);
    box.append(ringHost, key);
    plot.appendChild(box);

    const inst = mount(ringHost, SIZE, {
      ...base(),
      grid: undefined,
      tooltip: {
        ...TOOLTIP,
        trigger: "item",
        formatter: (p) =>
          tipNode([[
            p.name,
            `${p.value} of ${denom}  ${denom ? ((p.value / denom) * 100).toFixed(0) : 0}%`,
            p.color,
          ]]),
      },
      series: [{
        type: "pie",
        radius: ["62%", "88%"],
        center: ["50%", "50%"],
        padAngle: 1.5,
        itemStyle: { borderRadius: 3 },
        data: pairs.map((p, i) => ({ ...p, itemStyle: { color: colors[i] } })),
        label: { show: false },
        labelLine: { show: false },
        emphasis: { scaleSize: 4, itemStyle: { color: ACCENT } },
      }],
    });

    // Hovering a slice promotes it into the hole, so the ring and the
    // figure under the cursor always agree.
    inst.on("mouseover", (e) => {
      if (e.dataIndex == null) return;
      const p = pairs[e.dataIndex];
      pct.textContent = denom ? Math.round((p.value / denom) * 100) + "%" : "\u2014";
      of.textContent = p.name;
    });
    inst.on("globalout", () => {
      pct.textContent = denom ? Math.round((top.value / denom) * 100) + "%" : "\u2014";
      of.textContent = top.name;
    });
  };

  /* ----- counts ----- */

  const drawBar = (chart, plot) => {
    const data = chart.data;
    const labels = chart.labels;
    const denom = chart._share || respondents(chart);
    const unit = chart.unit || "";
    const horizontal = isHorizontal(chart) || chart._sorted;
    const colors = colorsFor(chart, labels, false);

    // A lying-down bar chart is a ranking: alphabetical order makes the
    // reader do the sorting. A scale keeps its own order.
    const rank = horizontal && !isOrdinal(labels) && !chart._sorted;
    let rows = labels.map((l, i) => ({ l, v: data[i], c: colors[i] }));
    if (rank) rows.sort((a, b) => b.v - a.v);

    // The value belongs at the end of its own bar, not on a y-axis the eye
    // has to walk back to.
    const valueLabel = {
      show: true,
      position: horizontal ? "right" : "top",
      ...VALUE_LABEL,
      formatter: (p) => String(p.value) + unit,
    };

    const series = [{
      type: "bar",
      data: rows.map((r) => ({
        value: r.v,
        name: r.l,
        itemStyle: {
          color: r.c,
          borderRadius: horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0],
        },
      })),
      barMaxWidth: horizontal ? 18 : 44,
      label: valueLabel,
      emphasis: { itemStyle: { color: ACCENT } },
    }];

    const tip = {
      ...TOOLTIP,
      trigger: "item",
      formatter: (p) =>
        tipNode([[
          p.name,
          denom
            ? `${p.value} of ${denom}  ${((p.value / denom) * 100).toFixed(0)}%`
            : String(p.value) + unit,
        ]]),
    };

    if (horizontal) {
      // Enough room per row to read the label, plus headroom for the value
      // printed past the end of the longest bar. The floor is set near the
      // height of a plain vertical bar chart so a four-row ranking does not
      // leave a hole under it when it shares a grid row with a taller one.
      const h = Math.max(250, labels.length * 34 + 30);
      return mount(plot, h, {
        ...base(),
        grid: { left: 2, right: 34, top: 6, bottom: 2, containLabel: true },
        tooltip: tip,
        xAxis: {
          type: "value", min: 0,
          axisLine: noAxisLine, axisTick: noTick,
          splitLine, axisLabel: { show: false },
        },
        yAxis: {
          type: "category",
          // ECharts stacks the first category at the bottom; reversing
          // puts the largest answer at the top where it is read first.
          data: rows.map((r) => r.l).reverse(),
          axisLine: noAxisLine, axisTick: noTick,
          axisLabel: {
            ...AXIS_LABEL,
            fontSize: 11,
            fontFamily: longest(labels) > 24 ? SANS : MONO,
            color: INK2,
            width: PHONE.matches ? 118 : 210,
            overflow: "truncate",
            formatter: (v) => (longest(labels) <= 12 ? String(v).toUpperCase() : String(v)),
          },
        },
        series: [{ ...series[0], data: [...series[0].data].reverse() }],
      });
    }

    return mount(plot, 285, {
      ...base(),
      grid: { left: 2, right: 10, top: 22, bottom: 2, containLabel: true },
      tooltip: tip,
      xAxis: {
        type: "category",
        data: rows.map((r) => r.l),
        axisLine: { lineStyle: { color: RULE2 } },
        axisTick: noTick,
        axisLabel: { ...tickLabel(labels), interval: 0, hideOverlap: true },
      },
      yAxis: {
        type: "value", min: 0, max: chart.max || undefined,
        axisLine: noAxisLine, axisTick: noTick,
        splitLine, axisLabel: AXIS_LABEL,
      },
      series,
    });
  };

  /* ------------------------------ holding the page's height open */

  // Grids draw lazily, and an undrawn grid is zero pixels tall. That makes
  // the document far shorter than it will end up, so a link to #co-op
  // scrolls to where that section sits in a collapsed page and then the
  // content below it inflates and carries the target thousands of pixels
  // away. Reserving each grid's likely height first keeps the document a
  // stable length, so an anchor lands where it was aimed.

  // The height each renderer gives its own plot, kept beside them.
  const plotHeight = (chart) => {
    const labels = chart.labels || [];
    switch (chart.type) {
      case "sankey": return PHONE.matches ? 640 : 860;
      case "boxplot": return 320;
      case "line": return 300;
      case "stacked-bar":
      case "percent-stacked-bar": return 320 + 30;   // + its key
      case "grouped-bar": return 310 + 30;
      case "pie":
      case "doughnut":
        // Over six slices the renderer hands off to a ranked bar.
        return labels.length > 6
          ? Math.max(250, labels.length * 34 + 30)
          : 200;
      case "wordcloud": return 320;
      default:
        return isHorizontal(chart)
          ? Math.max(250, labels.length * 34 + 30)
          : 285;
    }
  };

  const CELL_CHROME = 22 + 46 + 20;   // padding-top + head min-height + plot margin

  const reserveGrid = (grid, list) => {
    if (!list.length) return;
    const styles = getComputedStyle(grid);
    const rowGap = parseFloat(styles.rowGap) || 40;
    const colGap = parseFloat(styles.columnGap) || 24;
    const track = 20 * 16;

    const width = grid.clientWidth || grid.parentElement.clientWidth || 1000;
    const tracks = Math.max(1, Math.floor((width + colGap) / (track + colGap)));

    const spanOf = (chart) => {
      const tier = tierOf(chart);
      if (tier.includes("full")) return tracks;
      if (tier.includes("half")) return Math.min(2, tracks);
      return 1;
    };

    // Lay the cells out the way the grid will, and add up the row heights.
    let total = 0, used = 0, rowMax = 0;
    for (const chart of list) {
      const span = Math.min(spanOf(chart), tracks);
      const h = plotHeight(chart) + CELL_CHROME;
      if (used + span > tracks) {
        total += rowMax + rowGap;
        used = 0;
        rowMax = 0;
      }
      used += span;
      rowMax = Math.max(rowMax, h);
    }
    total += rowMax;
    grid.style.minHeight = Math.round(total) + "px";
  };

  /* ------------------------------------------------------------- page build */

  const [res, courseRes] = await Promise.all([
    fetch("data/class-profile.json"),
    // Optional: the page works without it, the codes just lose their names.
    fetch("data/course-names.json").catch(() => null),
  ]);
  const config = JSON.parse(await res.text());
  if (courseRes && courseRes.ok) {
    try { COURSE = await courseRes.json(); } catch { COURSE = {}; }
  }

  const navList = document.getElementById("nav-links");
  const tickList = document.getElementById("tick-list");
  const host = document.getElementById("sections");

  // Every question, so the search has something to look through.
  const questions = [];

  // Fold case, strip accents, and drop punctuation so "co-op", "Co op"
  // and "coop" all land on the same string.
  const norm = (v) =>
    String(v)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9%$+ ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  // How well one term matches one string. A hit at the start of a word
  // beats one buried mid-word, which beats letters merely appearing in
  // order — so "gpa" finds "Average cGPA" and "coopearn" still finds
  // "Co-op Earnings", but only as a last resort.
  const scoreTerm = (hay, term, fuzzy) => {
    if (!hay) return 0;
    const i = hay.indexOf(term);
    if (i === 0) return 100;
    if (i > 0) return hay[i - 1] === " " ? 88 - Math.min(i, 60) * 0.1 : 62 - Math.min(i, 60) * 0.1;

    // Letters-in-order is only meaningful against a short string. Run it
    // over every answer in a section joined together and almost any query
    // "matches" something, which is how "kinton" found "Balding".
    if (!fuzzy || term.length < 4) return 0;

    let j = 0, gaps = 0, last = -1;
    for (let k = 0; k < hay.length && j < term.length; k++) {
      if (hay[k] === term[j]) {
        if (last >= 0) gaps += k - last - 1;
        last = k;
        j++;
      }
    }
    return j === term.length ? Math.max(6, 34 - gaps * 0.5) : 0;
  };

  // Every term has to land somewhere, or it is not a match at all.
  // Answers are still searched — "kinton" still finds Favourite Restaurant —
  // but a result row states the question only, so the list reads as a list of
  // questions rather than question-plus-fragment.
  const scoreQuestion = (q, terms) => {
    let total = 0;
    for (const term of terms) {
      let best = 0;
      for (const f of q.fields) {
        const sc = scoreTerm(f.text, term, f.fuzzy) * f.w;
        if (sc > best) best = sc;
      }
      if (!best) return null;
      total += best;
    }
    return { score: total };
  };

  config.sections.forEach((section, i) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `#${section.id}`;
    a.textContent = section.title;
    li.appendChild(a);
    navList.appendChild(li);

    // The same destination as a bar on the left edge. The name is in the
    // DOM for screen readers and revealed on hover for everyone else.
    const tli = document.createElement("li");
    const ta = document.createElement("a");
    ta.href = `#${section.id}`;
    ta.dataset.section = section.id;
    const bar = document.createElement("span");
    bar.className = "tick-bar";
    bar.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "tick-name";
    name.textContent = section.title;
    ta.append(bar, name);
    tli.appendChild(ta);
    tickList.appendChild(tli);

    // A section is two sibling bands; both carry the same tint so the
    // alternation reads as one block per section, not two.
    const band = i % 2 ? "band-b" : "band-a";

    const sec = document.createElement("section");
    sec.className = `sec ${band}`;
    sec.id = section.id;

    const wrap = document.createElement("div");
    wrap.className = "wrap";
    sec.appendChild(wrap);

    const head = document.createElement("div");
    head.className = "sec-head";

    const idx = document.createElement("p");
    idx.className = "sec-index micro";
    idx.textContent = String(i + 1).padStart(2, "0");
    head.appendChild(idx);

    const h2 = document.createElement("h2");
    h2.className = "sec-title";
    h2.textContent = section.title;
    head.appendChild(h2);

    if (section.description) {
      const d = document.createElement("p");
      d.className = "sec-desc";
      d.textContent = section.description;
      head.appendChild(d);
    }
    wrap.appendChild(head);

    if (section.quote) {
      const q = document.createElement("blockquote");
      q.className = "sec-quote";
      q.textContent = section.quote;
      const cite = document.createElement("cite");
      cite.textContent = "a SYDE 26 answer";
      q.appendChild(cite);
      wrap.appendChild(q);
    }

    host.appendChild(sec);

    const charts = section.charts || [];
    const images = section.images || [];
    if (!charts.length && !images.length) return;

    const data = document.createElement("div");
    data.className = `sec-data ${band}`;
    const dataWrap = document.createElement("div");
    dataWrap.className = "wrap";
    const grid = document.createElement("div");
    grid.className = "grid";
    dataWrap.appendChild(grid);
    data.appendChild(dataWrap);
    host.appendChild(data);

    grid.dataset.charts = JSON.stringify(charts);
    grid.dataset.images = JSON.stringify(images);
    reserveGrid(grid, charts);

    for (const chart of charts) {
      if (!chart.title) continue;

      // Searching 123 titles is not much use when what a reader remembers
      // is an answer, not the question it came from — "Toronto", "Kinton
      // Ramen", "anxiety". So the answers are indexed too, and weighted
      // below the title so a title match still wins.
      const answers = [
        ...(chart.labels || []),
        ...(chart.datasets || []).map((d) => d.label),
        ...(chart.xLabels || []),
        ...(chart.nodes || []).map((n) => n.title),
        ...(chart.words || []).map((w) => w.text),
      ].filter(Boolean).map(String);

      questions.push({
        title: chart.title,
        sectionId: section.id,
        sectionTitle: section.title,
        grid,
        answers,
        fields: [
          // Only the short, single-subject fields get letters-in-order.
          { w: 1.0, text: norm(chart.title), fuzzy: true },
          { w: 0.34, text: norm(section.title), fuzzy: true },
          { w: 0.62, text: norm(answers.join(" ")), answers: true },
          { w: 0.3, text: norm(chart.description || "") },
        ].filter((f) => f.text),
      });
    }
  });

  /* ----------------------------------------- draw only what is nearly in view */

  const drawGrid = (grid) => {
    // Search can ask for a grid the observer has not reached yet, so the
    // guard lives here rather than relying on unobserve alone.
    if (grid.dataset.drawn) return;
    grid.dataset.drawn = "1";
    const list = JSON.parse(grid.dataset.charts || "[]");
    const images = JSON.parse(grid.dataset.images || "[]");

    let i = 0;
    const next = () => {
      if (i >= list.length) {
        // Real content is in place; stop holding the estimate open so the
        // grid can settle to its true height.
        grid.style.minHeight = "";
        return;
      }
      const chart = list[i++];
      try {
        renderChart(chart, grid);
      } catch (e) {
        console.warn(`Could not render "${chart.title}"`, e);
      }
      requestAnimationFrame(next);
    };
    requestAnimationFrame(next);

    if (images.length) {
      const gal = document.createElement("div");
      gal.className = "gallery-grid";
      for (const item of images) {
        const yt = item.type === "youtube" ? getYouTubeId(item.src) || item.src : getYouTubeId(item.src);
        const isVideo = item.type === "video" || /\.(mp4|webm|ogg|mov)$/i.test(item.src);
        if (yt) {
          const f = document.createElement("iframe");
          // `start` is seconds into the video, from the data file. Coerced and
          // bounded so a stray value cannot end up in the embed URL.
          const at = Math.max(0, Math.floor(Number(item.start) || 0));
          f.src = `https://www.youtube.com/embed/${yt}` + (at ? `?start=${at}` : "");
          f.title = item.alt || "Recap video";
          f.loading = "lazy";
          f.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
          f.allowFullscreen = true;
          gal.appendChild(f);
        } else if (isVideo) {
          const v = document.createElement("video");
          v.src = item.src;
          v.controls = true;
          if (item.poster) v.poster = item.poster;
          gal.appendChild(v);
        } else {
          const img = document.createElement("img");
          img.src = item.src;
          img.alt = item.alt || "";
          img.loading = "lazy";
          gal.appendChild(img);
        }
      }
      grid.appendChild(gal);
    }
  };

  const drawer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        // One bad section must not wedge the observer: a throw here would
        // abort the batch and leave every later grid undrawn.
        try {
          drawGrid(e.target);
        } catch (err) {
          console.error("drawGrid failed", err);
        }
        drawer.unobserve(e.target);
      }
    },
    { rootMargin: "400px 0px" }
  );
  document.querySelectorAll(".grid").forEach((g) => drawer.observe(g));

  // One listener for every chart, coalesced to a frame.
  let resizing = null;
  addEventListener("resize", () => {
    if (resizing) cancelAnimationFrame(resizing);
    resizing = requestAnimationFrame(() => {
      charts.forEach((c) => c.resize());
      // A different width means a different track count, so any grid still
      // waiting to be drawn needs its estimate redone.
      document.querySelectorAll(".grid").forEach((g) => {
        if (g.children.length) return;
        reserveGrid(g, JSON.parse(g.dataset.charts || "[]"));
      });
    });
  });

  /* ----------------------------------------- landing on a linked section */

  // Everything that moves the page — a link, the arrows, a search hit —
  // lands through here, so they all agree on where the top of a section
  // is. Matches the sections' scroll-margin-top, which is what the browser
  // uses for its own anchor jumps.
  const HEAD = 56;

  // Reserving grid heights gets the document close to its final length but
  // never exactly, and arriving somewhere makes its charts draw, which
  // moves it again. So rather than correcting once, hold the target under
  // the reading line until it stops moving — then let go.
  let settling = 0;

  // `resolve` may return null at first: a search hit can name a chart in a
  // grid that has not finished drawing, and it only appears a few frames
  // later.
  // `isFinal` guards the settle: a resolver may hand back a stand-in (the
  // section, while the question's chart is still drawing) and parking on it
  // for three frames would otherwise count as arrival.
  const landOn = (resolve, clearance = HEAD, isFinal = () => true) => {
    const token = ++settling;
    let steady = 0;
    // Counted in frames, not wall-clock: a link opened in a background tab
    // gets no frames at all, and a clock-based budget would expire unused
    // before the reader ever looked at it.
    let budget = 180;

    const aim = () => {
      const el = resolve();
      return el ? Math.max(0, el.getBoundingClientRect().top + window.scrollY - clearance) : null;
    };

    // Once immediately, outside any frame, so a tab that never gets one
    // still lands in the right place the moment it is looked at.
    const first = aim();
    if (first != null) window.scrollTo({ top: first, behavior: "auto" });

    const tick = () => {
      // A newer navigation, or the reader taking over, ends this one.
      if (token !== settling) return;

      const want = aim();
      if (want == null) {
        // Target not rendered yet; keep waiting rather than giving up.
        if (--budget <= 0) { settling = 0; return; }
        requestAnimationFrame(tick);
        return;
      }

      const off = Math.abs(window.scrollY - want);
      if (off > 1) window.scrollTo({ top: want, behavior: "auto" });

      steady = off <= 1 && isFinal() ? steady + 1 : 0;
      // Three still frames means the page below has finished growing.
      if (steady >= 3 || --budget <= 0) { settling = 0; return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const settleOnHash = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    if (!document.getElementById(id)) return;
    landOn(() => document.getElementById(id));
  };

  // Any deliberate input wins immediately; never fight the reader.
  for (const ev of ["wheel", "touchstart", "keydown", "pointerdown"]) {
    addEventListener(ev, () => { settling = 0; }, { passive: true });
  }

  addEventListener("hashchange", settleOnHash);
  if (location.hash) settleOnHash();

  /* ------------------------------------------------- nav follows the reader */

  // Every section owns two links now — its menu entry and its tick — so the
  // map holds a list and one observer keeps both in step.
  const links = new Map();
  for (const a of [...navList.querySelectorAll("a"), ...tickList.querySelectorAll("a")]) {
    const id = a.getAttribute("href").slice(1);
    if (!links.has(id)) links.set(id, []);
    links.get(id).push(a);
  }

  const markSec = document.getElementById("mark-sec");
  const titleOfSection = new Map(config.sections.map((x) => [x.id, x.title]));

  const marker = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        links.forEach((els) => els.forEach((a) => a.removeAttribute("aria-current")));
        links.get(e.target.id)?.forEach((a) => a.setAttribute("aria-current", "true"));
        if (markSec) markSec.textContent = titleOfSection.get(e.target.id) || "";
      }
    },
    { rootMargin: "-20% 0px -70% 0px" }
  );
  document.querySelectorAll(".sec").forEach((s) => marker.observe(s));

  // The rail is grey-on-light; over the two dark bands it would either
  // disappear or fight them, and neither band is a section anyway.
  const ticks = document.getElementById("ticks");
  const dark = [document.querySelector(".hero"), document.querySelector(".foot")].filter(Boolean);
  if (ticks && dark.length) {
    const over = new Set();
    const shade = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) over.add(e.target);
          else over.delete(e.target);
        }
        ticks.classList.toggle("is-lit", over.size === 0);
      },
      { threshold: 0 }
    );
    dark.forEach((d) => shade.observe(d));
  }

  /* ------------------------------------------- the hero's own wallpaper */

  // A globe behind the title, turning slowly, with a dot for each place
  // the class is scattering to. It carries no survey data and is hidden
  // from assistive tech — the cities are a fixed list written here.
  //
  // The projection is real rather than faked: a great circle through the
  // poles projects to an ellipse whose semi-minor axis is R·|sin(λ+θ)|,
  // so one shared angle θ drives every meridian, and the same θ places a
  // city by latitude and longitude. Rings of latitude do not change at
  // all under rotation about the polar axis, so they are drawn once.
  const CITIES = [
    { name: "Waterloo, ON", lat: 43.46, lon: -80.52 },
    { name: "Toronto, ON", lat: 43.65, lon: -79.38 },
    { name: "Ottawa, ON", lat: 45.42, lon: -75.70 },
    { name: "New York, NY", lat: 40.71, lon: -74.01 },
    { name: "San Francisco, CA", lat: 37.77, lon: -122.42 },
    { name: "London, UK", lat: 51.51, lon: -0.13 },
  ];

  const drawHeroArt = () => {
    const hero = document.querySelector(".hero");
    if (!hero) return;

    const W = 1600, H = 900;
    const NS = "http://www.w3.org/2000/svg";
    const mk = (tag, cls) => {
      const el = document.createElementNS(NS, tag);
      if (cls) el.setAttribute("class", cls);
      return el;
    };

    const svg = mk("svg", "hero-art");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");

    const cx = W * 0.76, cy = H * 0.5, r = H * 0.46;
    const MERIDIANS = 9;
    const TILT = 20 * Math.PI / 180;   // leaning top-right to bottom-left

    // The wireframe leans; the dots are tilted by maths instead so their
    // labels can stay upright.
    const frame = mk("g");
    frame.setAttribute("transform", `rotate(20 ${cx} ${cy})`);
    svg.appendChild(frame);

    const rim = mk("circle", "wire rim");
    rim.setAttribute("cx", cx);
    rim.setAttribute("cy", cy);
    rim.setAttribute("r", r);
    frame.appendChild(rim);

    const meridians = [];
    for (let i = 0; i < MERIDIANS; i++) {
      const e = mk("ellipse", "wire");
      e.setAttribute("cx", cx);
      e.setAttribute("cy", cy);
      e.setAttribute("ry", r);
      e.setAttribute("rx", r);
      frame.appendChild(e);
      meridians.push({ el: e, lon: (i * Math.PI) / MERIDIANS });
    }

    for (let i = 1; i < 7; i++) {
      const f = i / 7;
      const e = mk("ellipse", "wire");
      e.setAttribute("cx", cx);
      e.setAttribute("cy", cy - r + 2 * r * f);
      e.setAttribute("rx", Math.sin(f * Math.PI) * r);
      e.setAttribute("ry", Math.sin(f * Math.PI) * r * 0.14);
      frame.appendChild(e);
    }

    // Dots and names live outside the tilted group so the text sits level.
    const pins = mk("g", "pins");
    svg.appendChild(pins);

    const marks = CITIES.map((c) => {
      const g = mk("g", "pin");
      const halo = mk("circle", "pin-halo");
      halo.setAttribute("r", 9);
      const dot = mk("circle", "pin-dot");
      dot.setAttribute("r", 3.5);
      const tag = mk("text", "pin-tag");
      tag.setAttribute("x", 14);
      tag.setAttribute("y", 4);
      tag.textContent = c.name.toUpperCase();
      g.append(halo, dot, tag);
      pins.appendChild(g);
      return {
        g, tag,
        lat: (c.lat * Math.PI) / 180,
        lon: (c.lon * Math.PI) / 180,
      };
    });

    hero.insertBefore(svg, hero.firstChild);

    const cosT = Math.cos(TILT), sinT = Math.sin(TILT);
    let theta = 0;
    let labelled = -1;
    let heldSince = 0;

    const place = (now) => {
      for (const m of meridians) {
        m.el.setAttribute("rx", Math.abs(Math.sin(m.lon + theta)) * r);
      }

      // Which city, if any, gets to be named right now.
      let best = -1, bestScore = Infinity;

      marks.forEach((m, i) => {
        const cl = Math.cos(m.lat);
        const x = cl * Math.sin(m.lon + theta);
        const y = Math.sin(m.lat);
        const z = cl * Math.cos(m.lon + theta);

        if (z <= 0.02) {
          // Round the back of the globe.
          m.g.style.opacity = "0";
          return;
        }

        // Tilt the point in the screen plane so it rides the leaning
        // wireframe, while its label stays horizontal.
        const px = cx + r * (x * cosT + y * sinT);
        const py = cy + r * (x * sinT - y * cosT);
        m.g.setAttribute("transform", `translate(${px.toFixed(1)} ${py.toFixed(1)})`);
        // Fades as it rounds either limb rather than blinking out.
        m.g.style.opacity = Math.min(1, z * 3.2).toFixed(2);

        // Named when it is well clear of the edge, on the near side.
        const score = Math.abs(x - 0.45) + (1 - z);
        if (z > 0.55 && score < bestScore) { bestScore = score; best = i; }
      });

      // One name at a time, held long enough to read.
      if (best !== labelled && now - heldSince > 2600) {
        labelled = best;
        heldSince = now;
      }
      marks.forEach((m, i) => m.tag.style.opacity = i === labelled ? "1" : "0");
    };

    // Placed once, synchronously, before any frame runs. An element with
    // no transform sits at the origin, so without this the pins spend the
    // wait stacked in the top-left corner — and in a backgrounded tab
    // that wait lasts until someone looks at it.
    place(performance.now());

    if (REDUCED.matches) return;

    // Declared before the loop that reads it.
    let held = false, fromX = 0, vel = 0, lastX = 0, lastT = 0;

    // The loop only runs while the hero is actually on screen.
    let live = true, raf = 0, prev = 0;
    const tick = (now) => {
      if (!live) { raf = 0; return; }
      const dt = prev ? Math.min(64, now - prev) : 16;
      prev = now;
      if (!held) theta += (dt / 1000) * (2 * Math.PI / 64);   // one turn / 64s
      place(now);
      raf = requestAnimationFrame(tick);
    };
    const start = () => { if (!raf) { prev = 0; raf = requestAnimationFrame(tick); } };
    const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };

    new IntersectionObserver((es) => {
      for (const e of es) {
        live = e.isIntersecting;
        if (live) start(); else stop();
      }
    }).observe(hero);

    // Grab and turn. With one angle to move, dragging is just setting it.
    const PER_PX = (2 * Math.PI) / (r * 3);

    svg.addEventListener("pointerdown", (e) => {
      held = true;
      fromX = lastX = e.clientX;
      lastT = e.timeStamp;
      vel = 0;
      svg.setPointerCapture(e.pointerId);
      svg.classList.add("is-held");
    });
    svg.addEventListener("pointermove", (e) => {
      if (!held) return;
      const dt = e.timeStamp - lastT;
      if (dt > 0) vel = (e.clientX - lastX) / dt;
      lastX = e.clientX;
      lastT = e.timeStamp;
      theta += (e.clientX - fromX) * PER_PX;
      fromX = e.clientX;
    });
    const release = () => {
      if (!held) return;
      held = false;
      svg.classList.remove("is-held");
      // A flick keeps going for a moment before settling to the drift.
      let carry = Math.max(-9, Math.min(9, vel)) * PER_PX * 16;
      const glide = () => {
        if (held || Math.abs(carry) < 0.0004) return;
        theta += carry;
        carry *= 0.94;
        requestAnimationFrame(glide);
      };
      requestAnimationFrame(glide);
    };
    svg.addEventListener("pointerup", release);
    svg.addEventListener("pointercancel", release);

    start();
  };
  drawHeroArt();

  /* ------------------------------------ the class photo, once it arrives */

  const pic = document.getElementById("classpic");
  if (pic) {
    const img = pic.querySelector("img");
    const empty = () => pic.classList.add("is-empty");
    if (img.complete && !img.naturalWidth) empty();
    img.addEventListener("error", empty);

    // Let the class assemble itself, once. The photo is cut into a grid and
    // the tiles come up in a wave from the back of the group forward, which
    // is the order a class actually fills a set of steps.
    //
    // Held until the file has decoded, because tiling an image that has not
    // arrived yields seventy empty boxes. Reduced motion skips the whole
    // thing and keeps the plain photo.
    const assemble = () => {
      if (pic.classList.contains("is-empty")) return;
      if (pic.querySelector(".classpic-mosaic")) return;

      // Tall, narrow tiles, because the people in this photo are tall and
       // narrow — at this size one tile is roughly one person, and the five
       // rows land close to the five rows they are actually standing in.
      const COLS = 16, ROWS = 5;
      const src = img.currentSrc || img.src;

      const mosaic = document.createElement("div");
      mosaic.className = "classpic-mosaic";
      mosaic.setAttribute("aria-hidden", "true");
      mosaic.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
      mosaic.style.gridTemplateRows = `repeat(${ROWS}, 1fr)`;
      mosaic.style.setProperty("--shot", `url("${src}")`);

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const tile = document.createElement("i");
          // Standard sprite maths: blow the image up by the grid size and
          // slide each tile to its own share of it.
          tile.style.backgroundSize = `${COLS * 100}% ${ROWS * 100}%`;
          tile.style.backgroundPosition =
            `${(c / (COLS - 1)) * 100}% ${(r / (ROWS - 1)) * 100}%`;
          // Back rows first. A little jitter per tile so the wave reads as
          // people arriving rather than a blind being raised.
          // Row sets the wave, the jitter keeps its edge ragged so it reads
          // as people arriving rather than a blind being raised.
          const delay = r * 105 + Math.random() * 130;
          tile.style.setProperty("--d", `${Math.round(delay)}ms`);
          mosaic.appendChild(tile);
        }
      }

      pic.appendChild(mosaic);
      pic.classList.add("is-assembling");

      // Two frames: one for the tiles to exist in their start state, one to
      // flip them, or the browser coalesces both and nothing animates.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => pic.classList.add("is-running"))
      );

      // Hand back to the real <img> and tear the scaffolding down. Timed off
      // the longest tile rather than a transitionend, which never fires if
      // the tab is backgrounded mid-animation.
      const total = ROWS * 105 + 130 + 620 + 200;
      setTimeout(() => {
        pic.classList.add("is-assembled");
        setTimeout(() => {
          mosaic.remove();
          pic.classList.remove("is-assembling", "is-running", "is-assembled");
        }, 240);
      }, total);
    };

    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      let started = false;
      const start = () => { if (!started) { started = true; assemble(); } };
      if (img.complete && img.naturalWidth) start();
      else img.addEventListener("load", start, { once: true });
      // A stalled file must not leave the hero mid-assembly.
      setTimeout(start, 3000);
    }
  }

  /* ----------------------------------------------- the hero's own counters */

  document.querySelectorAll("[data-reel]").forEach((slot) => {
    const r = reel(slot.dataset.reel);
    slot.textContent = "";
    slot.appendChild(r);
    reelWatcher.observe(r);
  });

  /* ------------------------- the bar lists sections, then reports position */

  // While the hero is on screen the top bar carries the section list. Past
  // it the tick rail takes over, so the list would be saying the same thing
  // twice. Threshold is the hero's own height rather than a magic number.
  {
    const root = document.documentElement;
    const hero = document.querySelector(".hero");
    let cut = 140;
    const measureCut = () => {
      cut = hero ? Math.max(140, hero.offsetHeight - 120) : 140;
    };
    const syncScrolled = () => {
      root.classList.toggle("is-scrolled", window.scrollY > cut);
    };
    measureCut();
    syncScrolled();
    addEventListener("scroll", syncScrolled, { passive: true });
    addEventListener("resize", () => { measureCut(); syncScrolled(); });
  }

  /* --------------------------------------------- the sections menu on phones */

  const menuBtn = document.getElementById("menu-btn");
  const panel = document.getElementById("nav-panel");
  if (menuBtn && panel) {
    const setMenu = (open) => {
      menuBtn.setAttribute("aria-expanded", String(open));
      panel.classList.toggle("is-open", open);
    };
    menuBtn.addEventListener("click", () =>
      setMenu(menuBtn.getAttribute("aria-expanded") !== "true")
    );
    // Picking a section is the whole point, so close behind it.
    panel.addEventListener("click", (e) => {
      if (e.target.closest("a")) setMenu(false);
    });
    addEventListener("keydown", (e) => {
      if (e.key === "Escape" && menuBtn.getAttribute("aria-expanded") === "true") {
        setMenu(false);
        menuBtn.focus();
      }
    });
    // The panel only exists below 76rem; do not leave it stuck open.
    matchMedia("(min-width: 76rem)").addEventListener("change", (e) => {
      if (e.matches) setMenu(false);
    });
  }

  /* ------------------------------------------------------------- search */

  // A substring match over question titles. The typed string is only ever
  // compared and set as textContent — it never becomes markup, a selector,
  // or part of the URL.
  const find = document.getElementById("find");
  const findBtn = document.getElementById("find-btn");
  const findInput = document.getElementById("find-input");
  const findResults = document.getElementById("find-results");
  const findEmpty = document.getElementById("find-empty");

  if (find && findBtn && findInput && findResults) {
    let hits = [];
    let cursor = 0;
    let lastFocus = null;

    const go = (q) => {
      // The section has to exist before its question can be scrolled to,
      // and grids draw lazily — so draw this one now rather than waiting
      // for the observer to catch up.
      drawGrid(q.grid);
      closeFind();

      // The chart itself may be several frames from existing — its grid
      // renders one chart per frame — so aim at the question and fall back
      // to its section until it shows up.
      // A section header can sit right under the bar, but a question
      // wants air above it — landing a title flush against the sticky bar
      // clipped the first line of the answer beneath it.
      // Grids draw one chart per frame, so the fifteenth question in a
      // section is fifteen frames away. Aim at its title, fall back to the
      // section so something moves immediately, but do not call it arrived
      // until the question itself is under the bar.
      const target = () =>
        [...q.grid.querySelectorAll(".fig-title")].find((t) => t.textContent === q.title);

      landOn(
        () => target() || document.getElementById(q.sectionId),
        HEAD + 28,
        () => !!target()
      );
    };

    const mark = () => {
      const opts = [...findResults.querySelectorAll('button[role="option"]')];
      opts.forEach((b, i) => b.setAttribute("aria-selected", String(i === cursor)));
      opts[cursor]?.scrollIntoView({ block: "nearest" });
      findInput.setAttribute("aria-activedescendant", "");
    };

    const run = () => {
      const terms = findInput.value.trim().toLowerCase().split(/\s+/).map(norm).filter(Boolean);
      findResults.replaceChildren();
      hits = [];
      cursor = 0;

      if (terms.length) {
        const scored = [];
        for (const q of questions) {
          const r = scoreQuestion(q, terms);
          if (r) scored.push({ q, ...r });
        }
        scored.sort((a, b) => b.score - a.score || a.q.title.localeCompare(b.q.title));

        // Grouped under their section, best group first, so the list reads
        // as places in the document rather than a flat pile of titles.
        const order = [];
        const groups = new Map();
        for (const hit of scored.slice(0, 18)) {
          const k = hit.q.sectionTitle;
          if (!groups.has(k)) { groups.set(k, []); order.push(k); }
          groups.get(k).push(hit);
        }

        for (const name of order) {
          const head = document.createElement("li");
          head.className = "find-group micro";
          head.setAttribute("role", "presentation");
          head.textContent = name;
          findResults.appendChild(head);

          for (const hit of groups.get(name)) {
            const li = document.createElement("li");
            li.setAttribute("role", "presentation");

            const b = document.createElement("button");
            b.type = "button";
            b.setAttribute("role", "option");

            const t = document.createElement("span");
            t.className = "find-title";
            t.textContent = hit.q.title;

            const go_ = document.createElement("span");
            go_.className = "find-go micro";
            go_.textContent = "\u21B5";

            b.append(t, go_);
            b.addEventListener("click", () => go(hit.q));
            li.appendChild(b);
            findResults.appendChild(li);
            // Visual order is what the arrow keys walk.
            hits.push(hit.q);
          }
        }
      }

      findEmpty.hidden = !(terms.length && !hits.length);
      findResults.hidden = terms.length > 0 && hits.length === 0;
      if (hits.length) mark();
    };

    function openFind() {
      lastFocus = document.activeElement;
      find.hidden = false;
      document.body.style.overflow = "hidden";
      findInput.value = "";
      run();
      findInput.focus();
    }
    function closeFind() {
      find.hidden = true;
      document.body.style.overflow = "";
      lastFocus?.focus?.();
    }

    findBtn.addEventListener("click", openFind);
    document.getElementById("find-scrim")?.addEventListener("click", closeFind);
    findInput.addEventListener("input", run);

    findInput.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (!hits.length) return;
        e.preventDefault();
        cursor = (cursor + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length;
        mark();
      } else if (e.key === "Enter") {
        if (hits[cursor]) { e.preventDefault(); go(hits[cursor]); }
      }
    });

    addEventListener("keydown", (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
      if (e.key === "Escape" && !find.hidden) { closeFind(); return; }
      if (find.hidden && !typing && (e.key === "/" || ((e.metaKey || e.ctrlKey) && e.key === "k"))) {
        e.preventDefault();
        openFind();
      }
    });
  }

  /* --------------------------------- stepping through questions by thumb */

  // Sections, not questions. Stepping one chart at a time through 123 of
  // them is slower than scrolling; twelve stops is a table of contents you
  // can thumb through.
  const stops = () =>
    [...document.querySelectorAll(".sec")].map((el) => ({
      el,
      top: Math.round(el.getBoundingClientRect().top + window.scrollY),
    }));

  const step = (dir) => {
    // Where the reading line sits now, in the same terms the sections are
    // measured in — so "the next section" means the next one whose top is
    // genuinely below the line, not one a few pixels of rounding away.
    const line = window.scrollY + HEAD;
    const list = stops().sort((a, b) => a.top - b.top);
    const next =
      dir > 0
        ? list.find((s) => s.top > line + 8)
        : [...list].reverse().find((s) => s.top < line - 8);
    if (!next) return;
    // Through landOn, so the arrows hold their target while the section
    // they jumped into draws itself and pushes the page around.
    landOn(() => next.el);
  };

  const jumpBtns = [...document.querySelectorAll(".jump-btn")];
  for (const btn of jumpBtns) {
    btn.addEventListener("click", () => step(Number(btn.dataset.dir)));
  }

  // Grey out the arrow that has nowhere left to go.
  if (jumpBtns.length) {
    const sync = () => {
      const atTop = window.scrollY < 8;
      const atEnd =
        window.scrollY + window.innerHeight >=
        document.documentElement.scrollHeight - 8;
      jumpBtns.forEach((b) => {
        b.disabled = Number(b.dataset.dir) < 0 ? atTop : atEnd;
      });
    };
    addEventListener("scroll", sync, { passive: true });
    sync();
  }
});
