/*
# One-Time Cleanup of Stale provider_live_locations Rows

## Context
The previous audit confirmed that all 10 existing provider_live_locations
rows belong to completed jobs, are older than 24 hours, and are not required
by any current product feature. Customer tracking and provider writes are
now authorized ONLY while job.status = 'on_the_way'.

## Predicate
Delete rows satisfying BOTH:
1. exact linked job status is NOT on_the_way
2. updated_at older than 10 minutes (defense-in-depth age condition)

The 10-minute age condition is retained as defense in depth for this
historical one-time cleanup, even though current RLS already prevents
location writes after on_the_way ends.

## Safety
Pre-migration check confirmed:
- 10 total rows
- 0 rows with job.status = on_the_way
- 10 rows with job.status != on_the_way
- 10 rows older than 10 minutes
- 10 rows matching the delete predicate
- 0 on_the_way rows that would match the age condition

No active tracking row would be deleted.

## What Does NOT Change
- No RLS, policies, or grants modified
- No triggers or cron jobs created
- No schema, constraints, or foreign keys changed
- No jobs, bookings, or provider_profiles rows modified
- No frontend or GPS code changes
*/

DELETE FROM public.provider_live_locations pll
WHERE pll.updated_at < now() - interval '10 minutes'
  AND EXISTS (
    SELECT 1
    FROM public.jobs j
    WHERE j.id = pll.job_id
      AND j.status <> 'on_the_way'::public.job_status
  );
