-- seed.sql
--
-- Deterministic fixture data, run automatically by `supabase db reset`.
--
-- DETERMINISTIC means every id is a literal, never gen_random_uuid(). E2E
-- tests hard-code these ids; a seed that generated them would force every test
-- to start with a lookup, and a flaky lookup is a flaky test. The ids are
-- readable on purpose — 1111… is the user, 2222… the document, and so on — so
-- a failing assertion tells you which fixture it was about.
--
-- IDEMPOTENT: every statement is `on conflict do nothing`, so re-running the
-- seed against a database that already has it is a no-op rather than an error.
--
-- One user, one uploaded document with its facts, one job, one resume with one
-- version, and the analysis joining them. That is the smallest set that
-- exercises a full tailoring round trip.
--
--   user      11111111-1111-4111-8111-111111111111  test@example.com / password123
--   document  22222222-2222-4222-8222-222222222222
--   job       33333333-3333-4333-8333-333333333333
--   resume    44444444-4444-4444-8444-444444444444
--   version   55555555-5555-4555-8555-555555555555

-- --------------------------------------------------------------------------
-- The test user
-- --------------------------------------------------------------------------
-- crypt()/bcrypt so the password actually works against GoTrue's sign-in
-- endpoint; a plaintext value here would make the fixture unusable for any
-- test that logs in. email_confirmed_at is set so no confirmation mail is
-- required.
insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
)
values (
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-4111-8111-111111111111',
    'authenticated',
    'authenticated',
    'test@example.com',
    crypt('password123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Priya Nair"}'::jsonb,
    now(),
    now()
)
on conflict (id) do nothing;

-- GoTrue will not let an email/password user sign in without a matching
-- identity row. Guarded, because the local shim used for bare-Postgres runs
-- may not model every column of the real table.
do $$
begin
    if to_regclass('auth.identities') is not null then
        insert into auth.identities (
            id, user_id, identity_data, provider, provider_id,
            last_sign_in_at, created_at, updated_at
        )
        values (
            '11111111-1111-4111-8111-111111111111',
            '11111111-1111-4111-8111-111111111111',
            '{"sub":"11111111-1111-4111-8111-111111111111","email":"test@example.com"}'::jsonb,
            'email',
            '11111111-1111-4111-8111-111111111111',
            now(), now(), now()
        )
        on conflict do nothing;
    end if;
end $$;

-- --------------------------------------------------------------------------
-- The uploaded resume
-- --------------------------------------------------------------------------
insert into documents (
    id, user_id, storage_path, kind, sha256, page_count, style_json, raw_text, notes
)
values (
    '22222222-2222-4222-8222-222222222222',
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.pdf',
    'pdf',
    'seedsha256000000000000000000000000000000000000000000000000000001',
    1,
    '{"page_width":595.0,"page_height":842.0,
      "margins":{"top":54.0,"right":54.0,"bottom":54.0,"left":54.0},
      "column_count":1,"column_bands":[],
      "font_sizes":{"name":18.0,"heading":12.0,"body":10.0,"small":8.5},
      "body_line_height":13.2,"bullet_glyph":"•","accent_color":"#1f3a5f",
      "serif":false,"fonts":["Calibri","Calibri-Bold"]}'::jsonb,
$doc$Priya Nair
Full Stack Engineer
Ahmedabad, India | priya.nair@example.com | +91 98250 11111
github.com/priyanair | linkedin.com/in/priyanair

SUMMARY
Full stack engineer with 3 years building and operating customer-facing web
applications on Node.js and Postgres.

EXPERIENCE
Senior Software Engineer, Kavi Labs — Ahmedabad, India
Mar 2023 - Present
- Rebuilt the order-processing service in TypeScript and Node.js, cutting p95
  checkout latency from 1.8s to 640ms for 40,000 daily orders.
- Designed the Postgres schema and row-level-security policies behind a
  multi-tenant merchant dashboard used by 120 merchants.
- Introduced contract tests in Jest and Playwright, taking release rollbacks
  from roughly one a fortnight to two in a year.

Software Engineer, Trellis Systems — Pune, India
Jul 2021 - Feb 2023
- Built 30+ REST endpoints in Python and FastAPI serving an internal logistics
  platform with 2,400 weekly active users.
- Migrated batch reporting from cron scripts to Airflow, reducing the nightly
  window from 4 hours to 50 minutes.

PROJECTS
Ledgerline — open-source double-entry bookkeeping library
- Published a TypeScript library with 1,100 GitHub stars and 8 contributors.

EDUCATION
B.E. Computer Engineering, Gujarat Technological University, 2017 - 2021
First class with distinction, CGPA 8.6

SKILLS
Languages: TypeScript, Python, SQL
Frameworks: Node.js, React, FastAPI, Next.js
Data: PostgreSQL, Redis, Airflow
Cloud & DevOps: AWS, Docker, GitHub Actions, Terraform

CERTIFICATIONS
AWS Certified Solutions Architect - Associate, 2024$doc$,
    '["Single column layout detected; text extraction is reliable."]'::jsonb
)
on conflict (id) do nothing;

