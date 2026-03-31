const R2_PUBLIC_URL = "https://pub-646f70ade0ce4813854357f8c35e19e0.r2.dev";
const R2_ACCOUNT_ID = "b592b3b2a5455323a76de721a92699cd";
const R2_BUCKET = "voxcall";

export async function uploadAvatarToR2(
  imageUri: string,
  userId: string
): Promise<string> {
  try {
    const response = await fetch(imageUri);
    const blob = await response.blob();
    const ext = imageUri.includes(".png") ? "png" : "jpg";
    const key = `avatars/${userId}-${Date.now()}.${ext}`;

    const apiUrl = `${process.env.EXPO_PUBLIC_API_URL}/api/upload/r2-avatar`;
    const formData = new FormData();
    formData.append("file", {
      uri: imageUri,
      type: `image/${ext}`,
      name: `avatar.${ext}`,
    } as any);
    formData.append("key", key);

    const token = await import("@/utils/storage").then(m =>
      m.getItem<string>(m.StorageKeys.AUTH_TOKEN)
    );

    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token || ""}` },
      body: formData,
    });

    if (res.ok) {
      const data = await res.json();
      return data.url || `${R2_PUBLIC_URL}/${key}`;
    }
    return `${R2_PUBLIC_URL}/${key}`;
  } catch (err) {
    console.warn("R2 upload failed, using fallback", err);
    return imageUri;
  }
}

export { R2_PUBLIC_URL, R2_BUCKET, R2_ACCOUNT_ID };
