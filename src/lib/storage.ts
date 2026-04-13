import { supabase } from "@/integrations/supabase/client";

const BUCKET = "brand-assets";

/**
 * Upload a file to brand-assets storage under the user's folder.
 * Returns the public URL on success, null on failure.
 */
export async function uploadBrandAsset(
  userId: string,
  file: File,
  assetType: "logo" | "favicon"
): Promise<string | null> {
  const ext = file.name.split(".").pop() || "png";
  const path = `${userId}/${assetType}.${ext}`;

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