-- --------------------------------------------------------------------------
-- Facts extracted from it
-- --------------------------------------------------------------------------
-- fact_key follows the extractor's convention from models.py: E<n> for an
-- experience block, E<n>.B<m> for its bullets, P/S/C for projects, skill
-- groups and certifications. origin is 'document' for everything here except
-- the last row, which demonstrates the 'attested' path a later phase will use.
insert into facts (id, user_id, document_id, fact_key, text, origin, entities_json, evidence_json)
values
    ('66666666-0000-4000-8000-000000000001',
     '11111111-1111-4111-8111-111111111111',
     '22222222-2222-4222-8222-222222222222',
     'E1',
     'Senior Software Engineer, Kavi Labs, Ahmedabad, India, Mar 2023 - Present',
     'document',
     '{"employers":["Kavi Labs"],"dates":["Mar 2023","Present"],"technologies":[]}'::jsonb,
     '{"page":1,"section":"experience","quote":"Senior Software Engineer, Kavi Labs"}'::jsonb),

    ('66666666-0000-4000-8000-000000000002',
     '11111111-1111-4111-8111-111111111111',
     '22222222-2222-4222-8222-222222222222',
     'E1.B1',
     'Rebuilt the order-processing service in TypeScript and Node.js, cutting p95 checkout latency from 1.8s to 640ms for 40,000 daily orders.',
     'document',
     '{"metrics":["1.8s","640ms","40,000"],"technologies":["TypeScript","Node.js"],"employers":["Kavi Labs"]}'::jsonb,
     '{"page":1,"section":"experience","quote":"cutting p95 checkout latency from 1.8s to 640ms"}'::jsonb),

    ('66666666-0000-4000-8000-000000000003',
     '11111111-1111-4111-8111-111111111111',
     '22222222-2222-4222-8222-222222222222',
     'E1.B2',
     'Designed the Postgres schema and row-level-security policies behind a multi-tenant merchant dashboard used by 120 merchants.',
     'document',
     '{"metrics":["120"],"technologies":["Postgres","row-level security"],"employers":["Kavi Labs"]}'::jsonb,
     '{"page":1,"section":"experience","quote":"multi-tenant merchant dashboard used by 120 merchants"}'::jsonb),

    ('66666666-0000-4000-8000-000000000004',
     '11111111-1111-4111-8111-111111111111',
     '22222222-2222-4222-8222-222222222222',
     'E2.B1',
     'Built 30+ REST endpoints in Python and FastAPI serving an internal logistics platform with 2,400 weekly active users.',
     'document',
     '{"metrics":["30+","2,400"],"technologies":["Python","FastAPI"],"employers":["Trellis Systems"]}'::jsonb,
     '{"page":1,"section":"experience","quote":"30+ REST endpoints in Python and FastAPI"}'::jsonb),

    ('66666666-0000-4000-8000-000000000005',
     '11111111-1111-4111-8111-111111111111',
     '22222222-2222-4222-8222-222222222222',
     'S1',
     'Languages: TypeScript, Python, SQL',
     'document',
     '{"technologies":["TypeScript","Python","SQL"]}'::jsonb,
     '{"page":1,"section":"skills"}'::jsonb),

    ('66666666-0000-4000-8000-000000000006',
     '11111111-1111-4111-8111-111111111111',
     '22222222-2222-4222-8222-222222222222',
     'C1',
     'AWS Certified Solutions Architect - Associate, 2024',
     'document',
     '{"technologies":["AWS"],"dates":["2024"]}'::jsonb,
     '{"page":1,"section":"certifications"}'::jsonb),

    -- No document backs this one. It is the shape an attestation takes, and it
    -- is in the seed so that any code reading `origin` is exercised by the
    -- fixture rather than first meeting a non-'document' value in production.
    ('66666666-0000-4000-8000-000000000007',
     '11111111-1111-4111-8111-111111111111',
     null,
     'A1',
     'Led the on-call rotation for the checkout service for six months.',
     'attested',
     '{"employers":["Kavi Labs"],"metrics":["six months"]}'::jsonb,
     '{"source":"chat","session":"seed","confirmed":true}'::jsonb)
