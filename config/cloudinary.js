const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

if (process.env.CLOUDINARY_URL) {
  cloudinary.config({
    secure: true
  });
} else {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
}

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'green-website',
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
    transformation: [
      { width: 1200, height: 1200, crop: 'limit' },
      { fetch_format: 'auto', quality: 'auto' }
    ]
  }
});

// Allow up to 10 images per product
const uploadCloud = multer({
  storage,
  limits: {
    files: 10,
    fileSize: 5 * 1024 * 1024,
  },
});

module.exports = { cloudinary, storage, uploadCloud };
