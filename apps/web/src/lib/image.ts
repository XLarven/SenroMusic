export async function resizeImage(file: File, size: number, quality = 0.86): Promise<string> {
  if (!['image/jpeg', 'image/png'].includes(file.type)) {
    throw new Error('Yalnızca JPEG veya PNG görseller desteklenir.');
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new Error('Görsel en fazla 20 MB olabilir.');
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Görsel işlenemedi.');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', quality);
}

export async function resizeAvatar(file: File): Promise<string> {
  const dataUrl = await resizeImage(file, 750, 0.86);
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Görsel okunamadı.'));
    image.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = 750;
  canvas.height = 750;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Görsel işlenemedi.');
  const side = Math.min(image.width, image.height);
  context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 750, 750);
  return canvas.toDataURL('image/jpeg', 0.86);
}
