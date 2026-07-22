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

          const canvas = document.createElement("canvas");
          chartWrap.appendChild(canvas);
          sectionEl.appendChild(chartWrap);

          new Chart(canvas.getContext("2d"), {
            type: chart.type,
            data: {
              labels: chart.labels,
              datasets: [
                {
                  label: chart.title,
                  data: chart.data,
                  backgroundColor: chart.colors,
                },
              ],
            },
            options: {
              responsive: true,
              plugins: { legend: { display: chart.type === "pie" || chart.type === "doughnut" } },
              scales: { y: { beginAtZero: true } },
            },
          });
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
