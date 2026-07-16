const productModel = require('../models/productModel');
const { cloudinary } = require('../config/cloudinary');

const parseBoolean = (value) => value === true || value === 'true' || value === '1';

const normalizeImages = (images = []) => images.map((img, index) => ({
  url: img.url,
  public_id: img.public_id || img.publicId || null,
  is_default: !!img.is_default,
  is_thumbnail: !!img.is_thumbnail,
  sort_order: Number.isInteger(img.sort_order) ? img.sort_order : index,
}));

const imagesFromFiles = (files, defaultIndex, thumbnailIndex) => files.map((file, index) => ({
  url: file.path,
  public_id: file.filename || file.public_id || null,
  is_default: index === defaultIndex,
  is_thumbnail: index === thumbnailIndex,
  sort_order: index,
}));

const getImageUrls = (images) => {
  const defaultImage = images.find((img) => img.is_default) || images[0];
  const thumbnailImage = images.find((img) => img.is_thumbnail) || defaultImage;
  return {
    image_url: defaultImage?.url || null,
    thumbnail_url: thumbnailImage?.url || defaultImage?.url || null,
  };
};

const destroyCloudinaryImages = async (images = []) => {
  const publicIds = images.map((img) => img.public_id).filter(Boolean);
  await Promise.all(publicIds.map((publicId) => cloudinary.uploader.destroy(publicId).catch(() => null)));
};

