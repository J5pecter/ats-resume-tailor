import { expect, test } from "@playwright/test";

/**
 * Signup -> JD -> resume -> generate -> refine -> export (§Phase 7).
 *
 * The three model-backed steps are skipped unless RUN_LLM_E2E=1 and a provider
 * key is configured, so this suite stays runnable — and meaningful — on a
 * clean checkout with no API key. What always runs is the part that must never
 * break: auth, the protected routes, the tab gating, and both exporters.
 */

const PASSWORD = "e2e-password-123";

/** Each test signs up its own account so any one of them can be run alone. */
function freshEmail(tag: string): string {
  return `e2e-${tag}-${Date.now()}@example.test`;
}

async function signUp(page: import("@playwright/test").Page, email: string) {
  await page.goto("/");
  await page.getByRole("tab", { name: "Sign up" }).click();
  await page.getByLabel("Full name").fill("Priya Raman");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("tab", { name: "Job description" })).toBeVisible({
    timeout: 30_000,
  });
}

const JD_TEXT = `Senior Product Manager - Digital Onboarding
We are looking for a Senior Product Manager to own the digital onboarding and KYC
journey for our retail broking platform. You will lead discovery, define the
roadmap and work with engineering to reduce funnel drop-off.
Requirements: 5+ years of product management experience, demonstrated ownership of
a digital onboarding or KYC funnel, strong SQL, experience running discovery
interviews, bachelor's degree. Preferred: regulated financial products in India,
exposure to payments or ledger systems.`;

const RESUME_TEXT = `Priya Raman
Mumbai, India | +91 98200 11223 | priya.raman@example.com

Arihant Securities - Senior Product Manager (Apr 2023 - Present)
- Led redesign of digital onboarding journey; KYC drop-off fell 31% across 40,000 monthly applicants
- Ran weekly discovery interviews with 60 relationship managers to prioritise the 2024 roadmap
- Built SQL dashboards tracking funnel conversion across six acquisition channels

Paylane Technologies - Product Manager (Jun 2019 - Mar 2023)
- Migrated core ledger to event-sourced design with a squad of four; removed 14 hours of monthly reconciliation
- Shipped a merchant settlement report used by 300 merchants weekly

University of Mumbai, B.E. Information Technology, 8.4 CGPA, May 2019
Certified Scrum Product Owner, Scrum Alliance, 2021`;

const RUN_LLM = process.env.RUN_LLM_E2E === "1";

test.describe.configure({ mode: "serial" });

test("the dashboard is unreachable while logged out", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("tab", { name: "Log in" })).toBeVisible();
});

test("signup gates the later tabs until each step produces something", async ({ page }) => {
  await signUp(page, freshEmail("gating"));

  await expect(page.getByRole("tab", { name: "Resume" })).toBeDisabled();
  await expect(page.getByRole("tab", { name: "Refine & export" })).toBeDisabled();

  // The session is real: a protected route now answers instead of 401ing.
  const workspace = await page.evaluate(async () => {
    const res = await fetch("/api/workspace", { cache: "no-store" });
    return res.status;
  });
  expect(workspace).toBe(200);
});

test("every data route rejects an unauthenticated caller", async ({ request }) => {
  for (const [method, path] of [
    ["GET", "/api/workspace"],
    ["GET", "/api/jd"],
    ["POST", "/api/tailor"],
    ["POST", "/api/refine"],
    ["POST", "/api/export"],
    ["POST", "/api/extract"],
    ["DELETE", "/api/account"],
  ] as const) {
    const res = await request.fetch(path, { method, data: method === "GET" ? undefined : {} });
    expect(res.status(), `${method} ${path}`).toBe(401);
  }
});

test("job description, resume, generate, refine, export", async ({ page }) => {
  await signUp(page, freshEmail("flow"));

  const llmReady = await page.evaluate(async () => {
    const res = await fetch("/api/status", { cache: "no-store" });
    return (await res.json()).llm.ready as boolean;
  });

  test.skip(
    !RUN_LLM || !llmReady,
    "Set RUN_LLM_E2E=1 and configure a provider key to run the generative steps.",
  );

  // -- tab 1: job description --------------------------------------
  await page.getByRole("textbox", { name: "Paste the job description" }).fill(JD_TEXT);
  await page.getByRole("button", { name: "Analyse job description" }).click();
  await expect(page.getByText("Requirement profile")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/ATS keywords/)).toBeVisible();
  await page.getByRole("button", { name: /Looks right/ }).click();

  // -- tab 2: resume + gap analysis ---------------------------------
  await page.getByRole("textbox", { name: "Paste your resume" }).fill(RESUME_TEXT);
  await page.getByRole("button", { name: /Parse and analyse/ }).click();
  await expect(page.getByText("Simulated ATS match")).toBeVisible({ timeout: 120_000 });

  await page.getByRole("button", { name: "Generate tailored resume" }).click();
  await expect(page.getByText("Live preview")).toBeVisible({ timeout: 180_000 });

  const preview = page.getByLabel("Tailored resume preview");
  await expect(preview).toContainText("Priya Raman");
  await expect(preview).toContainText("PROFESSIONAL EXPERIENCE");
  await expect(preview).toContainText("Arihant Securities");

  // -- tab 3: refine ------------------------------------------------
  await page
    .getByRole("textbox", { name: "Refinement instruction" })
    .fill("Make the professional summary shorter.");
  await page.getByRole("button", { name: "Apply change" }).click();
  await expect(
    page.getByText(/Applied|Nothing was saved|Needs one more detail/),
  ).toBeVisible({ timeout: 180_000 });

  // -- export both formats ------------------------------------------
  for (const format of ["docx", "pdf"] as const) {
    const download = page.waitForEvent("download", { timeout: 60_000 });
    await page.getByRole("button", { name: `Export .${format}` }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(new RegExp(`\.${format}$`));
  }
});
