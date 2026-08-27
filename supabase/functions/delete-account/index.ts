// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface StorageTarget {
  bucket: string;
  prefix: string;
}

interface ManifestRow {
  id: string;
  auth_user_id: string;
  storage_targets: StorageTarget[];
  stage: string;
}

const PAGE_SIZE = 1000;
const MAX_DEPTH = 32;

/**
 * Generic recursive prefix walker for Supabase Storage.
 *
 * Recursively traverses folders under `prefix` until no deeper
 * prefixes remain. Supports arbitrary nesting depth. Paginates
 * at EVERY directory level. Collects exact object paths only —
 * never deletes an entire bucket, never leaves the recorded prefix.
 *
 * - already-missing objects = success/no-op
 * - empty folders = no-op
 * - retry-safe (re-listing yields the same or fewer objects)
 * - avoids infinite recursion via MAX_DEPTH guard
 */
async function listAllObjects(
  serviceClient: ReturnType<typeof createClient>,
  bucket: string,
  prefix: string,
): Promise<{ paths: string[]; error: string | null }> {
  const allPaths: string[] = [];

  async function walk(currentPrefix: string, depth: number): Promise<string | null> {
    if (depth > MAX_DEPTH) {
      return `max depth exceeded at ${currentPrefix}`;
    }

    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data: listData, error: listError } = await serviceClient.storage
        .from(bucket)
        .list(currentPrefix, {
          limit: PAGE_SIZE,
          offset: offset,
          sortBy: { column: "name", order: "asc" },
        });

      if (listError) {
        // Folder doesn't exist or is empty — treat as success
        if (
          listError.message?.includes("not found") ||
          listError.message?.includes("404") ||
          listError.message?.includes("The resource was not found")
        ) {
          return null;
        }
        return `list failed for ${bucket}/${currentPrefix}: ${listError.message}`;
      }

      const items = listData ?? [];
      if (items.length === 0) {
        hasMore = false;
        break;
      }

      for (const item of items) {
        const itemPath = currentPrefix + item.name;

        // A folder has no metadata/id (null). An object file has both.
        const isFolder = item.metadata === null && item.id === null;

        if (isFolder) {
          // Recurse into subfolder
          const subPrefix = itemPath.endsWith("/") ? itemPath : itemPath + "/";
          const subError = await walk(subPrefix, depth + 1);
          if (subError) return subError;
        } else {
          allPaths.push(itemPath);
        }
      }

      if (items.length < PAGE_SIZE) {
        hasMore = false;
      } else {
        offset += PAGE_SIZE;
      }
    }

    return null;
  }

  const walkError = await walk(prefix, 0);
  if (walkError) {
    return { paths: allPaths, error: walkError };
  }
  return { paths: allPaths, error: null };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "method_not_allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // ============================================================
    // JWT VALIDATION — obtain verified user id from the token
    // ============================================================
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ success: false, error: "unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(
        JSON.stringify({ success: false, error: "unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const verifiedUserId = userData.user.id;

    // ============================================================
    // SERVICE-ROLE CLIENT — backend operations only
    // ============================================================
    const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ============================================================
    // CALL INTERNAL PREPARATION RPC
    // ============================================================
    const { data: prepResult, error: prepError } = await serviceClient.rpc(
      "prepare_account_deletion",
      { p_user_id: verifiedUserId },
    );

    if (prepError) {
      console.error("[delete-account] preparation RPC failed:", prepError.message);
      return new Response(
        JSON.stringify({ success: false, error: "account_deletion_incomplete" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const result = prepResult as {
      success: boolean;
      eligible?: boolean;
      prepared?: boolean;
      blocker?: string;
      role?: string;
      request_id?: string;
      stage?: string;
      error?: string;
    };

    // FAIL CLOSED: inconsistent state (profile missing + manifest missing)
    // The RPC returns success:false with error:deletion_state_inconsistent.
    // Auth deletion MUST NOT execute. Translate to non-sensitive public response.
    if (result && result.success === false && result.error === "deletion_state_inconsistent") {
      console.error("[delete-account] inconsistent state: profile missing + manifest missing");
      return new Response(
        JSON.stringify({ success: false, error: "account_deletion_incomplete" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // If blocked, return safe blocker response
    if (result && result.eligible === false) {
      return new Response(
        JSON.stringify({
          success: true,
          eligible: false,
          blocker: result.blocker ?? "unknown",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!result || !result.prepared || !result.request_id) {
      console.error("[delete-account] unexpected preparation result:", JSON.stringify(result));
      return new Response(
        JSON.stringify({ success: false, error: "account_deletion_incomplete" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const requestId = result.request_id;
    const stage = result.stage ?? "pending";

    // ============================================================
    // STORAGE CLEANUP (if not already done)
    // ============================================================
    if (stage !== "storage_done" && stage !== "completed") {
      // Read the manifest row
      const { data: manifestRow, error: manifestError } = await serviceClient
        .from("account_deletion_requests")
        .select("id, storage_targets, stage")
        .eq("auth_user_id", verifiedUserId)
        .maybeSingle();

      if (manifestError || !manifestRow) {
        console.error("[delete-account] manifest read failed:", manifestError?.message);
        return new Response(
          JSON.stringify({ success: false, error: "account_deletion_incomplete" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const targets = (manifestRow as unknown as ManifestRow).storage_targets ?? [];
      let storageFailed = false;

      for (const target of targets) {
        try {
          // Generic recursive traversal — handles arbitrary nesting depth
          const { paths: allPaths, error: walkError } = await listAllObjects(
            serviceClient,
            target.bucket,
            target.prefix,
          );

          if (walkError) {
            console.error(`[delete-account] traversal failed for ${target.bucket}/${target.prefix}:`, walkError);
            storageFailed = true;
            break;
          }

          // Delete all found objects (missing objects = success/no-op)
          if (allPaths.length > 0) {
            const { error: deleteError } = await serviceClient.storage
              .from(target.bucket)
              .remove(allPaths);

            if (deleteError) {
              console.error(`[delete-account] delete failed for ${target.bucket}:`, deleteError.message);
              storageFailed = true;
              break;
            }
          }
        } catch (err) {
          console.error(`[delete-account] storage cleanup error for ${target.bucket}/${target.prefix}:`, err);
          storageFailed = true;
          break;
        }
      }

      if (storageFailed) {
        // Keep stage = pending, return retriable error
        return new Response(
          JSON.stringify({ success: false, error: "account_deletion_incomplete" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Mark storage as done
      const { error: updateError } = await serviceClient
        .from("account_deletion_requests")
        .update({ stage: "storage_done", updated_at: new Date().toISOString() })
        .eq("auth_user_id", verifiedUserId);

      if (updateError) {
        console.error("[delete-account] failed to mark storage_done:", updateError.message);
        return new Response(
          JSON.stringify({ success: false, error: "account_deletion_incomplete" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // ============================================================
    // AUTH DELETE — ABSOLUTELY LAST
    // ============================================================
    const { error: authDeleteError } = await serviceClient.auth.admin.deleteUser(verifiedUserId);

    if (authDeleteError) {
      // If user is already gone, treat as success
      if (
        authDeleteError.message?.includes("User not found") ||
        authDeleteError.message?.includes("already been deleted") ||
        authDeleteError.message?.includes("404")
      ) {
        // Fall through to completion
      } else {
        console.error("[delete-account] auth deletion failed:", authDeleteError.message);
        return new Response(
          JSON.stringify({ success: false, error: "account_deletion_incomplete" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // ============================================================
    // COMPLETE MANIFEST
    // ============================================================
    await serviceClient
      .from("account_deletion_requests")
      .update({
        stage: "completed",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("auth_user_id", verifiedUserId);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[delete-account] unexpected error:", err);
    return new Response(
      JSON.stringify({ success: false, error: "account_deletion_incomplete" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
