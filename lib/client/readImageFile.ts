const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Read a bill image only after checking its encoded and decoded size. */
export async function readImageFile(file: File): Promise<string> {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Choose a PNG, JPG, or WebP image.");
  }
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    throw new Error("The image must be smaller than 20 MB.");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This image could not be decoded. Try exporting it as PNG or JPG.");
  }
  const pixels = bitmap.width * bitmap.height;
  const width = bitmap.width;
  const height = bitmap.height;
  bitmap.close();
  if (width > 20_000 || height > 20_000) {
    throw new Error("The image dimensions exceed the editor's 20,000 px page limit. Resize it first.");
  }
  if (pixels > MAX_IMAGE_PIXELS) {
    throw new Error("The image is too large to edit. Resize it to 40 megapixels or less first.");
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("The image could not be read."));
    };
    reader.onerror = () => reject(new Error("The image could not be read."));
    reader.onabort = () => reject(new Error("Image loading was cancelled."));
    reader.readAsDataURL(file);
  });
}
