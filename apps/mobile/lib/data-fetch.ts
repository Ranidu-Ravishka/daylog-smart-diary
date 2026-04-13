type FetchJsonOptions = {
  init?: RequestInit;
  fetchImpl?: typeof fetch;
};

function readHeaderCaseInsensitive(
  headers: Headers,
  name: string,
): string | null {
  return headers.get(name) ?? headers.get(name.toLowerCase());
}

export async function fetchJson<T>(
  url: string,
  options: FetchJsonOptions = {},
): Promise<T> {
  const { init, fetchImpl = fetch } = options;

  const response = await fetchImpl(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    const details = errorBody ? ` - ${errorBody}` : "";
    throw new Error(
      `Request failed (${response.status} ${response.statusText})${details}`,
    );
  }

  const contentType = readHeaderCaseInsensitive(
    response.headers,
    "content-type",
  );

  if (!contentType || !contentType.includes("application/json")) {
    throw new Error("Expected JSON response content-type");
  }

  return (await response.json()) as T;
}
