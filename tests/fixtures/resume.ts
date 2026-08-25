import type { ResumeDoc } from "@/lib/schema/resume";

/** A small but complete document, used across the export and validation tests. */
export const SAMPLE_RESUME: ResumeDoc = {
  contact: {
    fullName: "Priya Raman",
    headline: "Product Manager — Fintech & Digital Onboarding",
    email: "priya.raman@example.com",
    phone: "+91 98200 11223",
    location: "Mumbai, India",
    linkedin: "linkedin.com/in/priyaraman",
  },
  summary:
    "Product Manager with seven years across digital onboarding and payments. Shipped a KYC flow that cut drop-off by 31 percent and led a four-person squad through a core ledger migration.",
  coreSkills: [
    {
      category: "Product",
      skills: [
        // Named verbatim in the source — supported without needing evidence.
        { name: "Discovery", sourceEvidence: "Ran weekly discovery interviews" },
        // Relabelled into the JD's vocabulary; the evidence is what earns it.
        {
          name: "Experimentation",
          sourceEvidence: "Ran A/B tests on the onboarding funnel across two quarters",
        },
      ],
    },
    {
      category: "Analytics",
      skills: [
        { name: "SQL", sourceEvidence: "Built SQL dashboards tracking funnel conversion" },
        { name: "Funnel conversion analysis", sourceEvidence: "tracking funnel conversion" },
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
      bullets: [
        {
          text: "Led the redesign of the digital onboarding journey, cutting KYC drop-off by 31 percent across 40,000 monthly applicants.",
          keywordsHit: ["digital onboarding", "KYC"],
          sourceEvidence:
            "Led redesign of digital onboarding journey; KYC drop-off fell 31% across 40,000 monthly applicants",
        },
        {
          text: "Ran weekly discovery interviews with 60 relationship managers to prioritise the 2024 roadmap.",
          keywordsHit: ["discovery"],
          sourceEvidence:
            "Ran weekly discovery interviews with 60 relationship managers to prioritise the 2024 roadmap",
        },
      ],
    },
    {
      company: "Paylane Technologies",
      role: "Product Manager",
      startDate: "Jun 2019",
      endDate: "Mar 2023",
      bullets: [
        {
          text: "Migrated the core ledger to an event-sourced design with a four-person squad, removing 14 hours of monthly reconciliation.",
          keywordsHit: ["ledger"],
          sourceEvidence:
            "Migrated core ledger to event-sourced design with a squad of four; removed 14 hours of monthly reconciliation",
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
  certifications: [{ name: "Certified Scrum Product Owner", issuer: "Scrum Alliance", date: "2021" }],
  additional: [{ label: "Languages", value: "English, Hindi, Marathi" }],
};

/** The raw text those bullets were derived from — the evidence check's haystack. */
export const SAMPLE_RAW_TEXT = `Priya Raman
Mumbai, India | +91 98200 11223 | priya.raman@example.com

Arihant Securities — Senior Product Manager (Apr 2023 - Present)
- Led redesign of digital onboarding journey; KYC drop-off fell 31% across 40,000 monthly applicants
- Ran weekly discovery interviews with 60 relationship managers to prioritise the 2024 roadmap
- Ran A/B tests on the onboarding funnel across two quarters
- Built SQL dashboards tracking funnel conversion across six acquisition channels

Paylane Technologies — Product Manager (Jun 2019 - Mar 2023)
- Migrated core ledger to event-sourced design with a squad of four; removed 14 hours of monthly reconciliation

University of Mumbai, B.E. Information Technology, 8.4 CGPA, May 2019
Certified Scrum Product Owner, Scrum Alliance, 2021`;
