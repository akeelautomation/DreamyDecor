const form = document.querySelector("#uploadForm");
const imageInput = document.querySelector("#imageInput");
const keywordInput = document.querySelector("#keywordInput");
const dropzone = document.querySelector(".dropzone");
const previewWrap = document.querySelector("#previewWrap");
const statusEl = document.querySelector("#status");
const submitButton = document.querySelector("#submitButton");
const stopButton = document.querySelector("#stopButton");
const clearButton = document.querySelector("#clearButton");
const summary = document.querySelector("#summary");
const queueList = document.querySelector("#queueList");

const BATCH_CONCURRENCY = 3;
const FAILED_ITEM_RETRY_DELAY_MS = 5000;
const MAX_ITEM_ATTEMPTS = 3;

let queuedFiles = [];
let previewUrls = [];
let isProcessing = false;
let stopRequested = false;
let activeControllers = new Set();
let completed = 0;
let failed = 0;
let started = 0;

imageInput.addEventListener("change", () => {
  setQueuedFiles(Array.from(imageInput.files || []));
});

dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("dragging");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("dragging");
});

dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("dragging");

  const files = Array.from(event.dataTransfer?.files || []).filter((file) => file.type.startsWith("image/"));
  setQueuedFiles(files);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!queuedFiles.length) {
    setStatus("Choose one or more images first.", "error");
    return;
  }

  isProcessing = true;
  stopRequested = false;
  completed = 0;
  failed = 0;
  started = 0;
  const keywordGuidance = getKeywordGuidance();
  const total = queuedFiles.length;
  const workerCount = Math.min(BATCH_CONCURRENCY, total);
  setLoading(true);
  updateBatchSummary(total, workerCount);
  summary.classList.remove("empty");

  let nextIndex = 0;
  const claimNextIndex = () => {
    if (stopRequested || nextIndex >= total) {
      return -1;
    }
    const index = nextIndex;
    nextIndex += 1;
    started += 1;
    updateBatchSummary(total, workerCount);
    return index;
  };

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (!stopRequested) {
        const index = claimNextIndex();
        if (index === -1) {
          return;
        }
        await processQueueItem(index, total, workerCount, keywordGuidance);
      }
    })
  );

  isProcessing = false;
  activeControllers.clear();
  setLoading(false);
  setStatus(
    stopRequested ? `Batch stopped. ${completed} done, ${failed} failed.` : `Batch finished. ${completed} done, ${failed} failed.`,
    failed || stopRequested ? "error" : "success"
  );
});

stopButton.addEventListener("click", () => {
  if (!isProcessing) {
    return;
  }

  stopRequested = true;
  stopButton.disabled = true;
  setStatus("Stopping active requests.", "error");

  activeControllers.forEach((controller) => controller.abort());
});

clearButton.addEventListener("click", () => {
  if (isProcessing) {
    setStatus("Batch is running. Wait for it to finish before clearing.", "error");
    return;
  }

  imageInput.value = "";
  queuedFiles = [];
  renderQueue();
  summary.textContent = "Generated blog pages, word counts, R2 image URLs, and run logs will appear here.";
  summary.classList.add("empty");
  setStatus("", "");
});

async function processQueueItem(index, total, workerCount, keywordGuidance) {
  const file = queuedFiles[index];
  const row = queueList.querySelector(`[data-index="${index}"]`);

  updateQueueRow(row, {
    state: "loading",
    status: `Processing ${index + 1} of ${total}...`,
  });
  setStatus(`Running ${activeControllers.size + 1}/${workerCount}: ${file.name}`, "loading");

  try {
    const result = await generateBlogWithRetry(file, row, index, total, keywordGuidance);
    if (stopRequested) {
      updateQueueRow(row, {
        state: "error",
        status: "Stopped",
        error: "Stopped by user.",
      });
      return;
    }

    completed += 1;
    updateQueueRow(row, {
      state: "success",
      status: `${result.wordCount || "1100-1200"} words`,
      result,
    });
  } catch (error) {
    if (isAbortError(error)) {
      updateQueueRow(row, {
        state: "error",
        status: "Stopped",
        error: "Stopped by user.",
      });
      stopRequested = true;
      return;
    }

    failed += 1;
    updateQueueRow(row, {
      state: "error",
      status: "Failed",
      error: error.message || "Blog generation failed.",
    });
  } finally {
    updateBatchSummary(total, workerCount);
  }
}

function updateBatchSummary(total, workerCount) {
  const running = activeControllers.size;
  const remaining = Math.max(0, total - completed - failed - running);
  summary.textContent = `Started ${started} of ${total}. Running ${running}/${workerCount}. Completed ${completed}. Failed ${failed}. Remaining ${remaining}.`;
}

function renderQueue() {
  revokePreviewUrls();
  queueList.textContent = "";

  if (!queuedFiles.length) {
    previewWrap.hidden = true;
    queueList.hidden = true;
    return;
  }

  previewWrap.hidden = false;
  queueList.hidden = false;

  queuedFiles.forEach((file, index) => {
    const previewUrl = URL.createObjectURL(file);
    previewUrls.push(previewUrl);

    const preview = document.createElement("div");
    const previewImage = document.createElement("img");
    const previewName = document.createElement("span");
    previewImage.src = previewUrl;
    previewImage.alt = file.name;
    previewName.textContent = file.name;
    preview.append(previewImage, previewName);
    previewWrap.appendChild(preview);

    queueList.appendChild(createQueueRow({ file, index, previewUrl }));
  });

  summary.textContent = `${queuedFiles.length} image${queuedFiles.length === 1 ? "" : "s"} queued.`;
  summary.classList.remove("empty");
}

