"use client";

/** Thin fetch wrapper. Every route returns { error } on failure, so unwrap once here. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind?: string,
  ) {
    super(message);
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;

  let message = `Request failed (${res.status}).`;
  let kind: string | undefined;
  try {
    const body = await res.json();
    if (typeof body?.error === "string") message = body.error;
    if (typeof body?.kind === "string") kind = body.kind;
  } catch {
    /* non-JSON error body — keep the generic message */
  }
  throw new ApiError(message, res.status, kind);
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  return unwrap<T>(
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function patchJson<T>(url: string, body: unknown): Promise<T> {
  return unwrap<T>(
    await fetch(url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function getJson<T>(url: string): Promise<T> {
  return unwrap<T>(await fetch(url, { cache: "no-store" }));
}

export async function uploadFile(file: File): Promise<{
  text: string;
  kind: string;
  warnings: string[];
  filename: string;
}> {
  const form = new FormData();
  form.append("file", file);
  return unwrap(await fetch("/api/extract", { method: "POST", body: form }));
}

/** Downloads a generated document. Exports are never produced client-side (§6.4). */
export async function downloadExport(
  tailoredResumeId: string,
  format: "docx" | "pdf",
): Promise<void> {
  const res = await fetch("/api/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tailoredResumeId, format }),
  });

  if (!res.ok) {
    let message = `Export failed (${res.status}).`;
    try {
      const body = await res.json();
      if (typeof body?.error === "string") message = body.error;
    } catch {
      /* keep generic */
    }
    throw new ApiError(message, res.status);
  }

  const disposition = res.headers.get("content-disposition") ?? "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] ?? `resume.${format}`;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
