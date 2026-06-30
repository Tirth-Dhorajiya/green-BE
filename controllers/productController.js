const productModel = require('../models/productModel');

// GET /api/products
const getAllProducts = async (req, res, next) => {
  try {
    const {
      category, minPrice, maxPrice, search,
      page = 1, limit = 10, sortBy = 'created_at', order = 'desc',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;

    const { rows } = await productModel.getAllProducts({
      category,
      minPrice: minPrice !== undefined ? parseFloat(minPrice) : undefined,
      maxPrice: maxPrice !== undefined ? parseFloat(maxPrice) : undefined,
      search, limit: limitNum, offset, sortBy, order,
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
    const { name, description, price, category, stock } = req.body;

    // req.files is an array when using .array('images', 10)
    const uploadedFiles = req.files || (req.file ? [req.file] : []);

    // Build images array with default/thumbnail flags from client
    // Client sends: defaultIndex (number), thumbnailIndex (number)
    const defaultIndex = parseInt(req.body.defaultIndex || '0', 10);
    const thumbnailIndex = parseInt(req.body.thumbnailIndex || '0', 10);

    const images = uploadedFiles.map((file, i) => ({
      url: file.path,
      is_default: i === defaultIndex,
      is_thumbnail: i === thumbnailIndex,
    }));

    // Primary image_url is the default one
    const defaultImage = images.find(img => img.is_default);
    const image_url = defaultImage ? defaultImage.url : (images[0]?.url || null);

    const { rows } = await productModel.createProduct({
      name, description, price, category, stock: stock || 0, image_url, images,
    });

    res.status(201).json({ success: true, message: 'Product added', product: rows[0] });
  } catch (err) { next(err); }
};

// PUT /api/products/:id (admin)
const updateProduct = async (req, res, next) => {
  try {
    const { rows: existing } = await productModel.getById(req.params.id);
    if (!existing.length) return res.status(404).json({ success: false, message: 'Product not found' });

    const updatable = ['name', 'description', 'price', 'category', 'stock'];
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
          existingImages = JSON.parse(req.body.imagesMetadata);
        } catch (_) {
          existingImages = existing[0].images || [];
        }
      }

      const newImages = uploadedFiles.map((file, i) => ({
        url: file.path,
        is_default: i === defaultIndex,
        is_thumbnail: i === thumbnailIndex,
      }));

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

      fields.images = allImages;
      const defaultImage = allImages.find(img => img.is_default);
      fields.image_url = defaultImage ? defaultImage.url : allImages[0]?.url;
    } else if (req.body.imagesMetadata) {
      // Client sent updated image metadata (e.g. changed default/thumbnail flags only)
      try {
        const updatedImages = JSON.parse(req.body.imagesMetadata);
        fields.images = updatedImages;
        const defaultImage = updatedImages.find((img) => img.is_default);
        if (defaultImage) fields.image_url = defaultImage.url;
      } catch (_) {}
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
    const { rows } = await productModel.deleteProduct(req.params.id);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Product not found' });
    res.json({ success: true, message: 'Product deleted' });
  } catch (err) { next(err); }
};

module.exports = { getAllProducts, getProduct, addProduct, updateProduct, deleteProduct };
