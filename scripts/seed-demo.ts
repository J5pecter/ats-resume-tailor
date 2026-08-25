/**
 * Seeds a complete, already-tailored workspace for one user.
 *
 * Useful for two things: exercising tab 3 and both exporters without spending
 * a model call, and giving a new checkout something to look at immediately.
 *
 *   npm run demo:seed -- you@example.com
 */
import { config } from "dotenv";
import { PrismaClient } from "../lib/generated/prisma";
import { contentHash } from "../lib/hash";
import type { JDProfile } from "../lib/schema/jd";
import type { MatchAnalysis } from "../lib/schema/analysis";
import type { ResumeDoc } from "../lib/schema/resume";
import type { ChangeLogEntry } from "../lib/schema/tailor";

config({ path: ".env.local" });
config({ path: ".env" });

const prisma = new PrismaClient();

const RAW_JD = `Senior Product Manager — Digital Onboarding
Kotak Neo | Mumbai (hybrid)

We are looking for a Senior Product Manager to own the digital onboarding and
KYC journey for our retail broking platform. You will lead discovery, define the
roadmap, and work with engineering to ship improvements that reduce drop-off.

Requirements
- 5+ years of product management experience, ideally in fintech or broking
- Demonstrated ownership of a digital onboarding or KYC funnel
- Strong SQL and comfort with product analytics tooling
- Experience running discovery interviews and translating them into roadmap
- Bachelor's degree

Preferred
- Experience with regulated financial products in India
- Exposure to payments or ledger systems`;

const RAW_RESUME = `Priya Raman
Mumbai, India | +91 98200 11223 | priya.raman@example.com | linkedin.com/in/priyaraman

Arihant Securities - Senior Product Manager (Apr 2023 - Present), Mumbai
- Led redesign of digital onboarding journey; KYC drop-off fell 31% across 40,000 monthly applicants
- Ran weekly discovery interviews with 60 relationship managers to prioritise the 2024 roadmap
- Built SQL dashboards tracking funnel conversion across six acquisition channels

Paylane Technologies - Product Manager (Jun 2019 - Mar 2023), Pune
- Migrated core ledger to event-sourced design with a squad of four; removed 14 hours of monthly reconciliation
- Shipped a merchant settlement report used by 300 merchants weekly

University of Mumbai, B.E. Information Technology, 8.4 CGPA, May 2019
Certified Scrum Product Owner, Scrum Alliance, 2021
Languages: English, Hindi, Marathi`;

const JD_PROFILE: JDProfile = {
  roleTitle: "Senior Product Manager — Digital Onboarding",
  company: "Kotak Neo",
  seniority: "senior",
  function: "Product Management",
  mustHaves: [
    { requirement: "5+ years of product management experience", category: "experience" },
    { requirement: "Ownership of a digital onboarding or KYC funnel", category: "domain" },
    { requirement: "Strong SQL", category: "skill" },
    { requirement: "Product analytics tooling", category: "tool" },
    { requirement: "Discovery interviews translated into roadmap", category: "skill" },
    { requirement: "Bachelor's degree", category: "education" },
  ],
  niceToHaves: [
    { requirement: "Regulated financial products in India", category: "domain" },
    { requirement: "Payments or ledger systems", category: "domain" },
  ],
  hardFilters: {
    minYears: 5,
    degree: "Bachelor's degree",
    location: "Mumbai (hybrid)",
    certifications: [],
  },
  atsKeywords: [
    { term: "digital onboarding", weight: 5, variants: ["onboarding"] },
    { term: "KYC", weight: 5, variants: ["Know Your Customer"] },
    { term: "product management", weight: 5, variants: ["product manager"] },
    { term: "SQL", weight: 4, variants: [] },
    { term: "product analytics", weight: 4, variants: ["analytics"] },
    { term: "discovery", weight: 4, variants: ["discovery interviews"] },
    { term: "roadmap", weight: 4, variants: ["roadmapping"] },
    { term: "retail broking", weight: 3, variants: ["broking"] },
    { term: "ledger", weight: 2, variants: ["ledger systems"] },
    { term: "regulatory compliance", weight: 2, variants: ["compliance"] },
  ],
  responsibilities: [
    "Own the digital onboarding and KYC journey",
    "Lead discovery and define the roadmap",
    "Work with engineering to reduce funnel drop-off",
  ],
  tone: "corporate",
  impliedPriorities: [
    "Measurable funnel improvement matters more than feature count",
    "Comfort operating inside Indian financial regulation",
  ],
};

