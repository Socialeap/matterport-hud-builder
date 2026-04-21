import { supabase } from "@/integrations/supabase/client";

const BUCKET = "brand-assets";
const VAULT_BUCKET = "vault-assets";

/**
 * Upload a file to brand-assets storage under the user's folder.
 * Returns the public URL on success, null on failure.
 */
export async function uploadBrandAsset(
  userId: string,
  file: File,
  assetType: "logo" | "favicon" | "hero" | "avatar"
): Promise<string | null> {
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  // Cache-bust by appending a timestamp suffix so re-uploads aren't masked by CDN cache
  const path = `${userId}/${assetType}-${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: true });

  if (error) {
    console.error(`Upload ${assetType} failed:`, error);
    return null;
  }

  const { data: urlData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(path);

  return urlData.publicUrl;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Upload a Vault asset file. Stored as `{providerId}/{category}/{timestamp}-{filename}`
 * so providers can accumulate many assets per category without collisions.
 */
export async function uploadVaultAsset(
  providerId: string,
  category: string,
  file: File
): Promise<{ url: string; path: string } | null> {
  const path = `${providerId}/${category}/${Date.now()}-${sanitizeFileName(file.name)}`;

  const { error } = await supabase.storage
    .from(VAULT_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || undefined });

  if (error) {
    console.error("Vault upload failed:", error);
    return null;
  }

  const { data: urlData } = supabase.storage
    .from(VAULT_BUCKET)
    .getPublicUrl(path);

  return { url: urlData.publicUrl, path };
}

export async function deleteVaultAssetFile(path: string): Promise<boolean> {
  const { error } = await supabase.storage.from(VAULT_BUCKET).remove([path]);
  if (error) {
    console.error("Vault delete failed:", error);
    return false;
  }
  return true;
}