on conflict (id) do nothing;

-- --------------------------------------------------------------------------
-- The job
-- --------------------------------------------------------------------------
insert into jobs (id, user_id, source_url, jd_text, jd_source, company, title, spec_json, sha256)
values (
    '33333333-3333-4333-8333-333333333333',
    '11111111-1111-4111-8111-111111111111',
    'https://boards.example.com/northwind/senior-backend-engineer',
    $jd$Senior Backend Engineer — Northwind Analytics (Remote, India)

We are looking for a senior backend engineer to own the data platform behind
our customer analytics product.

What you will do
- Design and operate multi-tenant Postgres schemas serving thousands of
  customer workspaces.
- Build and maintain Python services (FastAPI) and TypeScript tooling.
- Own reliability: SLOs, on-call, incident review.

Requirements
- 4+ years of backend engineering experience.
- Strong SQL and PostgreSQL, including performance tuning and row level
  security.
- Python, ideally FastAPI. TypeScript a plus.
- Experience with AWS and infrastructure as code (Terraform).
- Experience with data pipelines (Airflow or similar) preferred.

Nice to have
- Kubernetes.
- Experience with analytics or BI products.$jd$,
    'greenhouse',
    'Northwind Analytics',
    'Senior Backend Engineer',
    '{"company":"Northwind Analytics","title":"Senior Backend Engineer",
      "location":"Remote, India","work_mode":"remote","employment_type":"full_time",
      "experience_years":{"min":4.0,"max":0.0,"raw":"4+ years"},
      "requirements":[
        {"term":"PostgreSQL","category":"database","importance":"required",
         "evidence":"Strong SQL and PostgreSQL, including performance tuning"},
        {"term":"row level security","category":"security","importance":"required",
         "evidence":"including performance tuning and row level security"},
        {"term":"Python","category":"language","importance":"required",
         "evidence":"Python, ideally FastAPI"},
        {"term":"FastAPI","category":"framework","importance":"preferred",
         "evidence":"Python, ideally FastAPI"},
        {"term":"TypeScript","category":"language","importance":"preferred",
         "evidence":"TypeScript a plus"},
        {"term":"AWS","category":"cloud_devops","importance":"required",
         "evidence":"Experience with AWS and infrastructure as code"},
        {"term":"Terraform","category":"cloud_devops","importance":"required",
         "evidence":"infrastructure as code (Terraform)"},
        {"term":"Airflow","category":"tooling","importance":"preferred",
         "evidence":"data pipelines (Airflow or similar) preferred"},
        {"term":"Kubernetes","category":"cloud_devops","importance":"preferred",
         "evidence":"Nice to have: Kubernetes"}],
      "responsibilities":[
        "Design and operate multi-tenant Postgres schemas",
        "Build and maintain Python services (FastAPI) and TypeScript tooling",
        "Own reliability: SLOs, on-call, incident review"],
      "keywords":[
        {"term":"PostgreSQL","variants":["Postgres","psql"],"weight":5},
        {"term":"Python","variants":[],"weight":5},
        {"term":"FastAPI","variants":[],"weight":4},
        {"term":"TypeScript","variants":["TS"],"weight":3},
        {"term":"Terraform","variants":["IaC"],"weight":4},
        {"term":"Airflow","variants":[],"weight":3},
        {"term":"Kubernetes","variants":["k8s"],"weight":2}],
      "implicit_requirements":[
        {"requirement":"Comfort with production on-call",
         "rationale":"Own reliability: SLOs, on-call, incident review"}],
      "compensation":"",
      "extraction_confidence":"high","extraction_notes":""}'::jsonb,
    'seedsha256000000000000000000000000000000000000000000000000000002'
)
on conflict (id) do nothing;