const ANALYSIS: MatchAnalysis = {
  atsScore: 74,
  matched: [
    { term: "digital onboarding", weight: 5, evidence: "Led redesign of digital onboarding journey" },
    { term: "KYC", weight: 5, evidence: "KYC drop-off fell 31%" },
    { term: "product management", weight: 5, evidence: "Senior Product Manager, Arihant Securities" },
    { term: "SQL", weight: 4, evidence: "Built SQL dashboards tracking funnel conversion" },
    { term: "discovery", weight: 4, evidence: "Ran weekly discovery interviews with 60 relationship managers" },
    { term: "roadmap", weight: 4, evidence: "prioritise the 2024 roadmap" },
    { term: "ledger", weight: 2, evidence: "Migrated core ledger to event-sourced design" },
  ],
  partial: [
    {
      term: "product analytics",
      weight: 4,
      closestEvidence: "Built SQL dashboards tracking funnel conversion across six acquisition channels",
      howToSurface:
        "Name the analytics work directly — funnel conversion dashboards are product analytics, but the phrase never appears.",
    },
    {
      term: "retail broking",
      weight: 3,
      closestEvidence: "Arihant Securities - Senior Product Manager",
      howToSurface:
        "Arihant Securities is a broking firm. Add a one-line company context so the domain is legible to a parser.",
    },
  ],
  missing: [
    {
      term: "regulatory compliance",
      weight: 2,
      honestNote:
        "Nothing in the resume evidences compliance ownership. Adjacent to the KYC work, but not the same thing.",
    },
  ],
  blockers: [],
  topThreeFixes: [
    "Say 'product analytics' explicitly where you describe the SQL dashboards.",
    "Add a company context line naming Arihant Securities as a retail broking firm.",
    "Lead the summary with the onboarding and KYC ownership — it is the highest-weighted requirement.",
  ],
};

const TAILORED: ResumeDoc = {
  contact: {
    fullName: "Priya Raman",
    headline: "Senior Product Manager — Digital Onboarding & KYC",
    email: "priya.raman@example.com",
    phone: "+91 98200 11223",
    location: "Mumbai, India",
    linkedin: "linkedin.com/in/priyaraman",
  },
  summary:
    "Senior Product Manager with six years across digital onboarding, KYC and payments in Indian financial services. Owns the onboarding funnel end to end, cutting KYC drop-off by 31 percent across 40,000 monthly applicants, and grounds roadmap decisions in discovery research and SQL-based product analytics.",
  coreSkills: [
    {
      category: "Product",
      skills: [
        { name: "Digital onboarding", sourceEvidence: "Led redesign of digital onboarding journey" },
        { name: "KYC journeys", sourceEvidence: "KYC drop-off fell 31%" },
        { name: "Discovery", sourceEvidence: "Ran weekly discovery interviews with 60 relationship managers" },
        { name: "Roadmap", sourceEvidence: "prioritise the 2024 roadmap" },
        {
          name: "Funnel optimisation",
          sourceEvidence: "KYC drop-off fell 31% across 40,000 monthly applicants",
        },
      ],
    },
    {
      category: "Analytics",
      skills: [
        { name: "SQL", sourceEvidence: "Built SQL dashboards tracking funnel conversion" },
        {
          name: "Product analytics",
          sourceEvidence: "Built SQL dashboards tracking funnel conversion across six acquisition channels",
        },
        {
          name: "Funnel conversion analysis",
          sourceEvidence: "dashboards tracking funnel conversion across six acquisition channels",
        },
      ],
    },
    {
      category: "Domain",
      skills: [
        { name: "Retail broking", sourceEvidence: "Arihant Securities - Senior Product Manager" },
        { name: "Payments", sourceEvidence: "Shipped a merchant settlement report used by 300 merchants weekly" },
        { name: "Ledger systems", sourceEvidence: "Migrated core ledger to event-sourced design" },
      ],
    },
  ],
  experience: [
    {
      company: "Arihant Securities",
      role: "Senior Product Manager",
      location: "Mumbai",
      startDate: "Apr 2023",
      endDate: "Present",
      context: "Retail broking platform",
      bullets: [
        {
          text: "Led the redesign of the digital onboarding journey, reducing KYC drop-off by 31 percent across 40,000 monthly applicants.",
          keywordsHit: ["digital onboarding", "KYC"],
          sourceEvidence:
            "Led redesign of digital onboarding journey; KYC drop-off fell 31% across 40,000 monthly applicants",
        },
        {
          text: "Built SQL product analytics dashboards tracking funnel conversion across six acquisition channels.",
          keywordsHit: ["SQL", "product analytics"],
          sourceEvidence:
            "Built SQL dashboards tracking funnel conversion across six acquisition channels",
        },
        {
          text: "Ran weekly discovery interviews with 60 relationship managers and translated the findings into the 2024 roadmap.",
          keywordsHit: ["discovery", "roadmap"],
          sourceEvidence:
            "Ran weekly discovery interviews with 60 relationship managers to prioritise the 2024 roadmap",
        },
      ],
    },
    {
      company: "Paylane Technologies",
      role: "Product Manager",
      location: "Pune",
      startDate: "Jun 2019",
      endDate: "Mar 2023",
      bullets: [
        {
          text: "Migrated the core ledger to an event-sourced design with a four-person squad, removing 14 hours of monthly reconciliation.",
          keywordsHit: ["ledger"],
          sourceEvidence:
            "Migrated core ledger to event-sourced design with a squad of four; removed 14 hours of monthly reconciliation",
        },
        {
          text: "Shipped a merchant settlement report adopted by 300 merchants weekly.",
          keywordsHit: [],
          sourceEvidence: "Shipped a merchant settlement report used by 300 merchants weekly",
        },
      ],
    },
  ],
  education: [
    {
      institution: "University of Mumbai",
      degree: "B.E.",
      field: "Information Technology",
      endDate: "May 2019",
      score: "8.4 CGPA",
    },
  ],
  certifications: [
    { name: "Certified Scrum Product Owner", issuer: "Scrum Alliance", date: "2021" },
  ],
  additional: [{ label: "Languages", value: "English, Hindi, Marathi" }],
};

