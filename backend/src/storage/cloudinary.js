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

async function deleteImage(publicId) {
  await cloudinary.uploader.destroy(publicId);
}

module.exports = { uploadImage, uploadSvg, deleteImage };
