const els = {
  form: document.querySelector("#productForm"),
  sectionId: document.querySelector("#sectionId"),
  publishBtn: document.querySelector("#publishBtn"),
  status: document.querySelector("#status"),
  emptyState: document.querySelector("#emptyState"),
  preview: document.querySelector("#preview"),
  previewImage: document.querySelector("#previewImage"),
  previewTitle: document.querySelector("#previewTitle"),
  previewSection: document.querySelector("#previewSection"),
  previewAsin: document.querySelector("#previewAsin"),
  previewPrice: document.querySelector("#previewPrice"),
  previewFile: document.querySelector("#previewFile"),
  previewUrl: document.querySelector("#previewUrl"),
  previewImageCount: document.querySelector("#previewImageCount"),
  previewMetaDescription: document.querySelector("#previewMetaDescription"),
  previewOgTitle: document.querySelector("#previewOgTitle"),
  previewReview: document.querySelector("#previewReview"),
};

let lastAnalysis = null;

const REVIEW_FIELDS = [
  { key: "whoItsBestFor", label: "Who It's Best For", type: "text" },
  { key: "whoShouldSkipIt", label: "Who Should Skip It", type: "text" },
  { key: "whereItWorksBest", label: "Where It Works Best", type: "text" },
  { key: "pros", label: "Pros", type: "list" },
  { key: "cons", label: "Cons", type: "list" },
];

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }

  return payload;
}

function formPayload() {
  const data = new FormData(els.form);
  const imageUrls = String(data.get("imageUrls") || "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    affiliateUrl: data.get("affiliateUrl")?.trim(),
    imageUrl: imageUrls[0] || "",
    imageUrls,
    sectionId: data.get("sectionId")?.trim(),
    shortTitle: data.get("shortTitle")?.trim(),
    cardCopy: data.get("cardCopy")?.trim(),
    pageSummary: data.get("pageSummary")?.trim(),
    altText: data.get("altText")?.trim(),
  };
}

function setStatus(message, tone = "") {
  els.status.textContent = message;
  els.status.className = `status ${tone}`.trim();
}

function renderReviewCards(review) {
  return REVIEW_FIELDS.map((field) => {
    const card = document.createElement("article");
    card.className = "sectionCard";

    const title = document.createElement("h3");
    title.className = "sectionCard__title";
    title.textContent = field.label;
    card.append(title);

    if (field.type === "list") {
      const list = document.createElement("ul");
      list.className = "sectionCard__list";
      for (const itemText of review[field.key] || []) {
        const item = document.createElement("li");
        item.textContent = itemText;
        list.append(item);
      }
      card.append(list);
      return card;
    }

    const copy = document.createElement("p");
    copy.className = "sectionCard__copy";
    copy.textContent = review[field.key] || "";
    card.append(copy);
    return card;
  });
}

function renderAnalysis(analysis) {
  lastAnalysis = analysis;
  els.emptyState.hidden = true;
  els.preview.hidden = false;

  els.previewImage.src = analysis.imageUrl;
  els.previewImage.alt = analysis.altText;
  els.previewTitle.textContent = analysis.shortTitle;
  els.previewSection.textContent = `Section: ${analysis.sectionLabel}`;
  els.previewAsin.textContent = `ASIN: ${analysis.asin}`;
  els.previewPrice.textContent = analysis.price
    ? `Price found: $${analysis.price}`
    : "Price not found. Pinterest product metadata needs a static price, and publish will be blocked until one is extracted.";
  els.previewFile.textContent = analysis.pageFile;
  els.previewUrl.textContent = analysis.productUrl;
  els.previewImageCount.textContent = `${analysis.imageUrls.length} image${analysis.imageUrls.length === 1 ? "" : "s"}`;
  els.previewMetaDescription.textContent = analysis.metaDescription;
  els.previewOgTitle.textContent = analysis.ogTitle;
  els.previewReview.replaceChildren(...renderReviewCards(analysis.review));
}

async function loadSections() {
  const { sections } = await requestJson("/api/sections", { method: "GET", headers: {} });
  els.sectionId.replaceChildren(
    (() => {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Auto-detect from product";
      return option;
    })(),
    ...sections.map((section) => {
      const option = document.createElement("option");
      option.value = section.id;
      option.textContent = section.label;
      return option;
    }),
  );
}

async function analyze() {
  setStatus("Analyzing Amazon product and generating AI notes...");
  const { analysis } = await requestJson("/api/analyze", {
    method: "POST",
    body: JSON.stringify(formPayload()),
  });
  renderAnalysis(analysis);
  setStatus("Preview ready.", "status--ok");
}

async function publish() {
  setStatus("Writing the AI-based product page and updating the matching picks page...");
  const { analysis, pagePath, sectionPagePath } = await requestJson("/api/publish", {
    method: "POST",
    body: JSON.stringify({
      ...formPayload(),
      analysis: lastAnalysis,
    }),
  });
  renderAnalysis(analysis);
  setStatus(`Published ${analysis.pageFile}. Updated ${sectionPagePath} and ${pagePath}.`, "status--ok");
}

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await analyze();
  } catch (error) {
    setStatus(error.message, "status--error");
  }
});

els.publishBtn.addEventListener("click", async () => {
  try {
    await publish();
  } catch (error) {
    setStatus(error.message, "status--error");
  }
});

loadSections().catch((error) => {
  setStatus(error.message, "status--error");
});
