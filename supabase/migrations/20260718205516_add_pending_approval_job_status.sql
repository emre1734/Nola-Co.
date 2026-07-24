/*
# Add pending_approval to job_status enum

1. Purpose
   Introduces a single new job_status value: `pending_approval`.
   This represents the state where the partner has finished the wash
   (both before and after photos uploaded) and has sent the job to the
   customer for approval. The job is NOT completed — it waits for the
   customer to approve before transitioning to `completed`.

2. Changes
   - ALTER TYPE job_status ADD VALUE 'pending_approval'
     Placed AFTER 'started' and BEFORE 'completed' in the sort order,
     reflecting the real lifecycle: on_the_way → arrived → started →
     pending_approval → completed (or cancelled at any point).

3. What this does NOT change
   - No new tables, columns, or RLS policies.
   - No changes to booking_status.
   - Does not set completed_at or mark anything completed.
   - Existing statuses (on_the_way, arrived, started, completed,
     cancelled) are untouched.

4. Important notes
   - This is a single, additive enum value — the only schema change
     approved for this sprint.
   - `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block;
     it is executed as a standalone statement.
   - The new value is safe to add even if rows already reference other
     statuses — existing data is unaffected.
*/

ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'pending_approval' BEFORE 'completed';
