const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractCloudinaryPublicId(imageUrl: string) {
  const url = new URL(imageUrl);
  const parts = url.pathname.split("/image/upload/");
  if (parts.length < 2) throw new Error("La URL no parece ser una imagen de Cloudinary.");

  let path = parts[1].split("?")[0].split("#")[0];
  const segments = path.split("/").filter(Boolean);
  const versionIndex = segments.findIndex((segment) => /^v\d+$/.test(segment));
  if (versionIndex >= 0) path = segments.slice(versionIndex + 1).join("/");
  else path = segments.join("/");

  path = decodeURIComponent(path);
  return path.replace(/\.[a-zA-Z0-9]+$/, "");
}

async function sha1Hex(value: string) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Método no permitido." }, 405);

  try {
    const cloudName = Deno.env.get("CLOUDINARY_CLOUD_NAME");
    const apiKey = Deno.env.get("CLOUDINARY_API_KEY");
    const apiSecret = Deno.env.get("CLOUDINARY_API_SECRET");

    if (!cloudName || !apiKey || !apiSecret) {
      return jsonResponse({ ok: false, error: "Faltan secretos de Cloudinary en Supabase." }, 500);
    }

    const { imageUrl, publicId } = await req.json();
    const finalPublicId = String(publicId || "").trim() || extractCloudinaryPublicId(String(imageUrl || ""));
    if (!finalPublicId) return jsonResponse({ ok: false, error: "Falta public_id o imageUrl." }, 400);

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await sha1Hex(`public_id=${finalPublicId}&timestamp=${timestamp}${apiSecret}`);

    const form = new URLSearchParams();
    form.set("public_id", finalPublicId);
    form.set("api_key", apiKey);
    form.set("timestamp", timestamp);
    form.set("signature", signature);

    const cloudinaryResponse = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    const result = await cloudinaryResponse.json();

    if (!cloudinaryResponse.ok || !["ok", "not found"].includes(result?.result)) {
      return jsonResponse({ ok: false, publicId: finalPublicId, error: result?.error?.message || result?.result || "Cloudinary rechazó la eliminación." }, 400);
    }

    return jsonResponse({ ok: true, publicId: finalPublicId, result: result.result });
  } catch (error) {
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
