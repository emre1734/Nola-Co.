import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ============================================================
// VAPID JWT generation using Deno's WebCrypto API
// ============================================================

function base64UrlEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function generateVapidJWT(
  audience: string,
  privateKeyPemB64Url: string,
): Promise<string> {
  const pkcs8Bytes = base64UrlDecode(privateKeyPemB64Url);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8Bytes,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: "mailto:support@wishwash.app",
  };

  const enc = new TextEncoder();
  const headerB64 = base64UrlEncode(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  const unsigned = `${headerB64}.${payloadB64}`;

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    enc.encode(unsigned),
  );

  return `${unsigned}.${base64UrlEncode(signature)}`;
}

// ============================================================
// Send a single push message to a subscription endpoint
// ============================================================

async function sendPushMessage(
  subscription: {
    endpoint: string;
    p256dh_key: string;
    auth_key: string;
  },
  payload: Record<string, unknown>,
  vapidPublicKey: string,
  vapidPrivateKey: string,
): Promise<{ ok: boolean; status: number; shouldDelete: boolean }> {
  try {
    const url = new URL(subscription.endpoint);
    const audience = `${url.protocol}//${url.host}`;
    const vapidJwt = await generateVapidJWT(audience, vapidPrivateKey);

    const body = JSON.stringify(payload);
    const encryptedBody = await encryptPayload(body, subscription);

    const res = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        "Content-Length": String(encryptedBody.byteLength),
        "Authorization": `vapid t=${vapidJwt}, k=${vapidPublicKey}`,
        "TTL": "2419200",
      },
      body: encryptedBody,
    });

    if (res.ok) {
      return { ok: true, status: res.status, shouldDelete: false };
    }

    // 410 Gone or 404 Not Found → subscription is invalid, should delete
    if (res.status === 410 || res.status === 404) {
      return { ok: false, status: res.status, shouldDelete: true };
    }

    console.error(`Push failed: ${res.status} ${res.statusText}`);
    return { ok: false, status: res.status, shouldDelete: false };
  } catch (err) {
    console.error("Push send error:", err);
    return { ok: false, status: 0, shouldDelete: false };
  }
}

// ============================================================
// AES-128-GCM payload encryption (RFC 8291 / aes128gcm encoding)
// ============================================================

async function encryptPayload(
  payload: string,
  subscription: { p256dh_key: string; auth_key: string },
): Promise<ArrayBuffer> {
  const enc = new TextEncoder();

  // Import the user's public key (p256dh) and auth secret
  const userPublicKey = await crypto.subtle.importKey(
    "raw",
    base64UrlDecode(subscription.p256dh_key),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );

  // Generate server ephemeral key pair
  const serverKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );

  const serverPublicKeyBytes = await crypto.subtle.exportKey(
    "raw",
    serverKeyPair.publicKey,
  );

  // Derive shared secret
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: userPublicKey },
    serverKeyPair.privateKey,
    256,
  );

  // HKDF to derive content encryption key and nonce
  const authSecret = base64UrlDecode(subscription.auth_key);

  // Info for key: "WebPush: info\0" + user_pubkey + server_pubkey
  const userPubKeyBytes = base64UrlDecode(subscription.p256dh_key);
  const keyInfo = new Uint8Array([
    ...enc.encode("WebPush: info\0"),
    ...userPubKeyBytes,
    ...new Uint8Array(serverPublicKeyBytes),
  ]);

  const prkKey = await hkdfExtract(sharedSecret, authSecret);
  const cek = await hkdfExpand(prkKey, enc.encode("Content-Encoding: aes128gcm\0"), keyInfo, 16);
  const nonce = await hkdfExpand(prkKey, enc.encode("Content-Encoding: nonce\0"), keyInfo, 12);

  // Build the aes128gcm header
  const recordSize = 4096;
  const payloadBytes = enc.encode(payload);
  const paddingLength = Math.max(0, recordSize - payloadBytes.length - 16 - 1);
  const paddedPayload = new Uint8Array(payloadBytes.length + 1 + paddingLength);
  paddedPayload.set(payloadBytes, 0);
  // Last byte = 0x02 (last record marker)
  paddedPayload[payloadBytes.length] = 0x02;

  const iv = new Uint8Array(nonce);

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    cek,
    paddedPayload,
  );

  // Build the header: key_id length (1 byte) + key_id (65 bytes) + record_size (4 bytes) + num_records (1 byte)
  const header = new Uint8Array(21 + serverPublicKeyBytes.byteLength);
  header[0] = serverPublicKeyBytes.byteLength;
  header.set(new Uint8Array(serverPublicKeyBytes), 1);
  const dv = new DataView(header.buffer);
  dv.setUint32(1 + serverPublicKeyBytes.byteLength, recordSize, false);
  header[1 + serverPublicKeyBytes.byteLength + 4] = 0;

  const result = new Uint8Array(header.length + encrypted.byteLength);
  result.set(header, 0);
  result.set(new Uint8Array(encrypted), header.length);

  return result.buffer;
}