// GET /api/products
const getAllProducts = async (req, res, next) => {
  try {
    const {
      category, minPrice, maxPrice, search, featured, stockStatus,
      page = 1, limit = 10, sortBy = 'created_at', order = 'desc',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;

    const { rows } = await productModel.getAllProducts({
      category,
      minPrice: minPrice !== undefined ? parseFloat(minPrice) : undefined,
      maxPrice: maxPrice !== undefined ? parseFloat(maxPrice) : undefined,
      search, featured, stockStatus, limit: limitNum, offset, sortBy, order,
    });

    const totalCount = rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0;
    const products = rows.map(({ total_count, ...p }) => p);

    res.json({ success: true, page: pageNum, limit: limitNum, totalCount, totalPages: Math.ceil(totalCount / limitNum), products });
  } catch (err) { next(err); }
};

// GET /api/products/:id
const getProduct = async (req, res, next) => {
  try {
    const { rows } = await productModel.getById(req.params.id);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Product not found' });
    res.json({ success: true, product: rows[0] });
  } catch (err) { next(err); }
};

// POST /api/products (admin)
const addProduct = async (req, res, next) => {
  try {
    const { name, description, price, category, stock, is_featured } = req.body;

    // req.files is an array when using .array('images', 10)
    const uploadedFiles = req.files || (req.file ? [req.file] : []);

    // Build images array with default/thumbnail flags from client
    // Client sends: defaultIndex (number), thumbnailIndex (number)
    const defaultIndex = parseInt(req.body.defaultIndex || '0', 10);
    const thumbnailIndex = parseInt(req.body.thumbnailIndex || '0', 10);

    const images = imagesFromFiles(uploadedFiles, defaultIndex, thumbnailIndex);

    // Primary image_url is the default one
    const { image_url, thumbnail_url } = getImageUrls(images);

    const { rows } = await productModel.createProduct({
      name,
      description,
      price,
      category,
      stock: stock || 0,
      image_url,
      thumbnail_url,
      images,
      is_featured: parseBoolean(is_featured),
    });

    res.status(201).json({ success: true, message: 'Product added', product: rows[0] });
  } catch (err) { next(err); }
};

// PUT /api/products/:id (admin)
const updateProduct = async (req, res, next) => {
  try {
    const { rows: existing } = await productModel.getById(req.params.id);
    if (!existing.length) return res.status(404).json({ success: false, message: 'Product not found' });

    const updatable = ['name', 'description', 'price', 'category', 'stock', 'is_featured'];
    const fields = {};
    updatable.forEach((key) => {
      if (req.body[key] !== undefined) fields[key] = req.body[key];
    });

    const uploadedFiles = req.files || (req.file ? [req.file] : []);

    if (uploadedFiles.length > 0) {
      const defaultIndex = parseInt(req.body.defaultIndex || '0', 10);
      const thumbnailIndex = parseInt(req.body.thumbnailIndex || '0', 10);

      // Merge with existing images if keepExisting flag is set
      let existingImages = [];
      if (req.body.keepExistingImages === 'true' && req.body.imagesMetadata) {
        try {
          existingImages = normalizeImages(JSON.parse(req.body.imagesMetadata));
        } catch (_) {
          existingImages = normalizeImages(existing[0].images || []);
        }
      }

      const newImages = imagesFromFiles(uploadedFiles, defaultIndex, thumbnailIndex);

      const allImages = [...existingImages, ...newImages];

      // Reset all flags then apply based on indices within allImages
      allImages.forEach((img, i) => {
        img.is_default = false;
        img.is_thumbnail = false;
      });

      const absoluteDefaultIndex = parseInt(req.body.absoluteDefaultIndex !== undefined ? req.body.absoluteDefaultIndex : defaultIndex, 10);
      const absoluteThumbnailIndex = parseInt(req.body.absoluteThumbnailIndex !== undefined ? req.body.absoluteThumbnailIndex : thumbnailIndex, 10);

      if (allImages[absoluteDefaultIndex]) allImages[absoluteDefaultIndex].is_default = true;
      else if (allImages[0]) allImages[0].is_default = true;

      if (allImages[absoluteThumbnailIndex]) allImages[absoluteThumbnailIndex].is_thumbnail = true;
      else if (allImages[0]) allImages[0].is_thumbnail = true;

      allImages.forEach((img, index) => {
        img.sort_order = index;
      });

      fields.images = allImages;
      const { image_url, thumbnail_url } = getImageUrls(allImages);
      fields.image_url = image_url;
      fields.thumbnail_url = thumbnail_url;
    } else if (req.body.imagesMetadata) {
      // Client sent updated image metadata (e.g. changed default/thumbnail flags only)
      try {
        const updatedImages = normalizeImages(JSON.parse(req.body.imagesMetadata));
        fields.images = updatedImages;
        const { image_url, thumbnail_url } = getImageUrls(updatedImages);
        fields.image_url = image_url;
        fields.thumbnail_url = thumbnail_url;
      } catch (_) {}
    }

    if (fields.images) {
      const previousImages = normalizeImages(existing[0].images || []);
      const nextPublicIds = new Set(fields.images.map((img) => img.public_id).filter(Boolean));
      const removedImages = previousImages.filter((img) => img.public_id && !nextPublicIds.has(img.public_id));
      await destroyCloudinaryImages(removedImages);
    }

    if (!Object.keys(fields).length) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    const { rows } = await productModel.updateProduct(req.params.id, fields);
    res.json({ success: true, message: 'Product updated', product: rows[0] });
  } catch (err) { next(err); }
};

// DELETE /api/products/:id (admin)
const deleteProduct = async (req, res, next) => {
  try {
    const { rows: existing } = await productModel.getById(req.params.id);
    if (!existing.length) return res.status(404).json({ success: false, message: 'Product not found' });

    const { rows } = await productModel.deleteProduct(req.params.id);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Product not found' });
    await destroyCloudinaryImages(normalizeImages(existing[0].images || []));
    res.json({ success: true, message: 'Product deleted' });
  } catch (err) { next(err); }
};

// PUT /api/products/:id/featured (admin)
const setFeaturedProduct = async (req, res, next) => {
  try {
    const { rows } = await productModel.setFeatured(req.params.id, parseBoolean(req.body.is_featured));
    if (!rows.length) return res.status(404).json({ success: false, message: 'Product not found' });
    res.json({ success: true, message: 'Featured status updated', product: rows[0] });
  } catch (err) { next(err); }
};

module.exports = { getAllProducts, getProduct, addProduct, updateProduct, deleteProduct, setFeaturedProduct };