-- --------------------------------------------------------------------------
-- The resume and its first version
-- --------------------------------------------------------------------------
-- current_version_id is deliberately left null here: the trigger from 0005
-- sets it when the version below is inserted. Setting it by hand in the seed
-- would hide a broken trigger, and the seed is the first thing that would have
-- caught it.
insert into resumes (id, user_id, title, template_id, job_id, schema_version, status)
values (
    '44444444-4444-4444-8444-444444444444',
    '11111111-1111-4111-8111-111111111111',
    'Northwind Analytics — Senior Backend Engineer',
    'classic',
    '33333333-3333-4333-8333-333333333333',
    1,
    'draft'
)
on conflict (id) do nothing;

-- doc_json is models.TailoredResume with the contact block from ResumeFacts
-- folded in, so a renderer needs nothing else. Every bullet carries
-- source_ids pointing at real fact_keys above — the truth guard runs against
-- this fixture in CI, so an invented id here would fail the build.
insert into resume_versions (id, user_id, resume_id, parent_id, doc_json, created_by)
values (
    '55555555-5555-4555-8555-555555555555',
    '11111111-1111-4111-8111-111111111111',
    '44444444-4444-4444-8444-444444444444',
    null,
    '{
      "contact":{"name":"Priya Nair","email":"priya.nair@example.com",
        "phone":"+91 98250 11111","location":"Ahmedabad, India",
        "links":[{"label":"GitHub","url":"https://github.com/priyanair"},
                 {"label":"LinkedIn","url":"https://linkedin.com/in/priyanair"}]},
      "headline":"Full Stack Engineer",
      "summary":{
        "text":"Backend-leaning full stack engineer with 3 years on multi-tenant Postgres and Python services, including row-level-security design for a 120-merchant dashboard.",
        "source_ids":["E1","E1.B2","E2.B1"]},
      "skills":[
        {"category":"Languages","items":["Python","TypeScript","SQL"],"source_ids":["S1"]},
        {"category":"Data","items":["PostgreSQL","Redis","Airflow"],"source_ids":["S1","E1.B2"]},
        {"category":"Cloud & DevOps","items":["AWS","Terraform","Docker"],"source_ids":["C1"]}],
      "experience":[
        {"source_id":"E1","company":"Kavi Labs","title":"Senior Software Engineer",
         "location":"Ahmedabad, India","start_date":"Mar 2023","end_date":"Present",
         "bullets":[
           {"text":"Designed the Postgres schema and row-level-security policies behind a multi-tenant merchant dashboard used by 120 merchants.",
            "source_ids":["E1.B2"],"keywords":["PostgreSQL","row level security"]},
           {"text":"Rebuilt the order-processing service in TypeScript and Node.js, cutting p95 checkout latency from 1.8s to 640ms for 40,000 daily orders.",
            "source_ids":["E1.B1"],"keywords":["TypeScript"]}]},
        {"source_id":"E2","company":"Trellis Systems","title":"Software Engineer",
         "location":"Pune, India","start_date":"Jul 2021","end_date":"Feb 2023",
         "bullets":[
           {"text":"Built 30+ REST endpoints in Python and FastAPI serving an internal logistics platform with 2,400 weekly active users.",
            "source_ids":["E2.B1"],"keywords":["Python","FastAPI"]}]}],
      "projects":[],
      "education":[
        {"source_id":"ED1","institution":"Gujarat Technological University",
         "degree":"B.E. Computer Engineering","dates":"2017 - 2021"}],
      "certifications":[
        {"source_id":"C1","text":"AWS Certified Solutions Architect - Associate, 2024"}],
      "other_sections":[],
      "section_order":["summary","skills","experience","education","certifications"],
      "rewrite_notes":[
        "Promoted the Postgres and RLS bullet above the latency bullet: the JD names row level security as a hard requirement.",
        "Kubernetes is absent from the resume and was not added. Reported as a gap instead."]
    }'::jsonb,
    'ai_tailor'
)
on conflict (id) do nothing;

