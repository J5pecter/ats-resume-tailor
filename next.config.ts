import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These are heavyweight Node-only libraries (pdf.js, a DOCX writer, a PDF
  // renderer). Bundling them into the server build breaks their dynamic
  // requires, so they stay external and are loaded at runtime.
  serverExternalPackages: [
    "@react-pdf/renderer",
    "unpdf",
    "mammoth",
    "docx",
    "@prisma/client",
  ],
};

export default nextConfig;
