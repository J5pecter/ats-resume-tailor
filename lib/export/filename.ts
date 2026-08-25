/** {FirstName}_{LastName}_{RoleTitle}.{ext}, spaces -> underscores (§6.1). */
export function exportFilename(
  fullName: string,
  roleTitle: string,
  ext: "docx" | "pdf",
): string {
  const clean = (value: string) =>
    value
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");

  const parts = [clean(fullName), clean(roleTitle)].filter(Boolean);
  const stem = parts.join("_") || "Resume";
  return `${stem.slice(0, 120)}.${ext}`;
}
