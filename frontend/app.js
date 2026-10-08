fetch("/api/health")
  .then((r) => r.json())
  .then((data) => {
    document.getElementById("status").textContent = data.status;
  })
  .catch(() => {
    document.getElementById("status").textContent = "unreachable";
  });
