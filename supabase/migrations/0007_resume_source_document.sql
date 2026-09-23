-- ---------------------------------------------------------------------------
-- 0007 — a resume remembers the upload it came from
-- ---------------------------------------------------------------------------
--
-- THE GAP THIS CLOSES
--
-- The onboarding flow is: upload a file, which inserts a `documents` row and
-- carries its id forward as `?document=<uuid>`; then choose a template, which
-- inserts a `resumes` row. Nothing joined those two. The query parameter was
-- read to build the next URL and then dropped, and `resumes` had nowhere to
-- put it, so the connection existed only in the address bar and died with the
-- first reload.
--
-- That is not a cosmetic loss. The truth guard checks every rewritten line
-- against the text of the resume the candidate actually uploaded, and
-- `documents.raw_text` is where that text lives. A resume that cannot name its
-- source document cannot be verified against anything, which means the one
-- feature this product exists for silently stops working. It would have
-- presented as "the guard passes everything", which is the worst possible
-- shape for that bug: it looks like success.
--
-- WHY NOT GO THROUGH facts
--
-- `facts.document_id` exists, so the link could be inferred by joining facts
-- to the resume. It cannot: facts are extracted per document and are shared
-- across every resume tailored from that document, so the join is one-to-many
-- in the wrong direction, and a resume with no facts extracted yet — which is
-- every resume at the moment it is created — would have no answer at all.
--
-- ON DELETE SET NULL, NOT CASCADE
--
-- Deleting an upload is retracting a file, not retracting the resumes already
-- written from it and sent to employers. This matches how 0004 treats
-- `facts.document_id` for the same reason. The consequence is that the guard
-- loses its corpus for that resume, which the application must surface rather
-- than treat as "nothing to check".

alter table resumes
    add column if not exists source_document_id uuid;

comment on column resumes.source_document_id is
    'The upload this resume was created from. Null for a resume started from '
    'scratch, or one whose source document was deleted. The truth guard reads '
    'documents.raw_text through this, so a null here means the guard has no '
    'corpus and the application must say so rather than report a pass.';

-- Composite, for the same reason every other child key in 0004 is composite:
-- row-level security checks the row being written, not the row it points at.
-- With a single-column reference, one tenant could attach another tenant's
-- document to their own resume and every policy would still pass.
alter table resumes
    drop constraint if exists resumes_source_document_fkey;

alter table resumes
    add constraint resumes_source_document_fkey
    foreign key (source_document_id, user_id)
    references documents (id, user_id)
    on delete set null (source_document_id);

-- The editor's first query is "which document backs this resume", and the
-- reverse, "which resumes came from this upload", is what makes deleting one
-- answerable. Partial, because a scratch resume has nothing to look up.
create index if not exists resumes_source_document
    on resumes (source_document_id)
    where source_document_id is not null;
