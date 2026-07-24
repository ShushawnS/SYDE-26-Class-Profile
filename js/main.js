document.addEventListener("DOMContentLoaded", async () => {
  Chart.register(ChartDataLabels);

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

          const canvas = document.createElement("canvas");
          chartWrap.appendChild(canvas);
          sectionEl.appendChild(chartWrap);

          if (chart.type === "line") {
            const datasets = chart.datasets.map((ds) => ({
              label: ds.label,
              data: ds.data,
              borderColor: ds.color,
              backgroundColor: ds.color + "1A",
              tension: 0.3,
              fill: false,
              pointRadius: 4,
              pointHoverRadius: 6,
            }));

            new Chart(canvas.getContext("2d"), {
              type: "line",
              data: { labels: chart.xLabels, datasets },
              plugins: [ChartDataLabels],
              options: {
                responsive: true,
                plugins: {
                  legend: { display: datasets.length > 1 },
                  datalabels: { display: false },
                },
                scales: {
                  y: { beginAtZero: chart.beginAtZero !== false },
                },
              },
            });
            continue;
          }

          const total = chart.data.reduce((a, b) => a + b, 0);
          const percentages = chart.data.map((v) => +((v / total) * 100).toFixed(1));

          title.textContent = `${chart.title} (n=${chart.total || total})`;

          const isPie = chart.type === "pie" || chart.type === "doughnut";

          const chartConfig = {
            type: chart.type,
            data: {
              labels: chart.labels,
              datasets: [
                {
                  label: chart.title,
                  data: percentages,
                  backgroundColor: chart.colors,
                },
              ],
            },
            plugins: [ChartDataLabels],
            options: {
              responsive: true,
              plugins: {
                legend: { display: isPie },
                datalabels: {
                  color: isPie ? "#fff" : "#000",
                  formatter: (v) => v + "%",
                  font: { weight: "bold", size: isPie ? 14 : 12 },
                  display: (ctx) => ctx.dataset.data[ctx.dataIndex] > 5,
                },
                tooltip: {
                  callbacks: {
                    label: (ctx) => {
                      const idx = ctx.dataIndex;
                      return `${ctx.label}: ${percentages[idx]}% (${chart.data[idx]})`;
                    },
                  },
                },
              },
              scales: isPie ? {} : { y: { beginAtZero: true, ticks: { callback: (v) => v + "%" } } },
            },
          };

          new Chart(canvas.getContext("2d"), chartConfig);
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