async function hkdfExtract(ikm: ArrayBuffer, salt: Uint8Array): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", salt, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, ikm);
  return sig;
}

async function hkdfExpand(
  prk: ArrayBuffer,
  info: Uint8Array,
  context: Uint8Array,
  length: number,
): Promise<ArrayBuffer> {
  const fullInfo = new Uint8Array(info.length + context.length);
  fullInfo.set(info, 0);
  fullInfo.set(context, info.length);

  const key = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);

  let t = new Uint8Array(0);
  let okm = new Uint8Array(0);
  let counter = 1;

  while (okm.length < length) {
    const input = new Uint8Array(t.length + fullInfo.length + 1);
    input.set(t, 0);
    input.set(fullInfo, t.length);
    input[t.length + fullInfo.length] = counter;

    const sig = await crypto.subtle.sign("HMAC", key, input);
    t = new Uint8Array(sig);
    const newOkm = new Uint8Array(okm.length + t.length);
    newOkm.set(okm, 0);
    newOkm.set(t, okm.length);
    okm = newOkm;
    counter++;
  }

  return okm.slice(0, length).buffer;
}

// ============================================================
// Notification content (localized)
// ============================================================

const NOTIFICATION_TEMPLATES: Record<string, Record<string, { title: string; body: string }>> = {
  new_booking: {
    en: { title: "New Reservation Available", body: "A new wash request is available near you for {{booking_date}} at {{booking_time}}." },
    tr: { title: "Yeni Rezervasyon Mevcut", body: "{{booking_date}} {{booking_time}} için yakınında yeni bir yıkama talebi var." },
    es: { title: "Nueva Reserva Disponible", body: "Una nueva solicitud de lavado está disponible cerca de ti para el {{booking_date}} a las {{booking_time}}." },
  },
  booking_accepted: {
    en: { title: "Partner Found", body: "A service provider has accepted your reservation." },
    tr: { title: "Servis Sağlayıcı Bulundu", body: "Bir servis sağlayıcı rezervasyonunuzu kabul etti." },
    es: { title: "Prestatario Encontrado", body: "Un proveedor de servicios ha aceptado tu reserva." },
  },
  on_the_way: {
    en: { title: "Your Partner Is On the Way", body: "Your WishWash service provider is heading to your location." },
    tr: { title: "Servis Sağlayıcınız Yolda", body: "WishWash servis sağlayıcınız konumunuza doğru yola çıktı." },
    es: { title: "Tu Prestatario Está en Camino", body: "Tu proveedor de servicios WishWash se dirige a tu ubicación." },
  },
  arrived: {
    en: { title: "Your Partner Has Arrived", body: "Your WishWash service provider has arrived at the selected location." },
    tr: { title: "Servis Sağlayıcınız Geldi", body: "WishWash servis sağlayıcınız seçilen konuma ulaştı." },
    es: { title: "Tu Prestatario Ha Llegado", body: "Tu proveedor de servicios WishWash ha llegado a la ubicación seleccionada." },
  },
  pending_approval: {
    en: { title: "Service Waiting for Approval", body: "Your wash is complete. Please review the before and after photos." },
    tr: { title: "Servis Onay Bekliyor", body: "Yıkamanız tamamlandı. Lütfen öncesi ve sonrası fotoğrafları inceleyin." },
    es: { title: "Servicio Esperando Aprobación", body: "Tu lavado está completo. Por favor revisa las fotos antes y después." },
  },
  service_approved: {
    en: { title: "Service Approved", body: "The customer approved the completed service." },
    tr: { title: "Servis Onaylandı", body: "Müşteri tamamlanan servisi onayladı." },
    es: { title: "Servicio Aprobado", body: "El cliente aprobó el servicio completado." },
  },
  problem_reported: {
    en: { title: "Service Review Required", body: "The customer reported an issue with the completed service." },
    tr: { title: "Servis İncelemesi Gerekli", body: "Müşteri tamamlanan servisle ilgili bir sorun bildirdi." },
    es: { title: "Revisión de Servicio Requerida", body: "El cliente reportó un problema con el servicio completado." },
  },
};

