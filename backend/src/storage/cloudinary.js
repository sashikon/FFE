const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function uploadImage(filePath) {
  const result = await cloudinary.uploader.upload(filePath, {
    folder: 'ffe/outfits',
    transformation: [{ quality: 'auto', fetch_format: 'auto' }],
  });

  const thumbUrl = cloudinary.url(result.public_id, {
    width: 400,
    height: 533,
    crop: 'fit',
    quality: 'auto',
    fetch_format: 'auto',
  });

  return { imageUrl: result.secure_url, thumbUrl };
}

async function uploadSvg(filePath) {
  const result = await cloudinary.uploader.upload(filePath, {
    folder: 'ffe/svg-layers',
    resource_type: 'image',
    use_filename: true,
    unique_filename: true,
  });
  return result.secure_url;
}

async function uploadScreenshot(filePath) {
  const result = await cloudinary.uploader.upload(filePath, {
    folder: 'ffe/mechanic-screenshots',
    quality: 'auto',
    fetch_format: 'auto',
  });
  return result.secure_url;
}

// Фирменный логотип канала: один и тот же public_id, чтобы адрес наложения не менялся.
// SVG Cloudinary сам переводит в PNG с прозрачностью
const BRAND_LOGO_ID = 'ffe/brand/femuse-logo-white';

async function uploadBrandLogo(filePath) {
  const result = await cloudinary.uploader.upload(filePath, {
    public_id: BRAND_LOGO_ID,
    format: 'png',
    overwrite: true,
    invalidate: true,
    resource_type: 'image',
  });
  return { url: result.secure_url, publicId: BRAND_LOGO_ID, version: result.version, width: result.width, height: result.height };
}

async function brandLogoInfo() {
  try {
    const r = await cloudinary.api.resource(BRAND_LOGO_ID);
    return { url: r.secure_url, publicId: BRAND_LOGO_ID, version: r.version, width: r.width, height: r.height };
  } catch {
    return null;
  }
}

async function deleteImage(publicId) {
  await cloudinary.uploader.destroy(publicId);
}

module.exports = { uploadImage, uploadSvg, uploadScreenshot, deleteImage, uploadBrandLogo, brandLogoInfo, BRAND_LOGO_ID };
