const productModel = require('../models/productModel');
const wishlistModel = require('../models/wishlistModel');

const getWishlist = async (req, res, next) => {
  try {
    const { rows } = await wishlistModel.getByUser(req.user.id);
    res.json({ success: true, wishlist: rows });
  } catch (err) {
    next(err);
  }
};

const addToWishlist = async (req, res, next) => {
  try {
    const { product_id } = req.body;
    const { rows: products } = await productModel.getById(product_id);
    if (!products.length) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    await wishlistModel.add(req.user.id, product_id);
    const { rows } = await wishlistModel.getByUser(req.user.id);
    res.status(201).json({ success: true, wishlist: rows });
  } catch (err) {
    next(err);
  }
};

const removeFromWishlist = async (req, res, next) => {
  try {
    await wishlistModel.remove(req.user.id, req.params.productId);
    const { rows } = await wishlistModel.getByUser(req.user.id);
    res.json({ success: true, wishlist: rows });
  } catch (err) {
    next(err);
  }
};

module.exports = { getWishlist, addToWishlist, removeFromWishlist };