const CHANGE_LOG: ChangeLogEntry[] = [
  {
    section: "summary",
    changeType: "reworded",
    before: "(no summary in the original resume)",
    after: TAILORED.summary,
    rationale:
      "The posting's two highest-weighted requirements are digital onboarding and KYC, so the summary now opens on them instead of a generic title.",
    keywordsTargeted: ["digital onboarding", "KYC", "product analytics"],
  },
  {
    section: "experience[0].bullets[1]",
    changeType: "surfaced",
    before: "Built SQL dashboards tracking funnel conversion across six acquisition channels",
    after: "Built SQL product analytics dashboards tracking funnel conversion across six acquisition channels.",
    rationale:
      "You were already doing product analytics; the phrase just never appeared. Naming it closes a partial match without claiming anything new.",
    keywordsTargeted: ["product analytics", "SQL"],
  },
  {
    section: "experience[0].context",
    changeType: "surfaced",
    before: "(no company context)",
    after: "Retail broking platform",
    rationale:
      "Arihant Securities is a broking firm, but a parser cannot infer that from the name. One line makes the domain legible.",
    keywordsTargeted: ["retail broking"],
  },
  {
    section: "coreSkills",
    changeType: "regrouped",
    before: "(skills were scattered through the bullets)",
    after: "Product / Analytics / Domain",
    rationale:
      "Grouped into three categories, most JD-relevant first, using the posting's own terminology for skills you genuinely have.",
    keywordsTargeted: ["digital onboarding", "SQL", "roadmap"],
  },
];

async function main() {
  const email = (process.argv[2] || process.env.DEMO_EMAIL || "").trim().toLowerCase();
  if (!email) {
    console.error("Usage: npm run demo:seed -- your@email.com");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No account found for ${email}. Sign up in the app first, then re-run this.`);
    process.exit(1);
  }

  const jd = await prisma.jobDescription.create({
    data: {
      userId: user.id,
      title: "Senior Product Manager — Kotak Neo (demo)",
      rawText: RAW_JD,
      contentHash: contentHash(RAW_JD),
      parsedJson: JD_PROFILE,
    },
  });

  const source = await prisma.sourceResume.create({
    data: {
      userId: user.id,
      label: "Priya Raman (demo)",
      rawText: RAW_RESUME,
      contentHash: contentHash(RAW_RESUME),
      parsedJson: TAILORED,
    },
  });

  await prisma.analysis.create({
    data: {
      userId: user.id,
      jobDescriptionId: jd.id,
      sourceResumeId: source.id,
      resultJson: ANALYSIS,
    },
  });

  const tailored = await prisma.tailoredResume.create({
    data: {
      userId: user.id,
      jobDescriptionId: jd.id,
      sourceResumeId: source.id,
      version: 1,
      contentJson: TAILORED,
      analysisJson: ANALYSIS,
      changeLogJson: CHANGE_LOG,
      note: "Demo tailored draft",
    },
  });

  console.log(`Seeded demo workspace for ${email}`);
  console.log(`  job description : ${jd.id}`);
  console.log(`  source resume   : ${source.id}`);
  console.log(`  tailored v1     : ${tailored.id}`);
  console.log("Reload /dashboard — it will open on the Refine & export tab.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
