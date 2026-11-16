function readCookie(name) {
  const row = document.cookie.split(";").find((part) => part.trim().startsWith(`${name}=`));
  return row ? decodeURIComponent(row.trim().slice(name.length + 1)) : "";
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

  const response = await fetch(`/api${path}`, {
    ...options,
    method,
    headers,
    credentials: "same-origin",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const firstError = data.errors && Object.values(data.errors)[0]?.[0];
    throw new Error(firstError || data.error || "The request could not be completed.");
  }
  return data;
}

export function formBody(values) {
  return new URLSearchParams(values);
}
