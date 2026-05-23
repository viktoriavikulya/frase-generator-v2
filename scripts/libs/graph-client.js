require("dotenv").config();

const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || "v25.0";

function buildGraphUrl(path) {
  return `https://graph.facebook.com/${GRAPH_API_VERSION}/${path}`;
}

async function graphGet(path, query = {}) {
  const url = new URL(buildGraphUrl(path));

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  const res = await fetch(url.toString());
  const rawText = await res.text();

  let data;
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    data = null;
  }

  if (!res.ok || data?.error) {
    const err = data?.error;
    const msg = err
      ? `${err.message} (code=${err.code}, subcode=${err.error_subcode})`
      : `Graph API ${res.status}: ${rawText}`;
    throw new Error(msg);
  }

  return data;
}

async function graphPost(path, body) {
  const url = buildGraphUrl(path);

  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined && value !== null) {
      form.append(key, String(value));
    }
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString()
  });

  const rawText = await res.text();

  let data;
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    data = null;
  }

  if (!res.ok || data?.error) {
    const err = data?.error;
    const msg = err
      ? `${err.message} (code=${err.code}, subcode=${err.error_subcode})`
      : `Graph API ${res.status}: ${rawText}`;

    const error = new Error(msg);
    error.status = res.status;
    error.responseBody = rawText;
    error.graphError = err || null;
    throw error;
  }

  return data;
}

module.exports = { graphGet, graphPost, buildGraphUrl };