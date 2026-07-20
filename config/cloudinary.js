const cloudinary = require('cloudinary').v2;
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

const createStorage = (folder) => ({
  _handleFile(_req, file, cb) {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        transformation: [
          { width: 1200, height: 1200, crop: 'limit' },
          { fetch_format: 'auto', quality: 'auto' },
        ],
      },
      (error, result) => {
        if (error) return cb(error);

        cb(null, {
          path: result.secure_url,
          filename: result.public_id,
          public_id: result.public_id,
          size: result.bytes,
        });
      }
    );

    file.stream.pipe(uploadStream);
  },

  _removeFile(_req, file, cb) {
    const publicId = file.public_id || file.filename;
    if (!publicId) return cb(null);

    cloudinary.uploader.destroy(publicId)
      .then(() => cb(null))
      .catch(cb);
  },
});

const storage = createStorage('green-website');
const reviewStorage = createStorage('green-website/reviews');

const fileFilter = (_req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (allowed.includes(file.mimetype)) return cb(null, true);
  const error = new Error('Only JPEG, PNG, WebP, and GIF images are allowed');
  error.statusCode = 400;
  return cb(error, false);
};

// Allow up to 10 images per product
const uploadCloud = multer({
  storage,
  fileFilter,
  limits: {
    files: 10,
    fileSize: 5 * 1024 * 1024,
  },
});

const reviewFileFilter = (_req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (allowed.includes(file.mimetype)) return cb(null, true);
  const error = new Error('Review photos must be JPEG, PNG, or WebP images');
  error.statusCode = 400;
  return cb(error, false);
};

const uploadReviewCloud = multer({
  storage: reviewStorage,
  fileFilter: reviewFileFilter,
  limits: {
    files: 5,
    fileSize: 5 * 1024 * 1024,
  },
});

module.exports = { cloudinary, storage, reviewStorage, uploadCloud, uploadReviewCloud };
