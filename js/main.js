/* ===========================================================================
   SYDE 26 Class Profile — rendering

   Colour is never decorative here. The term ramp (t1..t6) means "how far
   along you are", so it is spent only on series that are genuinely ordered:
   work terms, study terms, income brackets, ratings, company sizes. The
   axis labels ("Co-op #1".."Co-op #6") carry the key. Everything unordered
   gets a flat colour or the categorical set; red is reserved for adverse
   facts.
   ======================================================================== */

document.addEventListener("DOMContentLoaded", async () => {
  const ROOT = getComputedStyle(document.documentElement);
  const tok = (n) => ROOT.getPropertyValue(n).trim();

  const RAMP = ["--t1", "--t2", "--t3", "--t4", "--t5", "--t6"].map(tok);
  const CAT = ["--k1", "--k2", "--k3", "--k4", "--k5", "--k6", "--k7"].map(tok);
  const FLAG = tok("--flag");
  const MUTE = tok("--mute");
  const LIT = tok("--lit");
  const LIT2 = tok("--lit-2");
  const RULE = tok("--night-rule");
  const SANS = "'Archivo', system-ui, sans-serif";

  // Lighten toward white; keeps contrast on the night ground rising.
  const lighten = (hex, amt) => {
    const n = parseInt(hex.slice(1), 16);
    const mix = (c) => Math.round(c + (255 - c) * amt);
    return (
      "#" +
      [(n >> 16) & 255, (n >> 8) & 255, n & 255]
        .map((c) => mix(c).toString(16).padStart(2, "0"))
        .join("")
    );
  };

  // A chart with more categories than the palette has hues gets a second lap
  // at a lighter value rather than repeating a colour it already used.
  const catColor = (i) => {
    const lap = Math.floor(i / 7);
    const c = CAT[i % 7];
    return lap === 0 ? c : lighten(c, Math.min(0.62, 0.34 * lap));
  };

  /* ----------------------------------------------------------- small utils */

  const slugify = (t) =>
    t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const sum = (a) => a.reduce((x, y) => x + y, 0);

  const median = (a) => {
    const s = [...a].sort((x, y) => x - y);
    return s.length % 2 ? s[(s.length - 1) / 2]
                        : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };

  const niceMax = (v) => Math.ceil((Math.max(...v) * 1.1) / 10) * 10;

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

  // A label set is ordinal if it reads as a scale: money bands, percent
  // bands, age bands, year counts, term names, or a known ranked vocabulary.
  const isOrdinal = (labels) => {
    if (!labels || labels.length < 3) return false;
    const low = labels.map((l) => String(l).toLowerCase().trim());

    for (const vocab of ORDERED_WORDS) {
      const hits = low.filter((l) => vocab.some((w) => l.startsWith(w)));
      if (hits.length >= 3) return true;
    }
    const banded = low.filter((l) =>
      /\d/.test(l) && /[-–%$+<>]|\byear|\bmo\b/.test(l)
    );
    if (banded.length >= Math.ceil(labels.length * 0.6)) return true;

    return isTermSeries(labels);
  };

  // Co-op #1..#6, or the eight study terms 1A..4B.
  const isTermSeries = (labels) =>
    !!labels &&
    labels.length >= 3 &&
    labels.every((l) => /^(co-?op\s*#?\s*\d|[1-4][ab])$/i.test(String(l).trim()));

  // Spread n picks evenly across the 6-step ramp so a 5- or 8-band scale
  // still runs the full cold-to-warm distance.
  const rampOf = (n) =>
    n <= 1
      ? [RAMP[1]]
      : Array.from({ length: n }, (_, i) =>
          RAMP[Math.round((i * (RAMP.length - 1)) / (n - 1))]
        );

  const YESISH = /^(yes|no|maybe|unsure|not sure|still searching)/i;

  // Yes / No / Maybe questions read better as one stance against a neutral
  // than as two arbitrary hues.
  const binaryColors = (labels, title) => {
    const bad = ADVERSE.test(title);
    return labels.map((l) => {
      const s = String(l).toLowerCase();
      if (/^maybe|^unsure|^not sure|^still searching/.test(s)) return CAT[1];
      if (s.startsWith("yes")) return bad ? FLAG : CAT[0];
      if (s.startsWith("no")) return MUTE;
      return MUTE;
    });
  };

  const isBinary = (labels) =>
    !!labels &&
    labels.length <= 4 &&
    labels.filter((l) => YESISH.test(String(l).trim())).length >= 2;

  // Working from a childhood bedroom, or not working, is the neutral state
  // rather than a destination — holding it grey is what makes the class
  // leaving home visible in the location charts.
  const NEUTRAL = /^(remote\/at-home|unemployed|none|n\/a)$/i;

  // The one entry point. `distinct` is true where a series has no axis label
  // of its own — stacked segments, pie slices, grouped series — and false for
  // plain bars, where the x-axis already names every category and per-bar
  // colour would be decoration.
  const colorsFor = (chart, labels, distinct) => {
    const title = chart.title || "";
    if (isBinary(labels)) return binaryColors(labels, title);

    if (isOrdinal(labels)) {
      const r = rampOf(labels.length);
      // A ranked vocabulary reads best with the best outcome warmest.
      return ORDERED_WORDS[0].some((w) =>
        String(labels[0]).toLowerCase().startsWith(w)
      )
        ? r.slice().reverse()
        : r;
    }

    if (!distinct) return labels.map(() => CAT[0]);

    let i = 0;
    return labels.map((l) =>
      NEUTRAL.test(String(l).trim()) ? MUTE : catColor(i++)
    );
  };

  /* ---------------------------------------------------- shared chart config */

  const axisStyle = {
    style: { fontFamily: SANS, fontSize: "12px", colors: LIT2 },
  };

  const base = (height) => ({
    chart: {
      height,
      background: "transparent",
      foreColor: LIT2,
      fontFamily: SANS,
      toolbar: { show: false },
      animations: { enabled: false },
    },
    // No `theme.mode`: it drags in grid banding and palette defaults that
    // fight the system. Every colour here is set explicitly instead.
    grid: {
      borderColor: RULE,
      strokeDashArray: 0,
      padding: { left: 4, right: 8 },
      row: { colors: [], opacity: 0 },
      column: { colors: [], opacity: 0 },
    },
    fill: { opacity: 1 },
    dataLabels: { enabled: false },
    tooltip: { theme: "dark", style: { fontFamily: SANS } },
    states: { hover: { filter: { type: "lighten", value: 0.08 } } },
  });

  const axisTitle = (text) =>
    text && text.length
      ? { title: { text, style: { fontFamily: SANS, fontSize: "12px", color: LIT2, fontWeight: 500 } } }
      : {};

  const rotated = (labels) =>
    (labels || []).some((l) => String(l).length > 18)
      ? { ...axisStyle, rotate: -45, hideOverlappingLabels: false, trim: false, maxHeight: 140 }
      : axisStyle;

  const legend = (show) => ({
    show,
    position: "top",
    horizontalAlign: "left",
    offsetX: -8,
    markers: { width: 9, height: 9, radius: 0, shape: "square", offsetX: -3 },
    itemMargin: { horizontal: 10, vertical: 3 },
    fontFamily: SANS,
    fontSize: "12px",
  });

  const respondents = (chart) => {
    if (chart.total) return chart.total;
    if (["bar", "pie", "doughnut"].includes(chart.type) &&
        Array.isArray(chart.data) && typeof chart.data[0] === "number") {
      return sum(chart.data);
    }
    return null;
  };

  // Stacked and grouped charts carry no `total`, so derive the count from the
  // tallest column and say "up to" when the columns disagree.
  const stackedCount = (chart) => {
    const sets = chart.datasets;
    if (!Array.isArray(sets) || !sets.length) return null;
    const n = sets[0].data.length;
    const totals = Array.from({ length: n }, (_, i) =>
      sets.reduce((a, d) => a + (d.data[i] || 0), 0)
    );
    const top = Math.max(...totals);
    if (!top) return null;
    return { n: top, approx: new Set(totals).size > 1 };
  };

  /* --------------------------------------------------- free-text treatments */

  // Short answers (course codes, companies, countries) become a weighted
  // field. Long answers stay sentences and are printed as written, on paper,
  // because they are the class talking rather than the survey counting.
  const wantsVerbatim = (words) => median(words.map((w) => w.text.trim().length)) > 18;

  const renderField = (words, host) => {
    const top = Math.max(...words.map((w) => w.weight));
    const scale = (w) => {
      const t = top > 1 ? (Math.sqrt(w) - 1) / (Math.sqrt(top) - 1) : 0;
      return (1.05 + t * 2.05).toFixed(2) + "rem";
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
        n.textContent = `said ${w.weight}×`;
        li.appendChild(n);
      }
      ul.appendChild(li);
    }
    host.appendChild(ul);
    return ul;
  };

  /* ------------------------ paging long answer sets down to phone size */

  const PHONE = matchMedia("(max-width: 42rem)");

  // Ninety free-text answers in one column is a minute of thumb-scrolling, so
  // on a phone they are dealt out in sets with arrows. Desktop shows them all.
  const paginate = (fig, items, per) => {
    if (items.length <= per) return;
    const pages = Math.ceil(items.length / per);
    let page = 0;

    const pager = document.createElement("div");
    pager.className = "pager";

    const prev = document.createElement("button");
    prev.type = "button";
    prev.className = "pager-btn";
    prev.setAttribute("aria-label", "Previous answers");
    prev.textContent = "\u2039";

    const at = document.createElement("span");
    at.className = "pager-at";
    at.setAttribute("aria-live", "polite");

    const next = document.createElement("button");
    next.type = "button";
    next.className = "pager-btn";
    next.setAttribute("aria-label", "More answers");
    next.textContent = "\u203A";

    pager.append(prev, at, next);
    fig.appendChild(pager);

    const draw = () => {
      let last = null;
      items.forEach((el, i) => {
        const hide = Math.floor(i / per) !== page;
        el.classList.toggle("is-hidden", hide);
        el.classList.remove("is-last");
        if (!hide) last = el;
      });
      // the rule under the final visible answer would otherwise dangle
      if (last) last.classList.add("is-last");
      at.textContent = `${page + 1} of ${pages}`;
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
        items.forEach((el) => el.classList.remove("is-hidden", "is-last"));
      }
    };
    PHONE.addEventListener("change", sync);
    sync();
  };

  /* ---------------------------------------------------------- one chart cell */

  // Charts that carry a term series, a distribution or a flow lead their
  // section at full measure; small single-question charts pair up.
  const LEADS = new Set([
    "sankey", "boxplot", "percent-stacked-bar", "stacked-bar",
    "line", "grouped-bar", "metrics-bar",
  ]);

  const longest = (labels) =>
    Math.max(0, ...(labels || []).map((l) => String(l).length));

  // Three tiers, so small questions sit three-up and only the charts that
  // genuinely need the room take the full measure.
  const tierOf = (chart) => {
    const labels = chart.labels || [];
    const n = labels.length;
    const m = longest(labels);

    if (LEADS.has(chart.type)) return "";
    if (chart.type === "pie" || chart.type === "doughnut") {
      return m > 22 ? " fig--half" : " fig--third";
    }
    if (n > 8) return "";
    if (n <= 6 && m <= 16) return " fig--third";
    return " fig--half";
  };

  const renderChart = (chart, grid) => {
    const words = chart.type === "wordcloud" ? chart.words || [] : null;
    const verbatim = words && words.length && wantsVerbatim(words);

    const fig = document.createElement("figure");
    fig.className = verbatim ? "fig verbatim" : "fig" + tierOf(chart);

    const title = document.createElement("h3");
    title.className = "fig-title";
    title.textContent = chart.title;
    fig.appendChild(title);

    let label = null;
    const count = respondents(chart);
    if (count) label = `${count} answered`;
    else {
      const st = stackedCount(chart);
      if (st) label = st.approx ? `up to ${st.n} answered` : `${st.n} answered`;
    }
    if (label) {
      const c = document.createElement("p");
      c.className = "chart-count";
      c.textContent = label;
      fig.appendChild(c);
    }

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
        paginate(fig, [...renderVerbatim(words, fig).children], 6);
      } else {
        // A term field's length varies too much to sit in a third.
        fig.className = "fig fig--half";
        paginate(fig, [...renderField(words, fig).children], 14);
      }
      return;
    }

    const plot = document.createElement("div");
    plot.className = "fig-plot";
    fig.appendChild(plot);
    drawPlot(chart, plot);
  };

  /* -------------------------------------------------------------- the plots */

  const drawPlot = (chart, plot) => {
    if (chart.type === "sankey") {
      const frame = document.createElement("iframe");
      frame.src = "sankey.html";
      frame.title = chart.title;
      frame.loading = "lazy";
      frame.setAttribute("scrolling", "no");
      frame.style.width = "100%";
      frame.style.height = "880px";
      frame.style.border = "0";
      plot.appendChild(frame);

      const payload = {
        type: "sankey-data",
        nodes: chart.nodes || [],
        edges: chart.edges || [],
        palette: { cat: CAT, mute: MUTE, lit: LIT, lit2: LIT2, rule: RULE },
      };
      const send = () => frame.contentWindow?.postMessage(payload, "*");
      window.addEventListener("message", (e) => {
        if (e.source !== frame.contentWindow) return;
        if (e.data?.type === "sankey-ready") send();
        else if (e.data?.type === "sankey-height" && e.data.value)
          frame.style.height = e.data.value + 16 + "px";
      });
      frame.addEventListener("load", send);
      return;
    }

    if (chart.type === "line") {
      const series = chart.datasets.map((d) => ({ name: d.label, data: d.data }));
      new ApexCharts(plot, {
        ...base(320),
        series,
        colors: series.length > 1 ? CAT.slice(0, series.length) : [CAT[0]],
        xaxis: { categories: chart.xLabels, labels: rotated(chart.xLabels), ...axisTitle(chart.xAxisTitle) },
        yaxis: { ...(chart.beginAtZero === false ? {} : { min: 0 }), labels: axisStyle, ...axisTitle(chart.yAxisTitle) },
        stroke: { curve: "smooth", width: 2.5 },
        fill: { type: "solid", opacity: 1 },
        markers: { size: 3.5, strokeWidth: 0, hover: { size: 6 } },
        legend: legend(series.length > 1),
        tooltip: { ...base().tooltip, shared: true, intersect: false },
      }).render();
      return;
    }

    if (chart.type === "stacked-bar" || chart.type === "percent-stacked-bar") {
      const series = chart.datasets.map((d) => ({ name: d.label, data: d.data }));
      const labels = chart.datasets.map((d) => d.label);
      const cols = series[0]?.data.length || 0;
      const totals = Array.from({ length: cols }, (_, i) =>
        series.reduce((a, s) => a + (s.data[i] || 0), 0)
      );
      const pct =
        chart.type === "percent-stacked-bar"
          ? series.map((s) => ({
              ...s,
              data: s.data.map((v, i) => (totals[i] ? +((v / totals[i]) * 100).toFixed(1) : 0)),
            }))
          : series;

      new ApexCharts(plot, {
        ...base(340),
        chart: { ...base(340).chart, type: "bar", stacked: true },
        series: pct,
        colors: colorsFor({ ...chart, data: [] }, labels, true),
        xaxis: { categories: chart.xLabels, labels: rotated(chart.xLabels), ...axisTitle(chart.xAxisTitle) },
        yaxis: {
          min: 0, max: 100,
          labels: { ...axisStyle, formatter: (v) => v + "%" },
          ...axisTitle(chart.yAxisTitle || "Share of answers"),
        },
        legend: legend(true),
        plotOptions: { bar: { columnWidth: "78%" } },
        tooltip: { ...base().tooltip, shared: true, intersect: false, y: { formatter: (v) => v + "%" } },
      }).render();
      return;
    }

    if (chart.type === "grouped-bar") {
      const series = chart.datasets.map((d) => ({ name: d.label, data: d.data }));
      const top = Math.max(...series.flatMap((s) => s.data), 0);
      // Two groups are a comparison, not a scale: hold them far apart in hue.
      const colors =
        series.length === 2 ? [CAT[0], CAT[3]] : CAT.slice(0, series.length);

      new ApexCharts(plot, {
        ...base(330),
        chart: { ...base(330).chart, type: "bar" },
        series,
        colors,
        xaxis: { categories: chart.xLabels, labels: rotated(chart.xLabels), ...axisTitle(chart.xAxisTitle) },
        yaxis: {
          min: 0,
          max: chart.max || (top > 10 ? niceMax([top]) : undefined),
          labels: { ...axisStyle, formatter: (v) => (chart.unit ? v + chart.unit : v) },
          ...axisTitle(chart.yAxisTitle || "People"),
        },
        legend: legend(series.length > 1),
        plotOptions: { bar: { columnWidth: (chart.xLabels || []).length <= 3 ? "38%" : "62%" } },
        tooltip: {
          ...base().tooltip, shared: true, intersect: false,
          y: { formatter: (v) => (chart.unit ? v + chart.unit : v) },
        },
      }).render();
      return;
    }

    if (chart.type === "boxplot") {
      const fmt = (v) => (chart.boxFormat ? chart.boxFormat.replace("%s", v) : v);
      const unit = chart.unit ? ` ${chart.unit}` : "";
      new ApexCharts(plot, {
        ...base(350),
        chart: { ...base(350).chart, type: "boxPlot" },
        series: [{
          name: chart.title,
          type: "boxPlot",
          data: chart.data.map((d, i) => ({ x: chart.labels[i], y: d })),
        }],
        // Upper and lower halves of the distribution, not decoration.
        plotOptions: { boxPlot: { colors: { upper: RAMP[4], lower: RAMP[1] } } },
        stroke: { width: 1.5, colors: [LIT2] },
        xaxis: { labels: rotated(chart.labels), ...axisTitle(chart.xAxisTitle) },
        yaxis: {
          min: chart.yMin || undefined,
          labels: { ...axisStyle, formatter: (v) => fmt(v) },
          ...axisTitle(chart.yAxisTitle),
        },
        legend: legend(false),
        tooltip: {
          ...base().tooltip,
          y: {
            formatter: (v) =>
              Array.isArray(v)
                ? `low ${fmt(v[0])}${unit} · 25th ${fmt(v[1])}${unit} · median ${fmt(v[2])}${unit} · 75th ${fmt(v[3])}${unit} · high ${fmt(v[4])}${unit}`
                : fmt(v) + unit,
          },
        },
      }).render();
      return;
    }

    const isPie = chart.type === "pie" || chart.type === "doughnut";
    if (isPie) {
      const denom = chart.total ?? sum(chart.data);
      new ApexCharts(plot, {
        ...base(undefined),
        chart: {
          ...base(undefined).chart,
          type: chart.type === "doughnut" ? "donut" : "pie",
          width: 330,
        },
        series: chart.data,
        labels: chart.labels,
        colors: colorsFor(chart, chart.labels, true),
        stroke: { width: 2, colors: [tok("--night")] },
        plotOptions: { pie: { donut: { size: "58%" }, expandOnClick: false } },
        legend: { ...legend(true), position: "bottom", horizontalAlign: "left", offsetX: 0 },
        tooltip: {
          ...base().tooltip,
          y: {
            formatter: (v) => `${v} of ${denom} (${denom ? ((v / denom) * 100).toFixed(0) : 0}%)`,
          },
        },
      }).render();
      return;
    }

    // Plain and metrics bars. Counts, not percentages — "23 answered Anxiety"
    // is what a reader wants, and the respondent count is already stated.
    const data = chart.data;
    const top = Math.max(...data, 0);
    const tall = chart.labels.some((l) => String(l).length > 18);
    const h = tall ? 370 : 300;
    new ApexCharts(plot, {
      ...base(h),
      chart: { ...base(h).chart, type: "bar" },
      series: [{ name: "People", data }],
      colors: colorsFor(chart, chart.labels, false),
      xaxis: { categories: chart.labels, labels: rotated(chart.labels), ...axisTitle(chart.xAxisTitle) },
      yaxis: {
        min: 0,
        max: chart.max || (top > 10 ? niceMax(data) : undefined),
        labels: axisStyle,
        ...axisTitle(chart.yAxisTitle || "People"),
      },
      legend: legend(false),
      plotOptions: {
        bar: {
          columnWidth: data.length <= 3 ? "32%" : data.length <= 5 ? "48%" : "66%",
          distributed: true,
        },
      },
      tooltip: {
        ...base().tooltip,
        y: { formatter: (v, { dataPointIndex }) => `${v} of ${respondents(chart) || "?"}` },
        x: { formatter: (_, o) => chart.labels[o?.dataPointIndex] ?? "" },
      },
    }).render();
  };

  /* ------------------------------------------------------------- page build */

  const res = await fetch("data/class-profile.json");
  const config = JSON.parse(await res.text());

  const navList = document.getElementById("nav-links");
  const host = document.getElementById("sections");

  for (const section of config.sections) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `#${section.id}`;
    a.textContent = section.title;
    li.appendChild(a);
    navList.appendChild(li);

    // The words band: paper.
    const sec = document.createElement("section");
    sec.className = "sec";
    sec.id = section.id;

    const wrap = document.createElement("div");
    wrap.className = "wrap";
    sec.appendChild(wrap);

    const h2 = document.createElement("h2");
    h2.className = "sec-title";
    h2.textContent = section.title;
    wrap.appendChild(h2);

    if (section.description) {
      const d = document.createElement("p");
      d.className = "sec-desc";
      d.textContent = section.description;
      wrap.appendChild(d);
    }

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

    // The numbers band: night. Skipped when a section has nothing to plot.
    const charts = section.charts || [];
    const images = section.images || [];
    if (!charts.length && !images.length) continue;

    const data = document.createElement("div");
    data.className = "sec-data";
    const dataWrap = document.createElement("div");
    dataWrap.className = "wrap";
    const grid = document.createElement("div");
    grid.className = "grid";
    dataWrap.appendChild(grid);
    data.appendChild(dataWrap);
    host.appendChild(data);

    grid.dataset.charts = JSON.stringify(charts);
    grid.dataset.images = JSON.stringify(images);
  }

  /* ----------------------------------------- draw only what is nearly in view */

  const drawGrid = (grid) => {
    const charts = JSON.parse(grid.dataset.charts || "[]");
    const images = JSON.parse(grid.dataset.images || "[]");

    let i = 0;
    const next = () => {
      if (i >= charts.length) return;
      const chart = charts[i++];
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
          f.src = `https://www.youtube.com/embed/${yt}`;
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
        drawGrid(e.target);
        drawer.unobserve(e.target);
      }
    },
    { rootMargin: "300px 0px" }
  );
  document.querySelectorAll(".grid").forEach((g) => drawer.observe(g));

  /* ------------------------------------------------- nav follows the reader */

  const links = new Map(
    [...navList.querySelectorAll("a")].map((a) => [a.getAttribute("href").slice(1), a])
  );
  const marker = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        links.forEach((a) => a.removeAttribute("aria-current"));
        links.get(e.target.id)?.setAttribute("aria-current", "true");
      }
    },
    { rootMargin: "-20% 0px -70% 0px" }
  );
  document.querySelectorAll(".sec").forEach((s) => marker.observe(s));

  /* ------------------------------------ the class photo, once it arrives */

  const pic = document.getElementById("classpic");
  if (pic) {
    const img = pic.querySelector("img");
    const empty = () => pic.classList.add("is-empty");
    if (img.complete && !img.naturalWidth) empty();
    img.addEventListener("error", empty);
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
    // The panel only exists below 76rem; do not leave it stuck open on resize.
    matchMedia("(min-width: 76rem)").addEventListener("change", (e) => {
      if (e.matches) setMenu(false);
    });
  }

  /* --------------------------------- stepping through questions by thumb */

  // Anything worth landing on: a section's name, or a single question.
  const stops = () => [
    ...document.querySelectorAll(".sec-title, .fig-title"),
  ].map((el) => ({
    el,
    top: Math.round(el.getBoundingClientRect().top + window.scrollY),
  }));

  const HEAD = 64; // clear the sticky bar
  const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;

  const step = (dir) => {
    // The reading line is wherever the sticky bar stops covering things.
    const line = window.scrollY + HEAD;
    const list = stops().sort((a, b) => a.top - b.top);
    const next =
      dir > 0
        ? list.find((s) => s.top > line + 4)
        : [...list].reverse().find((s) => s.top < line - 4);
    if (!next) return;
    window.scrollTo({
      top: Math.max(0, next.top - HEAD),
      behavior: smooth ? "smooth" : "auto",
    });
  };

  for (const btn of document.querySelectorAll(".jump-btn")) {
    btn.addEventListener("click", () => step(Number(btn.dataset.dir)));
  }

  // Grey out the arrow that has nowhere left to go.
  const jumpBtns = [...document.querySelectorAll(".jump-btn")];
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
