import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ============================================================
// Helper: send a push notification via the push-notifications
// edge function. Fire-and-forget — notification failure must
// never block the business action.
// ============================================================
async function sendPushNotification(
  supabaseUrl: string,
  serviceRoleKey: string,
  targetUserId: string,
  notificationType: string,
  screen: string | null,
  bookingId: string | null,
  params: Record<string, string> = {},
): Promise<void> {
  try {
    await fetch(`${supabaseUrl}/functions/v1/push-notifications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        action: "send_notification",
        target_user_id: targetUserId,
        notification_type: notificationType,
        screen,
        booking_id: bookingId,
        params,
      }),
    });
  } catch (err) {
    console.error("Push notification failed:", err);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const userId = userData.user.id;

    const body = await req.json();
    const { booking_id, action } = body as { booking_id?: string; action: string };

    if (!action) {
      return new Response(
        JSON.stringify({ error: "action is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ============================================================
    // Customer-side actions. These run BEFORE the provider-profile
    // lookup because the caller is the customer, not a provider.
    // ============================================================

    // ============================================================
    // get_customer_approval: return the customer's pending-approval
    // (or just-completed) job with booking, vehicle, service, and
    // provider name. Routed through the edge function because the
    // jobs table has RLS enabled with no client-read policies.
    // ============================================================
    // ============================================================
    // list_customer_approvals: return ALL of the customer's jobs in
    // pending_approval, with booking, vehicle, service, and provider
    // name. Used by the in-app Approval Center and the HomeScreen
    // pending-approvals count badge.
    // ============================================================
    if (action === "list_customer_approvals") {
      const { data: approvalJobs, error: listError } = await supabase
        .from("jobs")
        .select(
          "id, booking_id, status, before_photo_url, after_photo_url, completed_at, updated_at, provider_id, " +
          "bookings!inner(id, estimated_price, customer_id, services(name), vehicles(brand, model, plate, color))",
        )
        .eq("customer_id", userId)
        .eq("status", "pending_approval")
        .order("updated_at", { ascending: false });

      if (listError) {
        return new Response(
          JSON.stringify({ error: "Failed to load approvals" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const jobs = (approvalJobs ?? []) as Array<{
        id: string;
        booking_id: string;
        status: string;
        before_photo_url: string | null;
        after_photo_url: string | null;
        completed_at: string | null;
        updated_at: string | null;
        provider_id: string | null;
        bookings: {
          id: string;
          estimated_price: number | null;
          customer_id: string;
          services?: { name: string } | null;
          vehicles?: { brand: string; model: string; plate: string; color: string | null } | null;
        } | null;
      }>;

      // Authorization: only keep jobs whose booking belongs to this customer.
      const ownJobs = jobs.filter(j => j.bookings?.customer_id === userId);

      // Batch-resolve provider display names (provider_profiles -> profiles).
      const providerIds = Array.from(new Set(ownJobs.map(j => j.provider_id).filter(Boolean))) as string[];
      const providerNameMap: Record<string, string | null> = {};
      if (providerIds.length > 0) {
        const { data: pps } = await supabase
          .from("provider_profiles")
          .select("id, profile_id")
          .in("id", providerIds);
        const profileIds = (pps ?? []).map(pp => pp.profile_id).filter(Boolean) as string[];
        const profileMap: Record<string, string> = {};
        if (profileIds.length > 0) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", profileIds);
          for (const p of profs ?? []) profileMap[p.id] = p.full_name;
        }
        for (const pp of pps ?? []) providerNameMap[pp.id] = profileMap[pp.profile_id] ?? null;
      }

      // Batch-resolve whether each job already has a support request.
      const ownJobIds = ownJobs.map(j => j.id);
      const supportByJob: Record<string, { id: string; status: string; created_at: string } | null> = {};
      if (ownJobIds.length > 0) {
        const { data: supportRows } = await supabase
          .from("support_requests")
          .select("id, job_id, status, created_at")
          .in("job_id", ownJobIds)
          .order("created_at", { ascending: false });
        for (const sr of supportRows ?? []) {
          // Only keep the most recent per job (rows are ordered desc).
          if (!supportByJob[sr.job_id]) supportByJob[sr.job_id] = sr;
        }
      }

      const result = ownJobs.map(j => {
        const sr = supportByJob[j.id] ?? null;
        return {
          id: j.id,
          booking_id: j.booking_id,
          status: j.status,
          before_photo_url: j.before_photo_url,
          after_photo_url: j.after_photo_url,
          completed_at: j.completed_at,
          updated_at: j.updated_at,
          estimated_price: j.bookings?.estimated_price ?? null,
          service_name: j.bookings?.services?.name ?? null,
          vehicle: j.bookings?.vehicles ?? null,
          provider_name: j.provider_id ? (providerNameMap[j.provider_id] ?? null) : null,
          has_support_request: !!sr,
          support_request: sr ? { id: sr.id, status: sr.status, created_at: sr.created_at } : null,
        };
      });

      return new Response(
        JSON.stringify({ success: true, jobs: result, count: result.length }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "get_customer_approval") {
      const { data: approvalJob, error: approvalJobError } = await supabase
        .from("jobs")
        .select(
          "id, booking_id, status, before_photo_url, after_photo_url, completed_at, updated_at, provider_id, " +
          "bookings!inner(id, estimated_price, customer_id, services(name), vehicles(brand, model, plate, color))",
        )
        .eq("customer_id", userId)
        .in("status", ["pending_approval", "completed"])
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (approvalJobError) {
        return new Response(
          JSON.stringify({ error: "Failed to load approval job" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (!approvalJob) {
        return new Response(
          JSON.stringify({ success: true, job: null }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const booking = approvalJob.bookings as {
        customer_id: string;
        estimated_price: number | null;
        services?: { name: string } | null;
        vehicles?: { brand: string; model: string; plate: string; color: string | null } | null;
      } | null;

      if (booking?.customer_id !== userId) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Resolve provider display name via provider_profiles -> profiles.
      let providerName: string | null = null;
      if (approvalJob.provider_id) {
        const { data: pp } = await supabase
          .from("provider_profiles")
          .select("profile_id")
          .eq("id", approvalJob.provider_id)
          .maybeSingle();
        if (pp?.profile_id) {
          const { data: prof } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("id", pp.profile_id)
            .maybeSingle();
          providerName = prof?.full_name ?? null;
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          job: {
            id: approvalJob.id,
            booking_id: approvalJob.booking_id,
            status: approvalJob.status,
            before_photo_url: approvalJob.before_photo_url,
            after_photo_url: approvalJob.after_photo_url,
            completed_at: approvalJob.completed_at,
            updated_at: approvalJob.updated_at,
            estimated_price: booking.estimated_price,
            service_name: booking.services?.name ?? null,
            vehicle: booking.vehicles ?? null,
            provider_name: providerName,
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ============================================================
    // approve_job: customer approves the completed wash. Sets
    // job.status to "completed" and completed_at to now. Does NOT
    // touch booking.status (booking_status has no "completed" value).
    // ============================================================
    if (action === "approve_job") {
      if (!booking_id) {
        return new Response(
          JSON.stringify({ error: "booking_id is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const { data: approveJob, error: approveJobError } = await supabase
        .from("jobs")
        .select("id, status, customer_id, bookings!inner(customer_id)")
        .eq("booking_id", booking_id)
        .maybeSingle();

      if (approveJobError || !approveJob) {
        return new Response(
          JSON.stringify({ error: "Job not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const booking = approveJob.bookings as { customer_id: string } | null;
      if (booking?.customer_id !== userId) {
        return new Response(
          JSON.stringify({ error: "This booking does not belong to you" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (approveJob.status !== "pending_approval") {
        return new Response(
          JSON.stringify({ error: `Job status is ${approveJob.status}, expected pending_approval` }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const completedAt = new Date().toISOString();
      const { error: approveUpdateError } = await supabase
        .from("jobs")
        .update({ status: "completed", completed_at: completedAt })
        .eq("id", approveJob.id);

      if (approveUpdateError) {
        return new Response(
          JSON.stringify({
            error: "Failed to approve job",
            details: approveUpdateError.message,
            code: approveUpdateError.code,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Re-fetch to confirm.
      const { data: confirmedJob, error: confirmError } = await supabase
        .from("jobs")
        .select("id, status, completed_at")
        .eq("id", approveJob.id)
        .maybeSingle();

      if (confirmError || !confirmedJob || confirmedJob.status !== "completed") {
        return new Response(
          JSON.stringify({ error: "Approval could not be verified" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Notify the assigned provider that the service was approved.
      // Fire-and-forget. Resolve provider's user id from provider_profiles.
      if (approveJob.provider_id) {
        const { data: ppRow } = await supabase
          .from("provider_profiles")
          .select("profile_id")
          .eq("id", approveJob.provider_id)
          .maybeSingle();
        if (ppRow?.profile_id) {
          sendPushNotification(
            supabaseUrl, serviceRoleKey,
            ppRow.profile_id, "service_approved", "providerDashboard", booking_id,
          );
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          job_id: approveJob.id,
          status: "completed",
          completed_at: confirmedJob.completed_at,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ============================================================
    // list_completed_jobs: returns the authenticated customer's
    // completed jobs for Booking History. Mirrors
    // list_customer_approvals but filters status = "completed".
    // ============================================================
    if (action === "list_completed_jobs") {
      const { data: completedJobs, error: completedError } = await supabase
        .from("jobs")
        .select(
          "id, booking_id, status, before_photo_url, after_photo_url, completed_at, updated_at, provider_id, " +
          "bookings!inner(id, estimated_price, customer_id, booking_date, booking_time, services(name), vehicles(brand, model, plate, color))",
        )
        .eq("customer_id", userId)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(50);

      if (completedError) {
        return new Response(
          JSON.stringify({ error: "Failed to load completed jobs" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const cJobs = (completedJobs ?? []) as Array<{
        id: string;
        booking_id: string;
        status: string;
        before_photo_url: string | null;
        after_photo_url: string | null;
        completed_at: string | null;
        updated_at: string | null;
        provider_id: string | null;
        bookings: {
          estimated_price: number | null;
          customer_id: string;
          booking_date: string | null;
          booking_time: string | null;
          services?: { name: string } | null;
          vehicles?: { brand: string; model: string; plate: string; color: string | null } | null;
        } | null;
      }>;

      const ownCJobs = cJobs.filter(j => j.bookings?.customer_id === userId);

      // Batch-resolve provider display names.
      const cProviderIds = Array.from(new Set(ownCJobs.map(j => j.provider_id).filter(Boolean))) as string[];
      const cProviderNameMap: Record<string, string | null> = {};
      if (cProviderIds.length > 0) {
        const { data: pps } = await supabase
          .from("provider_profiles")
          .select("id, profile_id")
          .in("id", cProviderIds);
        const profileIds = (pps ?? []).map(pp => pp.profile_id).filter(Boolean) as string[];
        const profileMap: Record<string, string> = {};
        if (profileIds.length > 0) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", profileIds);
          for (const p of profs ?? []) profileMap[p.id] = p.full_name;
        }
        for (const pp of pps ?? []) cProviderNameMap[pp.id] = profileMap[pp.profile_id] ?? null;
      }

      const cResult = ownCJobs.map(j => ({
        id: j.id,
        booking_id: j.booking_id,
        status: j.status,
        before_photo_url: j.before_photo_url,
        after_photo_url: j.after_photo_url,
        completed_at: j.completed_at,
        updated_at: j.updated_at,
        estimated_price: j.bookings?.estimated_price ?? null,
        booking_date: j.bookings?.booking_date ?? null,
        booking_time: j.bookings?.booking_time ?? null,
        service_name: j.bookings?.services?.name ?? null,
        vehicle: j.bookings?.vehicles ?? null,
        provider_name: j.provider_id ? (cProviderNameMap[j.provider_id] ?? null) : null,
      }));

      return new Response(
        JSON.stringify({ success: true, jobs: cResult, count: cResult.length }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ============================================================
    // submit_support_request: customer submits a problem report.
    // Creates a row in support_requests. Does NOT change job.status
    // (stays pending_approval) and does NOT touch booking.status.
    // Validates category, description length (20–1000), and that the
    // caller owns the booking. phone and photo_urls are optional.
    // ============================================================
    if (action === "submit_support_request") {
      if (!booking_id) {
        return new Response(
          JSON.stringify({ error: "booking_id is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const {
        category,
        description,
        phone,
        photo_urls,
      } = body as {
        category?: string;
        description?: string;
        phone?: string;
        photo_urls?: string[];
      };

      const ALLOWED_CATEGORIES = [
        "Vehicle was not cleaned properly",
        "New damage",
        "Missing item",
        "Wrong service",
        "Partner behaviour",
        "Other",
      ];

      if (!category || !ALLOWED_CATEGORIES.includes(category)) {
        return new Response(
          JSON.stringify({ error: "Please select a valid problem category." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const desc = (description ?? "").trim();
      if (desc.length < 20) {
        return new Response(
          JSON.stringify({ error: "Description must be at least 20 characters." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (desc.length > 1000) {
        return new Response(
          JSON.stringify({ error: "Description must be at most 1000 characters." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const photos = Array.isArray(photo_urls)
        ? photo_urls.filter((u): u is string => typeof u === "string" && u.length > 0).slice(0, 3)
        : [];

      const { data: problemJob, error: problemJobError } = await supabase
        .from("jobs")
        .select("id, status, customer_id, bookings!inner(customer_id)")
        .eq("booking_id", booking_id)
        .maybeSingle();

      if (problemJobError || !problemJob) {
        return new Response(
          JSON.stringify({ error: "Job not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const booking = problemJob.bookings as { customer_id: string } | null;
      if (booking?.customer_id !== userId) {
        return new Response(
          JSON.stringify({ error: "This booking does not belong to you" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (problemJob.status !== "pending_approval") {
        return new Response(
          JSON.stringify({ error: `Job status is ${problemJob.status}, expected pending_approval` }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Insert the support request. customer_id is filled by the DB
      // default (auth.uid()) and job_id by the resolved job.
      const { data: supportRow, error: supportError } = await supabase
        .from("support_requests")
        .insert({
          job_id: problemJob.id,
          category,
          description: desc,
          phone: phone?.trim() || null,
          photo_urls: photos.length > 0 ? photos : null,
        })
        .select("id, status, created_at")
        .maybeSingle();

      if (supportError || !supportRow) {
        return new Response(
          JSON.stringify({
            error: "Failed to submit support request",
            details: supportError?.message,
            code: supportError?.code,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Notify the assigned provider that a problem was reported.
      // Fire-and-forget. Resolve provider's user id from the job.
      if (problemJob.provider_id) {
        const { data: ppRow } = await supabase
          .from("provider_profiles")
          .select("profile_id")
          .eq("id", problemJob.provider_id)
          .maybeSingle();
        if (ppRow?.profile_id) {
          sendPushNotification(
            supabaseUrl, serviceRoleKey,
            ppRow.profile_id, "problem_reported", "providerDashboard", booking_id,
          );
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          support_request_id: supportRow.id,
          status: supportRow.status,
          created_at: supportRow.created_at,
          job_id: problemJob.id,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ============================================================
    // has_support_request: returns whether a support request already
    // exists for the given booking's job. Used by the UI to show the
    // "Support Request Submitted" state after a refresh.
    // ============================================================
    if (action === "has_support_request") {
      if (!booking_id) {
        return new Response(
          JSON.stringify({ error: "booking_id is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const { data: checkJob, error: checkJobError } = await supabase
        .from("jobs")
        .select("id, customer_id, bookings!inner(customer_id)")
        .eq("booking_id", booking_id)
        .maybeSingle();

      if (checkJobError || !checkJob) {
        return new Response(
          JSON.stringify({ error: "Job not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const booking = checkJob.bookings as { customer_id: string } | null;
      if (booking?.customer_id !== userId) {
        return new Response(
          JSON.stringify({ error: "This booking does not belong to you" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const { data: existing, error: existingError } = await supabase
        .from("support_requests")
        .select("id, status, created_at")
        .eq("job_id", checkJob.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingError) {
        return new Response(
          JSON.stringify({ error: "Failed to check support request" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          exists: !!existing,
          support_request: existing ?? null,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ============================================================
    // Provider-side actions below — resolve provider_profile first.
    // All provider actions require booking_id.
    // ============================================================

    if (!booking_id) {
      return new Response(
        JSON.stringify({ error: "booking_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resolve provider_profile id from auth user id — needed by all actions.
    const { data: providerProfile, error: providerError } = await supabase
      .from("provider_profiles")
      .select("id")
      .eq("profile_id", userId)
      .maybeSingle();

    if (providerError || !providerProfile) {
      return new Response(
        JSON.stringify({ error: "Provider profile not found" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ============================================================
    // get_state: return the current job row (including before_photo_url)
    // so the client can restore the before-photo step after a refresh.
    // Scoped to the authenticated provider's own job.
    // ============================================================
    if (action === "get_state") {
      const { data: jobRow, error: jobRowError } = await supabase
        .from("jobs")
        .select("id, status, provider_id, before_photo_url, after_photo_url, provider_closed_at")
        .eq("booking_id", booking_id)
        .maybeSingle();

      if (jobRowError) {
        return new Response(
          JSON.stringify({ error: "Failed to load job state" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (!jobRow) {
        return new Response(
          JSON.stringify({ error: "Job not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (jobRow.provider_id !== providerProfile.id) {
        return new Response(
          JSON.stringify({ error: "This job is not assigned to you" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          id: jobRow.id,
          status: jobRow.status,
          provider_id: jobRow.provider_id,
          before_photo_url: jobRow.before_photo_url,
          after_photo_url: jobRow.after_photo_url,
          provider_closed_at: jobRow.provider_closed_at,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ============================================================
    // close_job: provider acknowledges a customer-approved completed
    // job and clears it from their dashboard. Only allowed when the
    // job status is "completed" and the booking is still assigned to
    // this provider. Sets provider_closed_at to now. Does NOT change
    // job.status, booking.status, or any photo/approval/evidence data.
    // ============================================================
    if (action === "close_job") {
      const { data: closeJob, error: closeJobError } = await supabase
        .from("jobs")
        .select("id, status, provider_id, provider_closed_at")
        .eq("booking_id", booking_id)
        .maybeSingle();

      if (closeJobError || !closeJob) {
        return new Response(
          JSON.stringify({ error: "Job not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (closeJob.provider_id !== providerProfile.id) {
        return new Response(
          JSON.stringify({ error: "This job is not assigned to you" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (closeJob.status !== "completed") {
        return new Response(
          JSON.stringify({ error: `Job status is ${closeJob.status}, expected completed` }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      // Idempotent: if already closed, succeed without re-stamping.
      if (closeJob.provider_closed_at) {
        return new Response(
          JSON.stringify({ success: true, job_id: closeJob.id, provider_closed_at: closeJob.provider_closed_at }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const closedAt = new Date().toISOString();
      const { error: closeUpdateError } = await supabase
        .from("jobs")
        .update({ provider_closed_at: closedAt })
        .eq("id", closeJob.id);

      if (closeUpdateError) {
        return new Response(
          JSON.stringify({
            error: "Failed to close job",
            details: closeUpdateError.message,
            code: closeUpdateError.code,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Re-fetch to confirm.
      const { data: confirmedClosed, error: confirmCloseError } = await supabase
        .from("jobs")
        .select("id, provider_closed_at")
        .eq("id", closeJob.id)
        .maybeSingle();

      if (confirmCloseError || !confirmedClosed || !confirmedClosed.provider_closed_at) {
        return new Response(
          JSON.stringify({ error: "Close could not be verified" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          job_id: closeJob.id,
          provider_closed_at: confirmedClosed.provider_closed_at,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ============================================================
    // save_before_photo: persist the before-wash photo URL on the job.
    // Only allowed when the job is in the "arrived" status and the
    // booking is still assigned to this provider.
    // ============================================================
    if (action === "save_before_photo") {
      const { photo_url } = body as { photo_url?: string };
      if (!photo_url || typeof photo_url !== "string") {
        return new Response(
          JSON.stringify({ error: "photo_url is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Re-verify the booking is still assigned to this provider and not cancelled/expired.
      const { data: currentBooking, error: recheckError } = await supabase
        .from("bookings")
        .select("id, status, provider_id")
        .eq("id", booking_id)
        .maybeSingle();

      if (recheckError || !currentBooking) {
        return new Response(
          JSON.stringify({ error: "Booking not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (currentBooking.status === "cancelled" || currentBooking.status === "expired") {
        return new Response(
          JSON.stringify({ error: `Booking is ${currentBooking.status}` }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (currentBooking.provider_id !== providerProfile.id) {
        return new Response(
          JSON.stringify({ error: "This booking is no longer assigned to you" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // The job must exist and be in the "arrived" status.
      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .select("id, status, provider_id")
        .eq("booking_id", booking_id)
        .maybeSingle();

      if (jobError || !job) {
        return new Response(
          JSON.stringify({ error: "Job not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (job.provider_id !== providerProfile.id) {
        return new Response(
          JSON.stringify({ error: "This job is not assigned to you" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (job.status !== "arrived") {
        return new Response(
          JSON.stringify({ error: `Job status is ${job.status}, expected arrived` }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { error: updateError } = await supabase
        .from("jobs")
        .update({ before_photo_url: photo_url })
        .eq("id", job.id);

      if (updateError) {
        return new Response(
          JSON.stringify({
            error: "Failed to save photo reference",
            details: updateError.message,
            hint: updateError.hint,
            code: updateError.code,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Re-fetch to confirm persistence.
      const { data: savedJob, error: refetchError } = await supabase
        .from("jobs")
        .select("id, before_photo_url")
        .eq("id", job.id)
        .maybeSingle();

      if (refetchError || !savedJob || savedJob.before_photo_url !== photo_url) {
        return new Response(
          JSON.stringify({ error: "Photo reference could not be verified after save" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ success: true, job_id: job.id, before_photo_url: photo_url }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ============================================================
    // start_wash: transition job from "arrived" to "started".
    // Preconditions: booking assigned to this provider, job status
    // is "arrived", and before_photo_url is non-empty.
    // ============================================================
    if (action === "start_wash") {
      const { data: startBooking, error: startBookingError } = await supabase
        .from("bookings")
        .select("id, status, provider_id")
        .eq("id", booking_id)
        .maybeSingle();

      if (startBookingError || !startBooking) {
        return new Response(
          JSON.stringify({ error: "Booking not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (startBooking.status === "cancelled" || startBooking.status === "expired") {
        return new Response(
          JSON.stringify({ error: `Booking is ${startBooking.status}` }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (startBooking.provider_id !== providerProfile.id) {
        return new Response(
          JSON.stringify({ error: "This booking is no longer assigned to you" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: startJob, error: startJobError } = await supabase
        .from("jobs")
        .select("id, status, provider_id, before_photo_url")
        .eq("booking_id", booking_id)
        .maybeSingle();

      if (startJobError || !startJob) {
        return new Response(
          JSON.stringify({ error: "Job not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (startJob.provider_id !== providerProfile.id) {
        return new Response(
          JSON.stringify({ error: "This job is not assigned to you" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (startJob.status !== "arrived") {
        return new Response(
          JSON.stringify({ error: `Job status is ${startJob.status}, expected arrived` }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (!startJob.before_photo_url) {
        return new Response(
          JSON.stringify({ error: "Before photo is required before starting the wash" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { error: startUpdateError } = await supabase
        .from("jobs")
        .update({ status: "started" })
        .eq("id", startJob.id);

      if (startUpdateError) {
        return new Response(
          JSON.stringify({
            error: "Failed to start wash",
            details: startUpdateError.message,
            hint: startUpdateError.hint,
            code: startUpdateError.code,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Re-fetch to confirm.
      const { data: startedJob, error: startedRefetchError } = await supabase
        .from("jobs")
        .select("id, status")
        .eq("id", startJob.id)
        .maybeSingle();

      if (startedRefetchError || !startedJob || startedJob.status !== "started") {
        return new Response(
          JSON.stringify({ error: "Wash start could not be verified" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ success: true, job_id: startJob.id, status: "started" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ============================================================
    // save_after_photo: persist the after-wash photo URL on the job.
    // Only allowed when the job is in the "started" status, the
    // before_photo_url is already set, and the booking is still
    // assigned to this provider. Does NOT change job status.
    // ============================================================
    if (action === "save_after_photo") {
      const { photo_url } = body as { photo_url?: string };
      if (!photo_url || typeof photo_url !== "string") {
        return new Response(
          JSON.stringify({ error: "photo_url is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: currentBooking, error: recheckError } = await supabase
        .from("bookings")
        .select("id, status, provider_id")
        .eq("id", booking_id)
        .maybeSingle();

      if (recheckError || !currentBooking) {
        return new Response(
          JSON.stringify({ error: "Booking not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (currentBooking.status === "cancelled" || currentBooking.status === "expired") {
        return new Response(
          JSON.stringify({ error: `Booking is ${currentBooking.status}` }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (currentBooking.provider_id !== providerProfile.id) {
        return new Response(
          JSON.stringify({ error: "This booking is no longer assigned to you" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .select("id, status, provider_id, before_photo_url")
        .eq("booking_id", booking_id)
        .maybeSingle();

      if (jobError || !job) {
        return new Response(
          JSON.stringify({ error: "Job not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (job.provider_id !== providerProfile.id) {
        return new Response(
          JSON.stringify({ error: "This job is not assigned to you" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (job.status !== "started") {
        return new Response(
          JSON.stringify({ error: `Job status is ${job.status}, expected started` }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (!job.before_photo_url) {
        return new Response(
          JSON.stringify({ error: "Before photo is required before saving the after photo" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { error: updateError } = await supabase
        .from("jobs")
        .update({ after_photo_url: photo_url })
        .eq("id", job.id);

      if (updateError) {
        return new Response(
          JSON.stringify({
            error: "Failed to save photo reference",
            details: updateError.message,
            hint: updateError.hint,
            code: updateError.code,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: savedJob, error: refetchError } = await supabase
        .from("jobs")
        .select("id, after_photo_url")
        .eq("id", job.id)
        .maybeSingle();

      if (refetchError || !savedJob || savedJob.after_photo_url !== photo_url) {
        return new Response(
          JSON.stringify({ error: "Photo reference could not be verified after save" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ success: true, job_id: job.id, after_photo_url: photo_url }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ============================================================
    // send_for_approval: partner sends the finished wash to the
    // customer for approval. Preconditions: booking assigned to
    // this provider, job status is "started", both before_photo_url
    // and after_photo_url are non-empty. Transitions job to
    // "pending_approval". Does NOT set completed_at or touch
    // booking.status.
    // ============================================================
    if (action === "send_for_approval") {
      const { data: saBooking, error: saBookingError } = await supabase
        .from("bookings")
        .select("id, status, provider_id, customer_id")
        .eq("id", booking_id)
        .maybeSingle();

      if (saBookingError || !saBooking) {
        return new Response(
          JSON.stringify({ error: "Booking not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (saBooking.status === "cancelled" || saBooking.status === "expired") {
        return new Response(
          JSON.stringify({ error: `Booking is ${saBooking.status}` }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (saBooking.provider_id !== providerProfile.id) {
        return new Response(
          JSON.stringify({ error: "This booking is no longer assigned to you" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: saJob, error: saJobError } = await supabase
        .from("jobs")
        .select("id, status, provider_id, before_photo_url, after_photo_url")
        .eq("booking_id", booking_id)
        .maybeSingle();

      if (saJobError || !saJob) {
        return new Response(
          JSON.stringify({ error: "Job not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (saJob.provider_id !== providerProfile.id) {
        return new Response(
          JSON.stringify({ error: "This job is not assigned to you" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (saJob.status !== "started") {
        return new Response(
          JSON.stringify({ error: `Job status is ${saJob.status}, expected started` }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (!saJob.before_photo_url) {
        return new Response(
          JSON.stringify({ error: "Before photo is required before sending for approval" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (!saJob.after_photo_url) {
        return new Response(
          JSON.stringify({ error: "After photo is required before sending for approval" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { error: saUpdateError } = await supabase
        .from("jobs")
        .update({ status: "pending_approval" })
        .eq("id", saJob.id);

      if (saUpdateError) {
        return new Response(
          JSON.stringify({
            error: "Failed to send for approval",
            details: saUpdateError.message,
            code: saUpdateError.code,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Re-fetch to confirm.
      const { data: saConfirmed, error: saConfirmError } = await supabase
        .from("jobs")
        .select("id, status, before_photo_url, after_photo_url")
        .eq("id", saJob.id)
        .maybeSingle();

      if (saConfirmError || !saConfirmed || saConfirmed.status !== "pending_approval") {
        return new Response(
          JSON.stringify({ error: "Approval request could not be verified" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Notify the customer that their wash is complete and ready
      // for approval. Fire-and-forget.
      if (saBooking?.customer_id) {
        sendPushNotification(
          supabaseUrl, serviceRoleKey,
          saBooking.customer_id, "pending_approval", "approvalCenter", booking_id,
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          job_id: saJob.id,
          status: "pending_approval",
          before_photo_url: saConfirmed.before_photo_url,
          after_photo_url: saConfirmed.after_photo_url,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Verify the booking exists, is accepted, and is assigned to this provider
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, status, provider_id, customer_id")
      .eq("id", booking_id)
      .maybeSingle();

    if (bookingError || !booking) {
      return new Response(
        JSON.stringify({ error: "Booking not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (booking.status === "cancelled") {
      return new Response(
        JSON.stringify({ error: "Booking was cancelled by the customer" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (booking.status === "expired") {
      return new Response(
        JSON.stringify({ error: "Booking has expired" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (booking.provider_id !== providerProfile.id) {
      return new Response(
        JSON.stringify({ error: "This booking is not assigned to you" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (booking.status !== "accepted") {
      return new Response(
        JSON.stringify({ error: `Booking status is ${booking.status}, expected accepted` }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Single Active Job Guard: before creating or updating any job, verify
    // this provider does not already have a different active job. The
    // database is the source of truth — React state is not trusted.
    const { data: providerActiveJobs } = await supabase
      .from("jobs")
      .select("id, booking_id, status")
      .eq("provider_id", providerProfile.id)
      .in("status", ["on_the_way", "arrived", "started", "pending_approval"]);

    if (providerActiveJobs && providerActiveJobs.length > 0) {
      // Allow the action only if the existing active job belongs to THIS
      // booking (i.e. the provider is advancing their own job through the
      // workflow). If a different booking's job is active, block it.
      const sameBookingActive = providerActiveJobs.some(j => j.booking_id === booking_id);
      if (!sameBookingActive) {
        return new Response(
          JSON.stringify({ error: "You cannot accept another booking while you have an active job." }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Find or create the job row for this booking. Use ordered query + limit
    // instead of maybeSingle() — if duplicate rows exist, maybeSingle() returns
    // a 406 error and the old code silently inserted ANOTHER duplicate.
    const { data: existingJobs, error: existingJobError } = await supabase
      .from("jobs")
      .select("id, status")
      .eq("booking_id", booking_id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (existingJobError) {
      return new Response(
        JSON.stringify({ error: "Failed to look up job", details: existingJobError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const existingJob = existingJobs && existingJobs.length > 0 ? existingJobs[0] : null;

    let jobStatus: string;
    let requiredPreviousStatus: string;
    if (action === "on_my_way") {
      jobStatus = "on_the_way";
      requiredPreviousStatus = "accepted";
    } else if (action === "arrived") {
      jobStatus = "arrived";
      requiredPreviousStatus = "on_the_way";
    } else {
      return new Response(
        JSON.stringify({ error: `Unknown action: ${action}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (existingJob) {
      if (action === "arrived" && existingJob.status !== "on_the_way") {
        return new Response(
          JSON.stringify({ error: `Job status is ${existingJob.status}, expected on_the_way` }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (action === "on_my_way" && existingJob.status !== "on_the_way" && existingJob.status !== "cancelled") {
        return new Response(
          JSON.stringify({ error: `Job already in status ${existingJob.status}` }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const { error: updateError } = await supabase
        .from("jobs")
        .update({ status: jobStatus })
        .eq("id", existingJob.id);

      if (updateError) {
        return new Response(
          JSON.stringify({
            error: "Failed to update job status",
            details: updateError.message,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } else {
      const { error: insertError } = await supabase
        .from("jobs")
        .insert({
          booking_id: booking_id,
          provider_id: providerProfile.id,
          customer_id: booking.customer_id,
          status: jobStatus,
        });

      if (insertError) {
        return new Response(
          JSON.stringify({
            error: "Failed to create job",
            details: insertError.message,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Send push notification to the customer for status changes.
    // Fire-and-forget — notification failure must never block the action.
    const notifType = action === "on_my_way" ? "on_the_way" : "arrived";
    const notifScreen = action === "on_my_way" ? "partnerSelection" : "partnerSelection";
    sendPushNotification(
      supabaseUrl, serviceRoleKey,
      booking.customer_id, notifType, notifScreen, booking_id,
    );

    return new Response(
      JSON.stringify({ success: true, status: jobStatus }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message ?? "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