function getNotificationContent(
  type: string,
  language: string | null,
  params: Record<string, string>,
): { title: string; body: string } {
  const lang = (language && NOTIFICATION_TEMPLATES[type]?.[language]) ? language : "en";
  const template = NOTIFICATION_TEMPLATES[type]?.[lang] ?? NOTIFICATION_TEMPLATES[type]?.["en"];
  if (!template) return { title: "WishWash", body: "" };

  let title = template.title;
  let body = template.body;
  for (const [key, value] of Object.entries(params)) {
    title = title.replace(new RegExp(`{{${key}}}`, "g"), value);
    body = body.replace(new RegExp(`{{${key}}}`, "g"), value);
  }
  return { title, body };
}

// ============================================================
// Helper: haversine distance in km
// ============================================================
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ============================================================
// Helper: send a notification to a single user (all their devices)
// ============================================================
async function sendToUser(
  supabase: ReturnType<typeof createClient>,
  targetUserId: string,
  notificationType: string,
  params: Record<string, string>,
  screen: string | null,
  bookingId: string | null,
  vapidPublicKey: string,
  vapidPrivateKey: string,
  languageOverride: string | null,
): Promise<{ sent: number; reason?: string }> {
  // Check if user has notifications enabled
  const { data: profile } = await supabase
    .from("profiles")
    .select("notifications_enabled, notification_language")
    .eq("id", targetUserId)
    .maybeSingle();

  if (!profile) return { sent: 0, reason: "user_not_found" };
  if (profile.notifications_enabled === false) return { sent: 0, reason: "notifications_disabled" };

  const { data: tokens } = await supabase
    .from("notification_tokens")
    .select("endpoint, p256dh_key, auth_key")
    .eq("user_id", targetUserId);

  if (!tokens || tokens.length === 0) return { sent: 0, reason: "no_tokens" };

  const lang = languageOverride ?? profile.notification_language;
  const content = getNotificationContent(notificationType, lang, params);
  const payload = {
    title: content.title,
    body: content.body,
    screen,
    booking_id: bookingId,
    notification_type: notificationType,
  };

  let sent = 0;
  const invalidEndpoints: string[] = [];

  for (const token of tokens) {
    const result = await sendPushMessage(token, payload, vapidPublicKey, vapidPrivateKey);
    if (result.ok) {
      sent++;
    } else if (result.shouldDelete) {
      invalidEndpoints.push(token.endpoint);
    }
  }

  if (invalidEndpoints.length > 0) {
    await supabase
      .from("notification_tokens")
      .delete()
      .eq("user_id", targetUserId)
      .in("endpoint", invalidEndpoints);
  }

  return { sent };
}

