/**
 * End-to-end smoke test of the prompt layer against the configured provider.
 *
 *   npm run llm:check
 *
 * Runs three of the five prompts on a tiny fixture and reports what came back,
 * including whether the anti-fabrication guards fired. Costs a few thousand
 * tokens, and is the fastest way to confirm a new key actually works.
 */
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const { activeModel, activeProvider, providerReady, missingKeyMessage } = await import(
    "../lib/llm/providers"
  );
  const { resolveChain, describeEndpoint } = await import("../lib/llm/endpoints");
  const { callStructured } = await import("../lib/llm/client");
  const { jdParserPrompt } = await import("../lib/prompts/jdParser");
  const { resumeParserPrompt } = await import("../lib/prompts/resumeParser");
  const { gapAnalysisPrompt } = await import("../lib/prompts/gapAnalysis");

  const provider = activeProvider();
  console.log(`provider : ${provider}`);
  console.log(`model    : ${activeModel(provider)}\n`);

  // The whole point of a spare is that you find out it is broken now, rather
  // than at the moment the primary stops working.
  const chain = resolveChain();
  const spares = chain.endpoints.filter((e) => e.name !== "primary");
  console.log(
    `fallbacks: ${spares.length ? spares.map(describeEndpoint).join(", ") : "none configured"}`,
  );
  for (const { endpoint, reason } of chain.skipped) {
    console.log(`  skipped  ${describeEndpoint(endpoint)} - ${reason}`);
  }
  console.log("");

  if (!providerReady(provider)) {
    console.error(missingKeyMessage(provider));
    process.exit(1);
  }

  const JD = `Senior Product Manager - Digital Onboarding, Mumbai.
Own the digital onboarding and KYC journey for our retail broking platform.
Lead discovery, define the roadmap, work with engineering to reduce drop-off.
Required: 5+ years product management, ownership of a KYC funnel, strong SQL,
bachelor's degree. Preferred: regulated financial products in India, payments.`;

  const RESUME = `Priya Raman
Mumbai, India | +91 98200 11223 | priya.raman@example.com

Arihant Securities - Senior Product Manager (Apr 2023 - Present)
- Led redesign of digital onboarding journey; KYC drop-off fell 31% across 40,000 monthly applicants
- Ran weekly discovery interviews with 60 relationship managers to prioritise the 2024 roadmap
- Built SQL dashboards tracking funnel conversion across six acquisition channels

Paylane Technologies - Product Manager (Jun 2019 - Mar 2023)
- Migrated core ledger to event-sourced design with a squad of four; removed 14 hours of monthly reconciliation

University of Mumbai, B.E. Information Technology, 8.4 CGPA, May 2019`;

  console.log("1/3  JD_PARSER …");
  const jd = await callStructured(jdParserPrompt(JD));
  console.log(
    `     ok  ${jd.data.roleTitle} · ${jd.data.seniority} · ${jd.data.atsKeywords.length} keywords · ${jd.meta.latencyMs}ms · ${jd.meta.attempts} attempt(s)`,
  );

  console.log("2/3  RESUME_PARSER …");
  const resume = await callStructured(resumeParserPrompt(RESUME));
  const bullets = resume.data.experience.reduce((n, e) => n + e.bullets.length, 0);
  console.log(
    `     ok  ${resume.data.contact.fullName} · ${resume.data.experience.length} roles · ${bullets} bullets · ${resume.meta.latencyMs}ms`,
  );

  console.log("3/3  GAP_ANALYSIS …");
  const analysis = await callStructured(gapAnalysisPrompt(jd.data, resume.data));
  console.log(
    `     ok  score ${Math.round(analysis.data.atsScore)} · ${analysis.data.matched.length} matched · ${analysis.data.partial.length} partial · ${analysis.data.missing.length} missing · ${analysis.meta.latencyMs}ms`,
  );

  const { checkEvidence } = await import("../lib/validate/evidence");
  const evidence = checkEvidence(resume.data, RESUME);
  console.log(
    `\nevidence check: ${evidence.passed ? "passed" : "FAILED"} (${evidence.checked} bullets, ${evidence.failures.length} unsupported)`,
  );

  // A count alone does not tell you whether a fallback is usable. "unrelated"
  // means the model cited something real but not about this claim, which is
  // how a weak model fails; "unsupported" means it quoted something that is
  // not in the source at all. Both get dropped downstream, so the failure mode
  // is a thinner resume rather than an invented one — but you want to see it
  // before you rely on the endpoint, not after.
  for (const f of evidence.failures) {
    console.log(`  ${f.reason.padEnd(11)} ${f.where}`);
    console.log(`    claim  ${f.text.slice(0, 96)}`);
    console.log(`    cited  ${f.sourceEvidence.slice(0, 96)}  (overlap ${f.overlap.toFixed(2)})`);
  }

  if (analysis.data.missing.length) {
    console.log(`honest gaps  : ${analysis.data.missing.map((m) => m.term).join(", ")}`);
  }

  console.log("\nAll three prompts returned schema-valid output. The app is ready.");
}

main().catch((err) => {
  console.error(`\nFailed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
