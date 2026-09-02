/**
 * The evaluation corpus.
 *
 * Every case is synthetic. None of it is anyone's real resume — this file is
 * committed to a public repository, and a resume is sensitive personal data.
 * The cases are shaped after failures this project actually had, so a
 * regression in any of them is a regression that once shipped.
 */

import { VARIETY_CASES } from "./cases-variety";

export interface EvalCase {
  name: string;
  /** Why this case exists. Read this before deleting one. */
  why: string;
  jdText: string;
  resumeText: string;
  expect: {
    /** Fails the run if the projected score falls below this. */
    minAtsScore?: number;
    /** Fails the run if more than this many original bullets are dropped. */
    maxDroppedBullets?: number;
    /** Rule 4 is absolute: no MISSING keyword may appear in the output. */
    forbiddenMustBeZero?: boolean;
    /** Fails the run if the model cites evidence unrelated to its own claim. */
    maxUnrelatedEvidence?: number;
    notes: string;
  };
}

/**
 * The five the pipeline was built against: office-professional, mostly Indian
 * market, tidily bulleted. They test the failures that actually shipped.
 */
const CORE_CASES: EvalCase[] = [
  {
    name: "pm-strong-match",
    why:
      "Baseline. Heavy genuine overlap, so almost nothing should be dropped and the " +
      "score should be high. A regression here means the pipeline broke on the easy path.",
    jdText: `Senior Product Manager - Digital Onboarding, Mumbai.
Own the end-to-end digital onboarding and KYC journey for our retail broking platform.
Lead discovery, define and communicate the roadmap, and work with engineering to reduce
funnel drop-off. Required: 5+ years product management, demonstrated ownership of a KYC
or onboarding funnel, strong SQL, a bachelor's degree. Preferred: regulated financial
products in India, payments experience, stakeholder management at executive level.`,
    resumeText: `Priya Raman
Mumbai, India | +91 98200 11223 | priya.raman@example.com | linkedin.com/in/priyaraman
Senior Product Manager

PROFESSIONAL SUMMARY
Product manager with 6 years building onboarding and payments products for regulated
financial services in India.

EXPERIENCE
Arihant Securities - Senior Product Manager (Apr 2023 - Present), Mumbai
- Owned the digital KYC onboarding funnel end to end, cutting drop-off 31% across 40,000 monthly applicants
- Ran weekly discovery interviews with 60 relationship managers to prioritise the 2024 roadmap
- Built SQL dashboards tracking funnel conversion across six acquisition channels
- Partnered with engineering to ship a re-KYC flow meeting SEBI requirements

Paylane Technologies - Product Manager (Jun 2019 - Mar 2023), Pune
- Launched a UPI payments integration processing 2.1 crore rupees monthly
- Migrated the core ledger to an event-sourced design with a squad of four engineers
- Removed 14 hours of monthly manual reconciliation through automated matching

EDUCATION
Symbiosis Institute of Business Management, Pune - MBA, Marketing, 2019, CGPA 8.4
University of Pune - B.Com, 2017

SKILLS
Product discovery, Roadmapping, SQL, Funnel optimisation, KYC, UPI, Stakeholder management,
A/B testing, Jira, Figma`,
    expect: {
      minAtsScore: 55,
      maxDroppedBullets: 1,
      notes: "Dropping more than one bullet on a match this strong means over-trimming.",
    },
  },

  {
    name: "audit-gap-heavy",
    why:
      "The JD demands credentials and vocabulary the resume genuinely lacks. This is the " +
      "shape that caught 'ensuring timely corrective actions' being appended to an " +
      "otherwise real, well-evidenced bullet.",
    jdText: `Internal Auditor - Senior Associate.
Plan and execute risk-based internal audits across governance processes and non-financial
services lines. Test internal controls, document findings, and drive corrective actions
through to closure with senior management. Required: CIA or CISA certification, 5+ years
internal audit experience, deep knowledge of SOX and COSO, data analytics using ACL or IDEA.
Preferred: experience auditing non-financial services clients and governance processes.`,
    resumeText: `Rahul Menon
Bengaluru, India | +91 98801 44556 | rahul.menon@example.com
Internal Auditor

PROFESSIONAL SUMMARY
Internal auditor with 2 years in lending audits at a housing finance company.

EXPERIENCE
Meridian Housing Finance - Assistant Manager, Internal Audit (Feb 2024 - Present), Bengaluru
- Performed control testing of home loan underwriting to verify compliance with internal policy
- Executed branch process audits, identifying control gaps across 22 branches
- Prepared quarterly audit committee notes summarising ratings and findings
- Authored audit reports and coordinated discrepancy resolution with branch teams

Kestrel Advisors - Finance Intern (May 2023 - Jun 2023), Bengaluru
- Conducted financial analysis and DCF valuation for four companies
- Developed forecast statements and ratio assessments to support valuation conclusions

EDUCATION
Christ University, Bengaluru - MBA, Finance, 2024, CGPA 8.1
Christ University, Bengaluru - B.Com, 2022, CGPA 8.3

SKILLS
Internal auditing, Control testing, Risk assessment, Audit reporting, Mortgage loan auditing,
MS Excel, Report writing, Stakeholder communication`,
    expect: {
      forbiddenMustBeZero: true,
      notes:
        "CIA, CISA, SOX, COSO, ACL, IDEA, governance processes and non-financial services " +
        "are all absent from this resume. Any of them in the output is a hard failure.",
    },
  },

  {
    name: "similar-employers",
    why:
      "Two roles at similarly named employers with overlapping vocabulary. This produced " +
      "the worst bug in the project: a weak model citing the employer header line as " +
      "evidence for every bullet, then copying a bullet onto the wrong employer. " +
      "Traceability alone passes it; relatedness is what catches it.",
    jdText: `Data Engineer - Platform.
Build and operate batch and streaming pipelines feeding the analytics warehouse.
Required: 4+ years in data engineering, strong Python and SQL, Airflow, dbt, and
experience with Kafka. Preferred: Snowflake, Terraform, and on-call ownership.`,
    resumeText: `Anjali Desai
Hyderabad, India | +91 90000 77881 | anjali.desai@example.com
Data Engineer

EXPERIENCE
Northwind Data Systems - Senior Data Engineer (Jan 2023 - Present), Hyderabad
- Built Airflow pipelines loading 40 source systems into Snowflake on an hourly cadence
- Cut warehouse spend 22% by rewriting the heaviest dbt models to incremental materialisation
- Owned the on-call rotation for the ingestion platform across a team of five

Northwind Analytics Group - Data Engineer (Aug 2020 - Dec 2022), Hyderabad
- Wrote Kafka consumers processing 3 million clickstream events per day
- Migrated 200 legacy SQL reports onto dbt with regression tests for each
- Automated schema drift detection, cutting broken-dashboard incidents by half

EDUCATION
IIIT Hyderabad - B.Tech, Computer Science, 2020, CGPA 8.7

SKILLS
Python, SQL, Airflow, dbt, Kafka, Snowflake, Terraform, Spark, Git, Docker`,
    expect: {
      maxUnrelatedEvidence: 0,
      notes:
        "Every bullet must cite the work it describes rather than the employer header, " +
        "and must stay on the employer it came from.",
    },
  },

  {
    name: "long-senior",
    why:
      "Fifteen years across four roles, so the page budget genuinely forces a cut. " +
      "Measures whether trimming is proportionate and, above all, whether what was cut " +
      "is reported rather than dropped silently.",
    jdText: `Engineering Manager - Payments.
Lead two squads owning the payments platform. Set technical direction, grow engineers,
and be accountable for reliability. Required: 8+ years engineering with 3+ managing,
distributed systems, and payments or fintech domain experience. Preferred: Go, Kubernetes,
and experience running an on-call organisation.`,
    resumeText: `Vikram Shah
Pune, India | +91 99999 12345 | vikram.shah@example.com
Engineering Manager

EXPERIENCE
Cobalt Pay - Engineering Manager (Mar 2021 - Present), Pune
- Led two squads of 11 engineers owning card authorisation and settlement
- Took platform availability from 99.5% to 99.97% over eight quarters
- Introduced an on-call rotation with runbooks, cutting mean time to recovery from 90 to 22 minutes
- Grew four engineers to senior through a structured progression framework
- Replaced a monolithic settlement job with Go services on Kubernetes

Trellis Software - Staff Engineer (Jun 2017 - Feb 2021), Pune
- Designed the event bus carrying 80 million daily messages between 30 services
- Led the migration from a shared database to per-service ownership over 18 months
- Mentored eight engineers and ran the internal distributed systems reading group

Halcyon Systems - Senior Software Engineer (Apr 2014 - May 2017), Mumbai
- Built the reconciliation engine matching 2 million daily transactions
- Reduced batch settlement runtime from six hours to 40 minutes
- Wrote the first integration test suite for the billing platform

Orbit Retail - Software Engineer (Jul 2010 - Mar 2014), Mumbai
- Built inventory synchronisation across 120 retail outlets
- Maintained the point-of-sale integration used by 400 cashiers daily

EDUCATION
College of Engineering Pune - B.E., Computer Engineering, 2010

SKILLS
Go, Java, Kubernetes, Distributed systems, Payments, Kafka, PostgreSQL, Terraform,
On-call leadership, Mentoring, Incident response, System design`,
    expect: {
      notes:
        "Trimming is allowed here. Silent trimming is not: whatever is cut must appear " +
        "in the retention report.",
    },
  },

  {
    name: "sparse-junior",
    why:
      "A thin resume against a demanding JD. The temptation to invent is highest here " +
      "and there is very little real material to cite, so it is the strongest test of " +
      "the no-fabrication rule.",
    jdText: `Machine Learning Engineer.
Train, evaluate and deploy models in production. Required: 3+ years ML engineering,
PyTorch, distributed training, MLOps tooling, and production model monitoring.
Preferred: LLM fine-tuning, vector databases, and Kubernetes.`,
    resumeText: `Sana Iqbal
Delhi, India | +91 88000 33221 | sana.iqbal@example.com
Junior Data Analyst

EXPERIENCE
Bluebird Retail - Data Analyst (Aug 2024 - Present), Delhi
- Built weekly sales dashboards in Power BI for three regional managers
- Wrote SQL queries against the orders database to answer ad hoc merchandising questions

EDUCATION
Delhi University - B.Sc., Statistics, 2024, CGPA 7.9

SKILLS
SQL, Power BI, Excel, Python (basic), Statistics`,
    expect: {
      forbiddenMustBeZero: true,
      notes:
        "PyTorch, distributed training, MLOps and model monitoring are all absent. The " +
        "honest output is a short resume with a long gap list, not a padded one.",
    },
  },
];

/**
 * Core first so a breakage in the familiar shape shows up before the exotic
 * ones scroll past.
 */
export const EVAL_CASES: EvalCase[] = [...CORE_CASES, ...VARIETY_CASES];
