CREATE TABLE labels (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  CONSTRAINT labels_name_len CHECK (char_length(name) BETWEEN 1 AND 40)
);

CREATE UNIQUE INDEX labels_project_lower_name_idx ON labels (project_id, lower(name));

CREATE TABLE issue_labels (
  issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (issue_id, label_id)
);

CREATE INDEX issue_labels_label_idx ON issue_labels (label_id);
