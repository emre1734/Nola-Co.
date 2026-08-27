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
    };

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
          // List all objects under the prefix (handles pagination)
          let allPaths: string[] = [];
          let offset = 0;
          const pageSize = 1000;
          let hasMore = true;

          while (hasMore) {
            const { data: listData, error: listError } = await serviceClient.storage
              .from(target.bucket)
              .list(target.prefix, {
                limit: pageSize,
                offset: offset,
                sortBy: { column: "name", order: "asc" },
              });

            if (listError) {
              // If the folder doesn't exist, treat as success
              if (listError.message?.includes("not found") || listError.message?.includes("404")) {
                hasMore = false;
                break;
              }
              console.error(`[delete-account] list failed for ${target.bucket}/${target.prefix}:`, listError.message);
              storageFailed = true;
              break;
            }

            const items = listData ?? [];
            if (items.length === 0) {
              hasMore = false;
              break;
            }

            for (const item of items) {
              const itemPath = target.prefix + item.name;
              if (item.metadata === null || item.id === null) {
                // It's a folder — recursively list
                // For simplicity, we treat folders by listing with the sub-prefix
                const subPrefix = itemPath.endsWith("/") ? itemPath : itemPath + "/";
                const { data: subItems, error: subError } = await serviceClient.storage
                  .from(target.bucket)
                  .list(subPrefix, { limit: 1000, offset: 0 });

                if (subError) {
                  continue;
                }
                for (const subItem of subItems ?? []) {
                  if (subItem.metadata !== null && subItem.id !== null) {
                    allPaths.push(subPrefix + subItem.name);
                  }
                }
              } else {
                allPaths.push(itemPath);
              }
            }

            if (items.length < pageSize) {
              hasMore = false;
            } else {
              offset += pageSize;
            }
          }

          if (storageFailed) break;

          // Delete all found objects
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
