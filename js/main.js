document.addEventListener("DOMContentLoaded", async () => {
  const res = await fetch("data.yml");
  const text = await res.text();
  const data = jsyaml.load(text);

  document.querySelector(".hero h1").textContent = data.title;
  document.querySelector(".hero p").textContent = data.subtitle;

  const ctx = document.getElementById("barChart").getContext("2d");

  new Chart(ctx, {
    type: "bar",
    data: {
      labels: data.stats.map((s) => s.label),
      datasets: [
        {
          label: "SYDE 26",
          data: data.stats.map((s) => s.value),
          backgroundColor: ["#2563eb", "#10b981", "#f59e0b"],
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } },
    },
  });
});