function setQueuedFiles(files) {
  if (isProcessing) {
    setStatus("Batch is running. Wait for it to finish before changing the queue.", "error");
    return;
  }

  queuedFiles = files;
  renderQueue();
}

function createQueueRow({ file, index, previewUrl }) {
  const row = document.createElement("article");
  row.className = "queue-row";
  row.dataset.index = String(index);
  row.dataset.state = "queued";

  row.innerHTML = `
    <img class="queue-thumb" src="${previewUrl}" alt="">
    <div class="queue-main">
      <div class="queue-topline">
        <h3>${escapeHtml(file.name)}</h3>
        <span class="queue-state">Queued</span>
      </div>
      <p class="queue-meta">${formatBytes(file.size)}</p>
      <div class="queue-links" hidden></div>
      <pre class="queue-log" hidden></pre>
    </div>
  `;

  return row;
}

async function generateBlog(file, keywordGuidance = "") {
  const formData = new FormData();
  formData.append("image", file);
  formData.append("keywords", keywordGuidance);
  const controller = new AbortController();
  activeControllers.add(controller);

  try {
    const response = await fetch("/api/generate-blog", {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Blog generation failed.");
    }

    return data;
  } finally {
    activeControllers.delete(controller);
  }
}

async function generateBlogWithRetry(file, row, index, total, keywordGuidance = "") {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ITEM_ATTEMPTS; attempt += 1) {
    if (stopRequested) {
      throw new DOMException("Stopped by user.", "AbortError");
    }

    try {
      updateQueueRow(row, {
        state: "loading",
        status: `Processing ${index + 1} of ${total} - attempt ${attempt}/${MAX_ITEM_ATTEMPTS}`,
      });
      return await generateBlog(file, keywordGuidance);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      lastError = error;

      if (attempt < MAX_ITEM_ATTEMPTS) {
        updateQueueRow(row, {
          state: "loading",
          status: `Retrying in ${Math.round(FAILED_ITEM_RETRY_DELAY_MS / 1000)}s`,
        });
        await sleepWithStop(FAILED_ITEM_RETRY_DELAY_MS);
      }
    }
  }

  throw lastError;
}

function updateQueueRow(row, { state, status, result, error }) {
  if (!row) return;

  row.dataset.state = state;
  row.querySelector(".queue-state").textContent = status;

  const links = row.querySelector(".queue-links");
  const log = row.querySelector(".queue-log");

  if (result) {
    links.hidden = false;
    links.innerHTML = `
      <a href="${escapeHtml(toSitePreviewUrl(result.pageUrl) || "#")}" target="_blank" rel="noreferrer">${escapeHtml(
        result.title || result.pagePath || "Blog page"
      )}</a>
      <a href="/site/blog.html" target="_blank" rel="noreferrer">Blog Index</a>
      <a href="${escapeHtml(result.uploadedImageUrl || "#")}" target="_blank" rel="noreferrer">R2 image</a>
      <button class="copy copy-row-log" type="button">Copy Log</button>
    `;
    log.hidden = false;
    log.textContent = result.output || "";
    links.querySelector(".copy-row-log").addEventListener("click", async (event) => {
      await navigator.clipboard.writeText(log.textContent || "");
      event.currentTarget.textContent = "Copied";
      setTimeout(() => {
        event.currentTarget.textContent = "Copy Log";
      }, 900);
    });
  }

  if (error) {
    links.hidden = false;
    links.innerHTML = '<button class="copy retry-row" type="button">Retry</button>';
    links.querySelector(".retry-row").addEventListener("click", () => retryRow(row));
    log.hidden = false;
    log.textContent = error;
  }
}

async function retryRow(row) {
  if (isProcessing) {
    setStatus("Batch is running. Wait for it to finish before retrying a failed item.", "error");
    return;
  }

  const index = Number(row?.dataset.index);
  const file = queuedFiles[index];
  if (!file) {
    setStatus("Could not find the original file for this row.", "error");
    return;
  }

  isProcessing = true;
  stopRequested = false;
  setLoading(true);
  setStatus(`Retrying: ${file.name}`, "loading");

  try {
    const result = await generateBlogWithRetry(file, row, index, queuedFiles.length, getKeywordGuidance());
    updateQueueRow(row, {
      state: "success",
      status: `${result.wordCount || "1100-1200"} words`,
      result,
    });
    setStatus("Retry finished.", "success");
  } catch (error) {
    updateQueueRow(row, {
      state: "error",
      status: isAbortError(error) ? "Stopped" : "Failed",
      error: isAbortError(error) ? "Stopped by user." : error.message || "Blog generation failed.",
    });
    setStatus(isAbortError(error) ? "Retry stopped." : "Retry failed.", "error");
  } finally {
    isProcessing = false;
    activeControllers.clear();
    setLoading(false);
  }
}

function setStatus(message, state) {
  statusEl.textContent = message;
  statusEl.dataset.state = state;
}

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  clearButton.disabled = isLoading;
  keywordInput.disabled = isLoading;
  stopButton.disabled = !isLoading;
  submitButton.textContent = isLoading ? "Batch Running..." : "Start Batch";
}

function getKeywordGuidance() {
  return String(keywordInput.value || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, 2000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sleepWithStop(ms) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const tick = () => {
      if (stopRequested || Date.now() - startedAt >= ms) {
        resolve();
        return;
      }
      setTimeout(tick, 250);
    };
    tick();
  });
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

function toSitePreviewUrl(value) {
  if (!value) {
    return "";
  }

  return `/site/${String(value).replace(/^\/+/, "")}`;
}

function revokePreviewUrls() {
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls = [];
  previewWrap.textContent = "";
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