// ============================================================
// Main handler
// ============================================================

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
    const { action } = body as { action: string };

    // ============================================================
    // register_token: save a web push subscription for the user
    // ============================================================
    if (action === "register_token") {
      const { subscription, role } = body as {
        subscription: {
          endpoint: string;
          keys: { p256dh: string; auth: string };
        };
        role?: string;
      };

      if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
        return new Response(
          JSON.stringify({ error: "Invalid subscription" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Resolve role from profiles if not provided
      let userRole = role;
      if (!userRole) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", userId)
          .maybeSingle();
        userRole = profile?.role ?? "customer";
      }

      const { error: upsertError } = await supabase
        .from("notification_tokens")
        .upsert(
          {
            user_id: userId,
            role: userRole,
            platform: "web",
            endpoint: subscription.endpoint,
            p256dh_key: subscription.keys.p256dh,
            auth_key: subscription.keys.auth,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,endpoint" },
        );

      if (upsertError) {
        return new Response(
          JSON.stringify({ error: "Failed to register token" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ============================================================
    // unregister_token: remove a subscription (e.g. on sign-out)
    // ============================================================
    if (action === "unregister_token") {
      const { endpoint } = body as { endpoint?: string };
      if (!endpoint) {
        return new Response(
          JSON.stringify({ error: "endpoint is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      await supabase
        .from("notification_tokens")
        .delete()
        .eq("user_id", userId)
        .eq("endpoint", endpoint);

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ============================================================
    // get_vapid_public_key: return the public VAPID key for the frontend
    // ============================================================
    if (action === "get_vapid_public_key") {
      const { data: secretRow } = await supabase
        .from("app_secrets")
        .select("value")
        .eq("key", "vapid_public_key")
        .maybeSingle();

      if (!secretRow?.value) {
        return new Response(
          JSON.stringify({ error: "VAPID key not configured" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ public_key: secretRow.value }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ============================================================
    // broadcast_new_booking: find nearby eligible providers and
    // send them a "new_booking" push notification. Called by the
    // client (BookingScreen) after a booking is successfully created.
    // ============================================================
    if (action === "broadcast_new_booking") {
      const { booking_id } = body as { booking_id: string };
      if (!booking_id) {
        return new Response(
          JSON.stringify({ error: "booking_id is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Fetch the booking with location and date/time
      const { data: booking, error: bookingError } = await supabase
        .from("bookings")
        .select("id, latitude, longitude, booking_date, booking_time, customer_id")
        .eq("id", booking_id)
        .maybeSingle();

      if (bookingError || !booking) {
        return new Response(
          JSON.stringify({ error: "Booking not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Find eligible providers: role=provider, notifications enabled,
      // has location, and is "available" or "online".
      let providerQuery = supabase
        .from("profiles")
        .select("id, notification_language, latitude, longitude")
        .eq("role", "provider")
        .neq("notifications_enabled", false)
        .not("latitude", "is", null)
        .not("longitude", "is", null);

      const { data: providers, error: providersError } = await providerQuery;

      if (providersError || !providers || providers.length === 0) {
        return new Response(
          JSON.stringify({ success: true, sent: 0, reason: "no_eligible_providers" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Filter by distance if booking has coordinates
      const MAX_DISTANCE_KM = 50;
      const eligibleProviders = booking.latitude != null && booking.longitude != null
        ? providers.filter((p) => {
            if (p.latitude == null || p.longitude == null) return false;
            const dist = haversineKm(
              booking.latitude!, booking.longitude!,
              p.latitude, p.longitude,
            );
            return dist <= MAX_DISTANCE_KM;
          })
        : providers;

      if (eligibleProviders.length === 0) {
        return new Response(
          JSON.stringify({ success: true, sent: 0, reason: "no_nearby_providers" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Get VAPID keys
      const [{ data: pubKeyRow }, { data: privKeyRow }] = await Promise.all([
        supabase.from("app_secrets").select("value").eq("key", "vapid_public_key").maybeSingle(),
        supabase.from("app_secrets").select("value").eq("key", "vapid_private_key").maybeSingle(),
      ]);

      if (!pubKeyRow?.value || !privKeyRow?.value) {
        return new Response(
          JSON.stringify({ error: "VAPID keys not configured" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const bookingDate = booking.booking_date ?? "";
      const bookingTime = booking.booking_time ?? "";
      let totalSent = 0;

      for (const provider of eligibleProviders) {
        const result = await sendToUser(
          supabase,
          provider.id,
          "new_booking",
          { booking_date: bookingDate, booking_time: bookingTime },
          "providerDashboard",
          booking_id,
          pubKeyRow.value,
          privKeyRow.value,
          provider.notification_language,
        );
        totalSent += result.sent;
      }

      return new Response(
        JSON.stringify({ success: true, sent: totalSent, providers_notified: eligibleProviders.length }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ============================================================
    // send_notification: send a push notification to a specific user
    // Called internally by other edge functions (job-progress, etc.)
    // Uses the service role key, so it bypasses RLS.
    // ============================================================
    if (action === "send_notification") {
      const {
        target_user_id,
        notification_type,
        params = {},
        screen = null,
        booking_id = null,
      } = body as {
        target_user_id: string;
        notification_type: string;
        params?: Record<string, string>;
        screen?: string | null;
        booking_id?: string | null;
      };

      if (!target_user_id || !notification_type) {
        return new Response(
          JSON.stringify({ error: "target_user_id and notification_type are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Get VAPID keys
      const [{ data: pubKeyRow }, { data: privKeyRow }] = await Promise.all([
        supabase.from("app_secrets").select("value").eq("key", "vapid_public_key").maybeSingle(),
        supabase.from("app_secrets").select("value").eq("key", "vapid_private_key").maybeSingle(),
      ]);

      if (!pubKeyRow?.value || !privKeyRow?.value) {
        return new Response(
          JSON.stringify({ error: "VAPID keys not configured" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const result = await sendToUser(
        supabase,
        target_user_id,
        notification_type,
        params,
        screen,
        booking_id,
        pubKeyRow.value,
        privKeyRow.value,
        null,
      );

      return new Response(
        JSON.stringify({ success: true, sent: result.sent, reason: result.reason ?? null }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("push-notifications error:", err);
    return new Response(
      JSON.stringify({ error: err.message ?? "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
