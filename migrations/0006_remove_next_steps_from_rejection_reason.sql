UPDATE reviews
SET rejection_reason =
  CASE
    WHEN issue_description IS NOT NULL AND trim(issue_description) <> '' THEN
      CASE
        WHEN guideline_code IS NOT NULL AND trim(guideline_code) <> '' THEN
          'Guideline ' || trim(guideline_code) ||
          CASE
            WHEN guideline_title IS NOT NULL AND trim(guideline_title) <> ''
              THEN ' - ' || trim(guideline_title)
            ELSE ''
          END || char(10) || char(10)
        ELSE ''
      END ||
      'Issue Description' || char(10) || trim(issue_description)
    WHEN guideline_code IS NOT NULL AND trim(guideline_code) <> '' THEN
      'Guideline ' || trim(guideline_code) ||
      CASE
        WHEN guideline_title IS NOT NULL AND trim(guideline_title) <> ''
          THEN ' - ' || trim(guideline_title)
        ELSE ''
      END
    ELSE rejection_reason
  END
WHERE status = 'issue';