-- --------------------------------------------------------------------------
-- The analysis joining resume to job
-- --------------------------------------------------------------------------
insert into resume_jobs (id, user_id, resume_id, job_id, gaps_json, report_json, truth_json, strategy_json)
values (
    '77777777-7777-4777-8777-777777777777',
    '11111111-1111-4111-8111-111111111111',
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    '{"strong_matches":[
        {"jd_term":"PostgreSQL","source_ids":["E1.B2","S1"],"note":"Schema design plus RLS."},
        {"jd_term":"Python","source_ids":["E2.B1","S1"],"note":""},
        {"jd_term":"FastAPI","source_ids":["E2.B1"],"note":""}],
      "partial_matches":[
        {"jd_term":"AWS","source_ids":["C1"],"note":"Certification only; no AWS work described."}],
      "transferable":[
        {"jd_term":"Airflow","source_ids":["E2.B1"],"note":"Batch migration to Airflow at Trellis."}],
      "missing":[
        {"jd_term":"Kubernetes","severity":"minor","note":"Nice-to-have only."},
        {"jd_term":"Terraform","severity":"significant","note":"Listed as a skill, never evidenced."}],
      "missing_keywords":["Kubernetes"],
      "recoverable_keywords":["Airflow","Terraform"],
      "emphasize":[{"source_id":"E1.B2","reason":"Directly names row level security."}],
      "deemphasize":[{"source_id":"P1","reason":"Open-source library is off-target for this JD."}],
      "recruiter_concerns":["3 years against a stated 4+ requirement."],
      "ats_rejection_risks":["Kubernetes absent; some filters treat nice-to-haves as required."]}'::jsonb,
    '{"overall":78.5,
      "sub_scores":{"keyword_match":81.0,"skills_coverage":76.0,
        "section_completeness":100.0,"experience_match":70.0,
        "evidence_density":72.0,"specificity":80.0,
        "relevance_gate":1.0,"penalty":0.0},
      "matched_keywords":["PostgreSQL","Python","FastAPI","TypeScript","AWS"],
      "missing_keywords":["Kubernetes"],
      "recoverable_keywords":["Airflow","Terraform"],
      "recommendations":[
        "Put Airflow back into an experience bullet; it is in the original resume but not the tailored one.",
        "Evidence Terraform with a concrete change, or drop it from the skills list."]}'::jsonb,
    '{"passed":true,"error_count":0,"warning_count":0,"violations":[]}'::jsonb,
    '{"should_apply":"yes_with_caveats",
      "fit_estimate":"Strong on the data platform half, thin on infrastructure as code.",
      "biggest_strength":"Multi-tenant Postgres with row-level security, which is the JD''s hard requirement.",
      "biggest_gap":"No evidenced Terraform or Kubernetes work.",
      "interview_emphasis":["RLS design trade-offs","The p95 latency rebuild"],
      "cover_letter_worthwhile":true,
      "cover_letter_rationale":"A short note explaining the 3-vs-4 years gap is worth sending.",
      "outreach_angle":"Lead with the 120-merchant multi-tenant dashboard.",
      "top_improvements":["Evidence Terraform","Restore Airflow to a bullet"]}'::jsonb
)
on conflict (id) do nothing;

