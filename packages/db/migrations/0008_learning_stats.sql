-- 0008_learning_stats.sql (spec 07, feature C): the admin learning funnel counts active learners per
-- day (GET /admin-api/stats/learning, activeByDay) over a date window of daily_stats. Its primary key
-- starts with user_id, so that range needed a full scan; this covering index answers it directly.
CREATE INDEX ix_daily_date ON daily_stats(local_date, user_id);
