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
              markers: { size: 4, hover: { size: 6 } },
              dataLabels: { enabled: false },
              legend: { show: series.length > 1, position: "top" },
              yaxis: { show: chart.beginAtZero === false ? true : { min: 0 } },
              tooltip: { shared: true, intersect: false },
            }).render();
            continue;
          }

          const isPie = chart.type === "pie" || chart.type === "doughnut";

          if (isPie) {
            new ApexCharts(chartDiv, {
              chart: { type: chart.type, height: 350 },
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
