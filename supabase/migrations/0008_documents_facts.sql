-- ---------------------------------------------------------------------------
-- 0008 — keep the extraction beside the document it came from
-- ---------------------------------------------------------------------------
--
-- WHY THIS IS NOT REDUNDANT WITH THE facts TABLE
--
-- It stores the same information twice and that is deliberate, because the
-- two copies answer different questions and have different lifetimes.
--
--   facts (the table)   is the ledger. One row per citable claim, each with
--                       an origin, evidence, and the ability to be
--                       superseded when the candidate corrects themselves.
--                       It is append-only and it grows: a fact the user
--                       attests in conversation lands here and never came
--                       from any document. It answers "may this line cite
--                       that?" and "who said so, and when".
--
--   documents.facts_json is the extractor's output, unchanged. One nested
--                       object, exactly as the model returned it. It answers
--                       "what shape was this resume in", which the ledger
--                       cannot: flattening a role into a row loses the
--                       nesting that says which bullets belong to which
--                       employer, and no amount of parsing `fact_key` back
--                       out reconstructs it faithfully.
--
-- The concrete need: opening the editor on a freshly uploaded resume has to
-- render the candidate's own document, in their chosen template, before
-- anything has been tailored. That means rebuilding a full document from the
-- extraction, and rebuilding it from flattened rows would silently reorder
-- and re-parent bullets. A user who uploads a resume and is shown something
-- subtly rearranged has been lied to on the first screen.
--
-- It also makes a second resume from the same upload free. Extraction is the
-- expensive step and its input has not changed.
--
-- NOT A CACHE THAT MAY BE WRONG. If the extraction contract changes, this is
-- stale in the same way the ledger is stale, and both are rebuilt from
-- raw_text together. It is not load-bearing for verification: the truth
-- guard reads raw_text and the ledger, never this.

alter table documents
    add column if not exists facts_json jsonb;

comment on column documents.facts_json is
    'The structured extraction, exactly as the model returned it. Used to '
    'rebuild the candidate''s own document for the editor before anything is '
    'tailored, which the flattened facts table cannot do without losing which '
    'bullets belong to which role. Null until parsed, and null forever if '
    'parsing failed.';
