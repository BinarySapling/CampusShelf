function readCookie(name) {
  const row = document.cookie.split(";").find((part) => part.trim().startsWith(`${name}=`));
  return row ? decodeURIComponent(row.trim().slice(name.length + 1)) : "";
}

function firstErrorMessage(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(firstErrorMessage).find(Boolean) || "";
  if (value && typeof value === "object") {
    const preferred = [value.detail, value.message, value.error, value.non_field_errors, value.errors];
    for (const candidate of preferred) {
      const message = firstErrorMessage(candidate);
      if (message) return message;
    }
    for (const [key, candidate] of Object.entries(value)) {
      if (["code", "status", "status_code"].includes(key.toLowerCase())) continue;
      const message = firstErrorMessage(candidate);
      if (message) return message;
    }
  }
  return "";
}

function httpErrorMessage(data, status) {
  const message = firstErrorMessage(data);
  if (message) return message;
  if (status === 401) return "Your session has expired. Sign in again and retry.";
  if (status === 403) return "This action is not allowed. Refresh the page and try again.";
  if (status === 404) return "This item could not be found. Refresh and try again.";
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  if (status >= 500) return "The library service is temporarily unavailable. Try again shortly.";
  return `The request could not be completed (HTTP ${status}).`;
}

export async function api(path, options = {}) {
  const method = options.method || "GET";
  const headers = { ...(options.headers || {}) };
  if (method !== "GET") {
    headers["X-CSRFToken"] = readCookie("csrftoken");
  }
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  let response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      method,
      headers,
      credentials: "same-origin",
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Error("Unable to reach the library service. Check your connection and try again.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(httpErrorMessage(data, response.status));
  }
  if (data === null) throw new Error("The library returned an unreadable response. Refresh and try again.");
  return data;
}

export function formBody(values) {
  return new URLSearchParams(values);
}
