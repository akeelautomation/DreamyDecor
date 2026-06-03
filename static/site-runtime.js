(() => {
  const slots = Array.from(document.querySelectorAll("[data-site-sponsor-slot]"));
  if (!slots.length) return;

  const setState = (state) => {
    for (const slot of slots) {
      slot.dataset.sponsorState = state;
    }
  };

  const loadScript = (src) =>
    new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.async = true;
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });

  fetch("/api/site-options", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  })
    .then((response) => (response.ok ? response.json() : null))
    .then((config) => {
      if (!config?.sponsor?.enabled || !config.sponsor.scriptSrc) {
        setState("disabled");
        return;
      }

      for (const slot of slots) {
        if (config.sponsor.zoneId) slot.dataset.zoneId = config.sponsor.zoneId;
      }

      setState("ready");
      return loadScript(config.sponsor.scriptSrc);
    })
    .catch(() => {
      setState("disabled");
    });
})();
