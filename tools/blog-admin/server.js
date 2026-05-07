const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { execFile } = require("node:child_process");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const PUBLIC_DIR = path.join(__dirname, "public");
const TMP_DIR = path.join(ROOT_DIR, ".blog-generator-tmp");
const GENERATOR_SCRIPT = path.join(ROOT_DIR, "tools", "generate-blog-from-image.js");
const PORT = Number(process.env.PORT || 3200);
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const GENERATOR_TIMEOUT_MS = 10 * 60 * 1000;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

fs.mkdirSync(TMP_DIR, { recursive: true });

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://localhost:${PORT}`);

    if (req.method === "GET" && (requestUrl.pathname === "/" || requestUrl.pathname === "/admin")) {
      sendFile(res, path.join(PUBLIC_DIR, "index.html"));
      return;
    }

    if (req.method === "GET" && requestUrl.pathname.startsWith("/admin/")) {
      const requestedPath = path.normalize(decodeURIComponent(requestUrl.pathname.replace(/^\/admin\//, "")));
      const filePath = path.join(PUBLIC_DIR, requestedPath);

      if (!filePath.startsWith(PUBLIC_DIR)) {
        sendJson(res, 403, { error: "Forbidden." });
        return;
      }

      sendFile(res, filePath);
      return;
    }

    if (req.method === "GET" && requestUrl.pathname.startsWith("/site")) {
      sendSiteFile(res, requestUrl.pathname);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/generate-blog") {
      const upload = await readMultipartImage(req);
      const tempPath = path.join(TMP_DIR, `${Date.now()}-${sanitizeFilename(upload.filename)}`);
      fs.writeFileSync(tempPath, upload.buffer);

      try {
        const result = await runGenerator(tempPath, res);
        sendJson(res, 200, result);
      } finally {
        fs.rmSync(tempPath, { force: true });
      }
      return;
    }

    sendJson(res, 404, { error: "Not found." });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Unexpected server error." });
  }
});

server.listen(PORT, () => {
  console.log(`Dreamy Decor blog maker running at http://localhost:${PORT}/admin`);
});

function sendFile(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendJson(res, 404, { error: "File not found." });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  fs.createReadStream(filePath).pipe(res);
}

function sendSiteFile(res, pathname) {
  const relativePath = decodeURIComponent(pathname.replace(/^\/site\/?/, "")) || "index.html";
  const normalizedPath = path.normalize(relativePath);
  const filePath = path.join(ROOT_DIR, normalizedPath);

  if (!filePath.startsWith(ROOT_DIR)) {
    sendJson(res, 403, { error: "Forbidden." });
    return;
  }

  sendFile(res, filePath);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) {
        reject(new Error("Image is too large. Use a file under 12 MB."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readMultipartImage(req) {
  const contentType = req.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);

  if (!boundaryMatch) {
    throw new Error("Expected multipart form upload.");
  }

  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const body = await readRequestBody(req);
  const parts = splitMultipart(body, boundary);

  for (const part of parts) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;

    const rawHeaders = part.slice(0, headerEnd).toString("utf8");
    const content = trimMultipartContent(part.slice(headerEnd + 4));
    const disposition = rawHeaders.match(/content-disposition:[^\r\n]+/i)?.[0] || "";
    const name = disposition.match(/name="([^"]+)"/i)?.[1];
    const filename = disposition.match(/filename="([^"]*)"/i)?.[1];
    const partContentType = rawHeaders.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || "";

    if (name === "image" && filename) {
      if (!partContentType.startsWith("image/")) {
        throw new Error("Please upload an image file.");
      }

      return {
        filename,
        contentType: partContentType,
        buffer: content,
      };
    }
  }

  throw new Error("No image field found in upload.");
}

function splitMultipart(body, boundary) {
  const parts = [];
  let cursor = body.indexOf(boundary);

  while (cursor !== -1) {
    const partStart = cursor + boundary.length;
    const next = body.indexOf(boundary, partStart);
    if (next === -1) break;

    const part = body.slice(partStart, next);
    if (!part.includes(Buffer.from("Content-Disposition"))) {
      cursor = next;
      continue;
    }

    parts.push(trimMultipartContent(part));
    cursor = next;
  }

  return parts;
}

function trimMultipartContent(buffer) {
  let start = 0;
  let end = buffer.length;

  if (buffer.slice(0, 2).toString() === "\r\n") start = 2;
  if (buffer.slice(end - 2).toString() === "\r\n") end -= 2;
  if (buffer.slice(end - 2).toString() === "--") end -= 2;

  return buffer.slice(start, end);
}

function runGenerator(imagePath, res) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = execFile(
      process.execPath,
      [GENERATOR_SCRIPT, imagePath],
      {
        cwd: ROOT_DIR,
        timeout: GENERATOR_TIMEOUT_MS,
        maxBuffer: 1024 * 1024 * 4,
      },
      (error, stdout, stderr) => {
        settled = true;
        const combinedOutput = `${stdout || ""}${stderr ? `\n${stderr}` : ""}`.trim();

        if (error) {
          reject(new Error(combinedOutput || error.message));
          return;
        }

        const pageMatch = combinedOutput.match(/Done:\s+(blog-[^\s]+\.html)/);
        const uploadMatch = combinedOutput.match(/Uploaded image:\s+(https?:\/\/[^\s]+)/);
        const blogMatch = combinedOutput.match(/Generated blog:\s+(.+?)\s+\(([^)]+)\)\s+-\s+(\d+)\s+words/);

        resolve({
          ok: true,
          title: blogMatch?.[1] || "",
          slug: blogMatch?.[2] || "",
          wordCount: blogMatch?.[3] ? Number(blogMatch[3]) : null,
          pagePath: pageMatch?.[1] || "",
          pageUrl: pageMatch ? `/${pageMatch[1].replace(/\\/g, "/")}` : "",
          uploadedImageUrl: uploadMatch?.[1] || "",
          output: combinedOutput,
        });
      }
    );

    res.on("close", () => {
      if (!settled) {
        child.kill();
        reject(new Error("Generation stopped by user."));
      }
    });
  });
}

function sanitizeFilename(value) {
  const parsed = path.parse(value);
  const name = parsed.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const ext = parsed.ext.toLowerCase() || ".jpg";
  return `${name || "decor-blog-image"}${ext}`;
}
