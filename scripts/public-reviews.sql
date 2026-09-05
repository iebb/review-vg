WITH app_states AS (
  SELECT app_store_id,
         MAX(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS has_approved,
         MAX(julianday(COALESCE(submitted_at, latest_event_at))) AS latest_submission_at
    FROM reviews
   WHERE app_store_id IS NOT NULL
   GROUP BY app_store_id
)
SELECT r.submission_id,
       r.app_name,
       r.platform,
       r.app_store_id,
       r.app_version,
       r.status,
       r.submitted_at,
       r.latest_event_at,
       r.guideline_code,
       r.guideline_title,
       states.has_approved,
       metadata.app_icon_url,
       metadata.app_category,
       CASE
         WHEN julianday(COALESCE(r.submitted_at, r.latest_event_at)) >=
              julianday('now', '-6 months')
          AND (
            states.has_approved = 1 OR
            states.latest_submission_at >= julianday('now', '-60 days')
          )
         THEN 1
         ELSE 0
       END AS in_timeline
  FROM reviews AS r
  JOIN app_states AS states ON states.app_store_id = r.app_store_id
  LEFT JOIN app_metadata AS metadata ON metadata.app_store_id = r.app_store_id
 ORDER BY r.latest_event_at ASC;
