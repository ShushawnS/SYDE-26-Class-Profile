document.addEventListener("DOMContentLoaded", async () => {
  const res = await fetch("yaml/main.yml");
  const text = await res.text();
  const config = jsyaml.load(text);

  const navLinks = document.getElementById("nav-links");
  const sectionsContainer = document.getElementById("sections");

  for (const section of config.sections) {
    const li = document.createElement("li");
    li.innerHTML = `<a href="#${section.id}">${section.title}</a>`;
    navLinks.appendChild(li);

    const sectionEl = document.createElement("section");
    sectionEl.id = section.id;
    sectionEl.innerHTML = `
      <h2>${section.title}</h2>
      <p>${section.description}</p>
    `;
    sectionsContainer.appendChild(sectionEl);

    try {
      const yamlRes = await fetch(`yaml/${section.file}`);
      const yamlText = await yamlRes.text();
      const yamlData = jsyaml.load(yamlText);

      if (yamlData.charts) {
        for (const chart of yamlData.charts) {
          try {
            const chartWrap = document.createElement("div");
            chartWrap.style.maxWidth = "600px";
            chartWrap.style.margin = "2rem auto";

            const title = document.createElement("h3");
            title.textContent = chart.title;
            chartWrap.appendChild(title);

            if (chart.description) {
              const desc = document.createElement("p");
              desc.textContent = chart.description;
              chartWrap.appendChild(desc);
            }

            if (chart.type === "wordcloud") {
              const canvas = document.createElement("canvas");
              canvas.width = 600;
              canvas.height = 350;
              chartWrap.appendChild(canvas);
              sectionEl.appendChild(chartWrap);

              const maxWeight = Math.max(...chart.words.map((w) => w.weight));
              const wordList = chart.words.map((w) => [w.text, w.weight]);
              const wcColors = ["#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4"];

              WordCloud(canvas, {
                list: wordList,
                gridSize: 8,
                weightFactor: function (size) {
                  return (size / maxWeight) * 50 + 10;
                },
                fontFamily: "Inter, sans-serif",
                color: function () {
                  return wcColors[Math.floor(Math.random() * wcColors.length)];
                },
                rotateRatio: 0.3,
                backgroundColor: "transparent",
                shuffle: true,
              });
              continue;
            }

            const chartDiv = document.createElement("div");
            chartWrap.appendChild(chartDiv);
            sectionEl.appendChild(chartWrap);

            if (chart.type === "line") {
              const series = chart.datasets.map((ds) => ({
                name: ds.label,
                data: ds.data,
              }));

              new ApexCharts(chartDiv, {
                chart: { type: "line", height: 350 },
                series: series,
                xaxis: { categories: chart.xLabels },
                colors: chart.datasets.map((ds) => ds.color),
                stroke: { curve: "smooth", width: 2 },
                fill: chart.fill ? { type: "gradient", opacity: 0.3 } : { type: "solid", opacity: 1 },
                markers: { size: 4, hover: { size: 6 } },
                dataLabels: { enabled: false },
                legend: { show: series.length > 1, position: "top" },
                yaxis: { show: chart.beginAtZero === false ? true : { min: 0 } },
                tooltip: { shared: true, intersect: false },
              }).render();
            continue;
          }

          if (chart.type === "stacked-bar") {
            const series = chart.datasets.map((ds) => ({
              name: ds.label,
              data: ds.data,
            }));

            new ApexCharts(chartDiv, {
              chart: { type: "bar", height: 350, stacked: true },
              series: series,
              xaxis: { categories: chart.xLabels },
              colors: chart.datasets.map((ds) => ds.color),
              dataLabels: { enabled: false },
              legend: { show: true, position: "top" },
              yaxis: {
                min: 0,
                max: 100,
                labels: { formatter: (v) => v + "%" },
              },
              tooltip: {
                shared: true,
                intersect: false,
                y: { formatter: (val) => val + "%" },
              },
              plotOptions: {
                bar: { columnWidth: "60%" },
              },
            }).render();
            continue;
          }

          if (chart.type === "grouped-bar") {
            const series = chart.datasets.map((ds) => ({
              name: ds.label,
              data: ds.data,
            }));

            new ApexCharts(chartDiv, {
              chart: { type: "bar", height: 350 },
              series: series,
              xaxis: { categories: chart.xLabels },
              colors: chart.datasets.map((ds) => ds.color),
              dataLabels: { enabled: false },
              legend: { show: true, position: "top" },
              yaxis: {
                min: 0,
                max: chart.max || undefined,
                labels: {
                  formatter: (v) =>
                    chart.unit ? v + chart.unit : v,
                },
              },
              tooltip: {
                shared: true,
                intersect: false,
                y: {
                  formatter: (val) =>
                    chart.unit ? val + chart.unit : val,
                },
              },
              plotOptions: {
                bar: { columnWidth: "60%" },
              },
            }).render();
            continue;
          }

          if (chart.type === "boxplot") {
            const series = [{
              name: chart.title,
              type: "boxPlot",
              data: chart.data.map((d, i) => ({
                x: chart.labels[i],
                y: d,
              })),
            }];

            new ApexCharts(chartDiv, {
              chart: { type: "boxPlot", height: 350 },
              series: series,
              colors: chart.colors?.fill || ["#2563eb"],
              stroke: { colors: chart.colors?.stroke || ["#1e40af"] },
              dataLabels: { enabled: false },
              legend: { show: false },
              yaxis: {
                labels: { formatter: (v) => "$" + v + "/hr" },
              },
              tooltip: {
                y: {
                  formatter: (val) => {
                    if (Array.isArray(val)) {
                      return `Min: $${val[0]}/hr | Q1: $${val[1]}/hr | Median: $${val[2]}/hr | Q3: $${val[3]}/hr | Max: $${val[4]}/hr`;
                    }
                    return val;
                  },
                },
              },
              title: {
                text: chart.title,
                align: "center",
                style: { fontSize: "14px" },
              },
            }).render();
            continue;
          }

          const isPie = chart.type === "pie" || chart.type === "doughnut";
          const apexType = chart.type === "doughnut" ? "donut" : chart.type;

          if (isPie) {
            new ApexCharts(chartDiv, {
              chart: { type: apexType, height: 350 },
                series: chart.data,
                labels: chart.labels,
                colors: chart.colors,
                dataLabels: {
                  enabled: true,
                  formatter: (val) => val.toFixed(1) + "%",
                  style: { fontWeight: "bold", fontSize: "14px" },
                  dropShadow: { enabled: false },
                },
                legend: { position: "right" },
                tooltip: {
                  y: {
                    formatter: (val, { seriesIndex }) =>
                      `${chart.labels[seriesIndex]}: ${val.toFixed(1)}% (${chart.data[seriesIndex]})`,
                  },
                },
                title: {
                  text: `${chart.title} (n=${chart.total || chart.data.reduce((a, b) => a + b, 0)})`,
                  align: "center",
                  style: { fontSize: "14px" },
                },
              }).render();
              continue;
            }

            const total = chart.data.reduce((a, b) => a + b, 0);
            const percentages = chart.data.map((v) => +((v / total) * 100).toFixed(1));

            new ApexCharts(chartDiv, {
              chart: { type: "bar", height: 350 },
              series: [{ name: chart.title, data: percentages }],
              xaxis: { categories: chart.labels },
              colors: chart.colors,
              dataLabels: {
                enabled: true,
                formatter: (val) => val + "%",
                style: { fontWeight: "bold", fontSize: "12px" },
                offsetY: -5,
              },
              legend: { show: false },
              yaxis: {
                min: 0,
                labels: { formatter: (v) => v + "%" },
              },
              tooltip: {
                y: {
                  formatter: (val, { dataPointIndex }) =>
                    `${chart.labels[dataPointIndex]}: ${val}% (${chart.data[dataPointIndex]})`,
                },
              },
              title: {
                text: `${chart.title} (n=${chart.total || total})`,
                align: "center",
                style: { fontSize: "14px" },
              },
              plotOptions: {
                bar: {
                  columnWidth: "60%",
                  dataLabels: { position: "top" },
                },
              },
            }).render();
          } catch (e) {
            console.warn(`Could not render chart "${chart.title}"`, e);
          }
        }
      }

      if (yamlData.images) {
        const galleryGrid = document.createElement("div");
        galleryGrid.className = "gallery-grid";
        for (const img of yamlData.images) {
          const imgEl = document.createElement("img");
          imgEl.src = img.src;
          imgEl.alt = img.alt;
          galleryGrid.appendChild(imgEl);
        }
        sectionEl.appendChild(galleryGrid);
      }
    } catch (e) {
      console.warn(`Could not load yaml/${section.file}`, e);
    }
  }
});
