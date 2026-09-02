import type { EvalCase } from "./cases";

/**
 * Breadth cases.
 *
 * The core five are all office-professional, mostly Indian-market, and all
 * neatly bullet-formatted — which is to say they test the shape of resume this
 * was first built against, and quietly assume every resume looks like that.
 *
 * These do not. Each varies one axis the pipeline might be silently relying on:
 * the industry vocabulary, the seniority, the document format, the market, the
 * shape of the career. A guard that only works on a tidy Indian product-manager
 * CV is not a guard, it is a coincidence.
 */
export const VARIETY_CASES: EvalCase[] = [
  {
    name: "nurse-clinical",
    why:
      "Healthcare vocabulary, licensure, and shift work — none of which look like " +
      "software. Tests whether the ATS rules generalise past office roles, and whether " +
      "a licence number survives as a credential rather than being scrubbed as a metric.",
    jdText: `Registered Nurse - Medical Surgical Unit, Manchester.
Deliver direct patient care on a 32-bed surgical ward. Assess, plan and evaluate care
plans, administer medication, and escalate deteriorating patients. Required: NMC
registration, 2+ years acute inpatient experience, competence in IV cannulation and
venepuncture. Preferred: mentorship of student nurses, experience with electronic
patient records, and ALS certification.`,
    resumeText: `Grace Okonkwo
Manchester, UK | 07700 900123 | grace.okonkwo@example.com
Registered Nurse | NMC Pin 12A3456B

EXPERIENCE
Pennine Acute Trust - Staff Nurse, Band 5 (Mar 2022 - Present), Manchester
- Delivered care for up to 8 surgical inpatients per shift on a 32-bed ward
- Administered IV medication and performed cannulation and venepuncture daily
- Escalated deteriorating patients using NEWS2 scoring, twice initiating rapid response
- Mentored 6 student nurses through practice placements

Wythenshawe Hospital - Healthcare Assistant (Jun 2020 - Feb 2022), Manchester
- Supported personal care and mobility for post-operative patients
- Recorded observations into the electronic patient record system

EDUCATION
University of Salford - BSc (Hons) Adult Nursing, 2022

SKILLS
Patient assessment, IV cannulation, Venepuncture, NEWS2, Medication administration,
Care planning, Electronic patient records, Mentorship, Infection control`,
    expect: {
      maxUnrelatedEvidence: 0,
      notes: "The NMC pin is a credential, not a metric. It must not be invented or altered.",
    },
  },

  {
    name: "teacher-career-change",
    why:
      "A career changer. Almost nothing matches on vocabulary, and the honest job is to " +
      "surface transferable work rather than to relabel teaching as project management. " +
      "The strongest pull toward fabrication in the corpus.",
    jdText: `Learning & Development Specialist.
Design and deliver training programmes for a 400-person commercial organisation.
Build curricula, run workshops, and measure learning outcomes. Required: 3+ years
designing and delivering training to adults, stakeholder management, and data-led
evaluation of programme effectiveness. Preferred: LMS administration, SCORM authoring,
and experience in a corporate environment.`,
    resumeText: `Daniel Whitfield
Leeds, UK | 07700 900456 | daniel.whitfield@example.com
Secondary School Teacher

EXPERIENCE
Ashfield Academy - Head of Department, Geography (Sep 2019 - Present), Leeds
- Designed the key stage 4 curriculum delivered to 240 students across 8 classes
- Led a team of 5 teachers, running weekly planning and observation cycles
- Raised departmental attainment from 58% to 71% grade 4+ over three years
- Ran twilight training sessions for 40 staff on assessment for learning

Brookfield High School - Geography Teacher (Sep 2016 - Aug 2019), Leeds
- Taught 5 classes across key stages 3 and 4
- Introduced a data tracking spreadsheet used across the humanities faculty

EDUCATION
University of Leeds - PGCE Secondary Geography, 2016
University of Sheffield - BA Geography, 2015

SKILLS
Curriculum design, Lesson delivery, Assessment, Data tracking, Team leadership,
Staff training, Differentiation, Behaviour management`,
    expect: {
      forbiddenMustBeZero: true,
      notes:
        "LMS, SCORM and corporate environment are absent. Curriculum design and staff " +
        "training are real and transferable; the first must not be claimed, the second " +
        "must not be thrown away.",
    },
  },

  {
    name: "prose-format-no-bullets",
    why:
      "Written in paragraphs with no bullet characters at all. The parser has only ever " +
      "been tested on bulleted documents, so this checks it can find discrete achievements " +
      "in prose rather than returning one enormous bullet per role.",
    jdText: `Operations Manager - Regional Distribution.
Own the day to day running of a 60-person distribution centre. Accountable for safety,
throughput and cost per unit. Required: 5+ years operations leadership, warehouse or
logistics experience, and a record of process improvement. Preferred: Lean or Six Sigma
certification and WMS implementation experience.`,
    resumeText: `MARIA SANTOS
Birmingham, UK | 07700 900789 | maria.santos@example.com

PROFILE
Operations leader with eleven years in logistics and distribution.

EMPLOYMENT HISTORY

Kestrel Logistics, Birmingham. Operations Manager, January 2019 to present.
I run a distribution centre employing sixty staff across three shifts, holding
accountability for safety, throughput and cost per unit. Over four years I reduced cost
per unit by nineteen per cent, largely by redesigning the pick path and moving to wave
picking. I led the implementation of a new warehouse management system across the site,
which cut mis-picks by a third. I also chair the site safety committee, and we have gone
two years without a reportable incident.

Halewood Freight, Coventry. Shift Supervisor, March 2014 to December 2018.
I supervised a night shift of eighteen operatives, managing inbound goods receipt and
put-away. I introduced a standard work checklist for goods-in which reduced receipting
errors substantially, and I trained fourteen new starters over that period.

EDUCATION
Aston University, BSc Logistics and Supply Chain Management, 2013.

SKILLS
Warehouse operations, Team leadership, Health and safety, WMS, Process improvement,
Shift planning, Goods receipt, KPI reporting`,
    expect: {
      notes:
        "Three or four discrete achievements per role should come out of the prose. One " +
        "giant bullet per role means the parser is copying paragraphs rather than reading them.",
    },
  },

  {
    name: "employment-gap",
    why:
      "A two-year gap, and a JD that asks for continuity. Tests that dates are reported " +
      "as they are: the pull is to quietly stretch an end date so the gap disappears, " +
      "which is a fabrication that would collapse in a reference check.",
    jdText: `Financial Controller.
Own month-end close, statutory reporting and audit liaison for a 200-person business.
Required: qualified accountant (ACA, ACCA or CIMA), 5+ years in a controller or senior
finance role, and consolidation experience. Preferred: NetSuite, and experience in a
private equity backed business.`,
    resumeText: `Thomas Reilly
Dublin, Ireland | +353 87 123 4567 | thomas.reilly@example.com
Financial Controller | ACA

EXPERIENCE
Ardmore Group - Financial Controller (Sep 2023 - Present), Dublin
- Owned month-end close for a group of four entities, reducing close from 12 to 7 days
- Prepared statutory accounts under FRS 102 and led the annual audit
- Consolidated three subsidiary ledgers into a single reporting pack

Career break (Aug 2021 - Aug 2023)
- Full-time caring responsibilities following a family illness

Linnet Foods - Finance Manager (Jun 2017 - Jul 2021), Cork
- Managed a team of three in accounts payable and receivable
- Rebuilt the monthly management pack used by the board
- Implemented a purchase order approval workflow, cutting maverick spend

EDUCATION
University College Cork - BComm, 2014
Chartered Accountants Ireland - ACA, 2017

SKILLS
Month-end close, Statutory reporting, FRS 102, Consolidation, Audit liaison,
Management accounts, Accounts payable, Team leadership, Excel`,
    expect: {
      maxUnrelatedEvidence: 0,
      notes:
        "The 2021-2023 break is real and dated. Dates must survive unchanged, and the " +
        "break must not be silently absorbed into an adjacent role.",
    },
  },

  {
    name: "academic-cv",
    why:
      "An academic CV: publications, grants, teaching, and a structure the ResumeDoc " +
      "schema was never designed around. Tests that an unusual shape degrades into " +
      "something honest rather than losing half the document.",
    jdText: `Senior Research Scientist - Computational Biology.
Lead a research programme in single-cell genomics. Publish, secure funding, and
supervise junior scientists. Required: PhD in a relevant field, a strong publication
record, and proficiency in Python and R. Preferred: experience with single-cell RNA-seq
pipelines and a track record of winning competitive grants.`,
    resumeText: `Dr Ingrid Halvorsen
Oslo, Norway | +47 400 12 345 | ingrid.halvorsen@example.com
Postdoctoral Research Fellow, Computational Biology

RESEARCH EXPERIENCE
University of Oslo - Postdoctoral Fellow (2021 - Present)
- Led a project on single-cell RNA-seq of hepatic tissue, published in Nature Communications
- Built an analysis pipeline in Python and R now used by four groups in the department
- Supervised two PhD students and three masters students to completion

Karolinska Institutet - PhD Candidate (2017 - 2021)
- Thesis on transcriptional regulation in liver regeneration
- Awarded a 1.2 million SEK doctoral grant from the Swedish Research Council

PUBLICATIONS
Halvorsen I. et al., Single-cell atlas of hepatic regeneration, Nature Communications, 2023
Halvorsen I., Lindqvist P., Transcriptional programmes in liver injury, Cell Reports, 2022
Eleven further peer-reviewed publications, h-index 9

EDUCATION
Karolinska Institutet - PhD, Molecular Medicine, 2021
University of Bergen - MSc, Bioinformatics, 2017

SKILLS
Python, R, Single-cell RNA-seq, Bioconductor, Nextflow, Statistics, Grant writing,
Supervision, Scientific writing`,
    expect: {
      notes:
        "Publications and the grant are credentials. They may be reorganised but must " +
        "not vanish, and the h-index must not change.",
    },
  },

  {
    name: "trades-hands-on",
    why:
      "A skilled trade. No metrics, no jargon a keyword matcher recognises, and " +
      "achievements that are certifications and safety records rather than percentages. " +
      "Checks the tailor prompt does not treat 'no numbers' as licence to invent some.",
    jdText: `Maintenance Electrician - Manufacturing Site.
Carry out planned and reactive maintenance on production plant. Fault-find on three
phase systems, maintain records, and work to permit systems. Required: NVQ Level 3 in
Electrical Installation, 18th Edition, and 3+ years in an industrial setting.
Preferred: PLC fault-finding, and experience with CMMS.`,
    resumeText: `Wayne Prosser
Sheffield, UK | 07700 900222 | wayne.prosser@example.com
Maintenance Electrician

EXPERIENCE
Foxhill Steel - Maintenance Electrician (Apr 2019 - Present), Sheffield
- Carried out planned preventive maintenance across rolling mill plant
- Fault-found on three phase distribution and motor control centres
- Worked to permit-to-work systems in a high hazard environment
- Logged all work into the site CMMS

Trentside Engineering - Electrical Apprentice then Electrician (Sep 2014 - Mar 2019), Rotherham
- Completed a four year apprenticeship in industrial electrical maintenance
- Installed and terminated containment and cabling on plant upgrades

QUALIFICATIONS
NVQ Level 3 Electrical Installation, 2018
City and Guilds 2382 18th Edition, 2019
IPAF and Confined Space certified

SKILLS
Three phase systems, Motor control centres, Fault finding, Preventive maintenance,
Permit to work, CMMS, Containment installation, Test and inspection`,
    expect: {
      forbiddenMustBeZero: true,
      notes:
        "PLC fault-finding is absent and must not appear. No percentages exist in this " +
        "resume, and none may be introduced.",
    },
  },

  {
    name: "executive-brief",
    why:
      "A short, senior, achievement-light CV of the kind executives actually circulate. " +
      "Very little text to cite, so a fabrication has almost nowhere to hide — and the " +
      "page budget pressure that usually forces trimming is absent.",
    jdText: `Chief Operating Officer.
Report to the CEO of a 900-person services business. Own operations, delivery and P&L.
Required: prior COO or equivalent at scale, P&L ownership above 50 million, and
experience leading through a period of significant change. Preferred: services or
consulting background, and experience of an acquisition.`,
    resumeText: `Angela Boateng
London, UK | 07700 900333 | angela.boateng@example.com
Chief Operating Officer

EXPERIENCE
Marlowe Services Group - Chief Operating Officer (2020 - Present), London
- Accountable for operations and delivery across a 900-person services business
- Owned a P&L of 140 million pounds
- Led the integration of an acquired 200-person consultancy

Bracken Consulting - Managing Director, Delivery (2015 - 2020), London
- Ran delivery for a 350-person consulting practice
- Grew practice revenue from 40 million to 72 million pounds

EDUCATION
London Business School - MBA, 2012
University of Warwick - BSc Economics, 2004

SKILLS
Operations leadership, P&L ownership, Post-merger integration, Delivery management,
Board reporting, Change leadership`,
    expect: {
      minAtsScore: 55,
      maxDroppedBullets: 0,
      notes:
        "Only six bullets exist and all are relevant. Dropping any of them on a document " +
        "this short is over-trimming with no page pressure to excuse it.",
    },
  },

  {
    name: "freelance-portfolio",
    why:
      "A freelancer: overlapping engagements, no single employer, and clients rather than " +
      "job titles. Checks the experience model does not force this into a shape it is not, " +
      "and that overlapping dates survive.",
    jdText: `Senior Product Designer.
Own end-to-end design for a B2B SaaS platform. Run discovery, prototype, and ship with
engineering. Required: 5+ years product design, a portfolio of shipped B2B work, and
fluency in Figma. Preferred: design systems ownership and front-end familiarity.`,
    resumeText: `Kofi Mensah
Berlin, Germany | +49 151 2345 6789 | kofi.mensah@example.com | kofimensah.design
Independent Product Designer

SELECTED ENGAGEMENTS
Helio Analytics - Lead Product Designer, contract (Feb 2023 - Present)
- Redesigned the dashboard builder used by 4,000 business customers
- Built and documented a 60-component design system in Figma

Vantage Logistics - Product Designer, contract (Aug 2022 - Jun 2023)
- Ran discovery with 25 warehouse operators and prototyped a replacement scanning flow
- Shipped the new flow with a squad of three engineers

Nordwind GmbH - Product Designer, contract (Jan 2021 - Jul 2022)
- Designed the onboarding experience for a B2B freight marketplace

Earlier: in-house product designer at Steinweg AG (2017 - 2020), Hamburg

EDUCATION
Universitat der Kunste Berlin - Diplom, Communication Design, 2016

SKILLS
Figma, Design systems, Prototyping, User research, Interaction design, Accessibility,
HTML and CSS, Workshop facilitation`,
    expect: {
      notes:
        "Two engagements overlap in 2023. Both are real and both must survive with their " +
        "dates intact — collapsing them into one tidy sequence is a fabrication.",
    },
  },

  {
    name: "terse-jd",
    why:
      "A three-line job posting. The gap analysis has almost nothing to work with, and the " +
      "risk is that a thin JDProfile produces either an empty MISSING list that permits " +
      "anything, or an invented one that forbids things the posting never asked for.",
    jdText: `Sales Development Representative. Outbound prospecting into mid-market accounts.
Must be comfortable on the phone. Base plus commission. Immediate start.`,
    resumeText: `Lucia Ferrari
Milan, Italy | +39 340 123 4567 | lucia.ferrari@example.com
Sales Development Representative

EXPERIENCE
Ravello Software - Sales Development Representative (May 2023 - Present), Milan
- Made 60 outbound calls daily into mid-market manufacturing accounts
- Booked 18 qualified meetings per month against a target of 12
- Built the objection-handling playbook now used by the whole SDR team

Corsini Retail - Inside Sales Associate (Jan 2022 - Apr 2023), Milan
- Handled inbound enquiries and converted 22% to opportunities
- Maintained account records in Salesforce

EDUCATION
Universita Bocconi - BSc Economics and Management, 2021

SKILLS
Outbound prospecting, Cold calling, Objection handling, Salesforce, Lead qualification,
CRM hygiene, Italian, English`,
    expect: {
      notes:
        "A thin JD must not produce a fabricated requirement profile. Whatever MISSING " +
        "contains has to be traceable to those three lines.",
    },
  },
];
