CREATE TABLE issue_links (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('relates', 'blocks', 'duplicates')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (source_id <> target_id)
);

CREATE UNIQUE INDEX issue_links_unique ON issue_links (source_id, target_id, type);
CREATE INDEX issue_links_target_idx ON issue_links (target_id);
