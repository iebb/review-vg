CREATE TRIGGER reviews_require_issue_reason_insert
BEFORE INSERT ON reviews
WHEN NEW.status = 'issue'
  AND (NEW.rejection_reason IS NULL OR trim(NEW.rejection_reason) = '')
BEGIN
  SELECT RAISE(ABORT, 'issue reviews require rejection_reason');
END;

CREATE TRIGGER reviews_require_issue_reason_update
BEFORE UPDATE ON reviews
WHEN NEW.status = 'issue'
  AND (NEW.rejection_reason IS NULL OR trim(NEW.rejection_reason) = '')
BEGIN
  SELECT RAISE(ABORT, 'issue reviews require rejection_reason');
END;
