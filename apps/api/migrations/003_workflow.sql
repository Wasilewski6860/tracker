DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'statuses'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%category%'
  LOOP
    EXECUTE format('ALTER TABLE statuses DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE statuses
  ADD CONSTRAINT statuses_category_check
  CHECK (category IN ('backlog', 'todo', 'in_progress', 'review', 'done'));

DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'issues'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%type%'
  LOOP
    EXECUTE format('ALTER TABLE issues DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE issues
  ADD CONSTRAINT issues_type_check
  CHECK (type IN ('epic', 'story', 'task', 'bug', 'subtask'));

ALTER TABLE issues ADD COLUMN due_on DATE;
ALTER TABLE issues ADD COLUMN parent_id UUID REFERENCES issues(id) ON DELETE SET NULL;
CREATE INDEX issues_parent_idx ON issues (parent_id);

UPDATE statuses SET category = 'todo', position = 1 WHERE name = 'К выполнению';
UPDATE statuses SET category = 'in_progress', position = 2 WHERE name = 'В работе';
UPDATE statuses SET category = 'done', position = 4 WHERE name = 'Готово';

INSERT INTO statuses (id, project_id, name, category, position)
SELECT gen_random_uuid(), p.id, flow.name, flow.category, flow.position
FROM projects p
CROSS JOIN (
  VALUES
    ('Бэклог', 'backlog', 0),
    ('К выполнению', 'todo', 1),
    ('В работе', 'in_progress', 2),
    ('На проверке', 'review', 3),
    ('Готово', 'done', 4)
) AS flow(name, category, position)
WHERE NOT EXISTS (
  SELECT 1 FROM statuses s WHERE s.project_id = p.id AND s.name = flow.name
);

DELETE FROM transitions;

INSERT INTO transitions (id, project_id, from_status_id, to_status_id)
SELECT gen_random_uuid(), src.project_id, src.id, dst.id
FROM (
  VALUES
    ('Бэклог', 'К выполнению'),
    ('К выполнению', 'Бэклог'),
    ('К выполнению', 'В работе'),
    ('В работе', 'К выполнению'),
    ('В работе', 'На проверке'),
    ('На проверке', 'В работе'),
    ('На проверке', 'Готово'),
    ('Готово', 'На проверке')
) AS edge(from_name, to_name)
JOIN statuses src ON src.name = edge.from_name
JOIN statuses dst ON dst.project_id = src.project_id AND dst.name = edge.to_name;