-- --------------------------------------------------------------------------
-- One proposed patch, left undecided
-- --------------------------------------------------------------------------
-- Undecided on purpose: the accept/decline flow is the one with a state
-- machine behind it, and an E2E test needs something in 'proposed' to drive it.
insert into patches (id, user_id, resume_id, base_version_id, ops_json, origin, status, rationale, score_delta)
values (
    '88888888-8888-4888-8888-888888888888',
    '11111111-1111-4111-8111-111111111111',
    '44444444-4444-4444-8444-444444444444',
    '55555555-5555-4555-8555-555555555555',
    '[{"op":"add","path":"/experience/1/bullets/-",
       "value":{"text":"Migrated batch reporting from cron to Airflow, cutting the nightly window from 4 hours to 50 minutes.",
                "source_ids":["E2.B2"],"keywords":["Airflow"]}}]'::jsonb,
    'ai_tailor',
    'proposed',
    'Airflow is named in the JD and present in the original resume but missing from the tailored document. This is a recoverable keyword, not a new claim.',
    3.5
)
on conflict (id) do nothing;

-- --------------------------------------------------------------------------
-- A chat session with two messages
-- --------------------------------------------------------------------------
insert into chat_sessions (id, user_id, resume_id, kind)
values (
    '99999999-9999-4999-8999-999999999999',
    '11111111-1111-4111-8111-111111111111',
    '44444444-4444-4444-8444-444444444444',
    'edit'
)
on conflict (id) do nothing;

insert into chat_messages (id, user_id, session_id, role, content, tokens_in, tokens_out, cost_usd)
values
    ('aaaaaaaa-0000-4000-8000-000000000001',
     '11111111-1111-4111-8111-111111111111',
     '99999999-9999-4999-8999-999999999999',
     'user',
     'Can you make the summary shorter?',
     0, 0, 0),
    ('aaaaaaaa-0000-4000-8000-000000000002',
     '11111111-1111-4111-8111-111111111111',
     '99999999-9999-4999-8999-999999999999',
     'assistant',
     'Proposed a two-line summary that keeps the row-level-security detail, since the job description names it as a requirement. See patch 8888…',
     1840, 260, 0.011)
on conflict (id) do nothing;

-- --------------------------------------------------------------------------
-- Observability rows
-- --------------------------------------------------------------------------
insert into step_traces (id, user_id, resume_id, step, model, tokens_in, tokens_out, ms, cost_usd, ok, cache_hit)
values
    ('bbbbbbbb-0000-4000-8000-000000000001',
     '11111111-1111-4111-8111-111111111111', null,
     'jd_extract', 'seed-model', 3120, 890, 4210, 0.0234, true, false),
    ('bbbbbbbb-0000-4000-8000-000000000002',
     '11111111-1111-4111-8111-111111111111',
     '44444444-4444-4444-8444-444444444444',
     'tailor', 'seed-model', 7640, 2210, 18730, 0.0912, true, false),
    ('bbbbbbbb-0000-4000-8000-000000000003',
     '11111111-1111-4111-8111-111111111111',
     '44444444-4444-4444-8444-444444444444',
     'truth_guard', 'seed-model', 4100, 320, 3020, 0.0170, true, true)
on conflict (id) do nothing;

-- --------------------------------------------------------------------------
-- One global cache entry
-- --------------------------------------------------------------------------
-- A JD extraction, which is the only category the rule in 0001 allows to be
-- cached globally: the input is an employer's public posting, not the user's
-- data. The key here is a literal for determinism; in production it is
-- sha256(step | prompt_version | model | input).
insert into step_cache (cache_key, step, output_json, model, prompt_version, hits)
values (
    'seedcachekey0000000000000000000000000000000000000000000000000001',
    'jd_extract',
    '{"company":"Northwind Analytics","title":"Senior Backend Engineer","cached":true}'::jsonb,
    'seed-model',
    'v1',
    1
)
on conflict (cache_key) do nothing;
