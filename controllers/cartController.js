const cartModel = require('../models/cartModel');
const productModel = require('../models/productModel');

// GET /api/cart
const getCart = async (req, res, next) => {
  try {
    const { rows } = await cartModel.getCartByUser(req.user.id);

    const subtotal = rows.reduce((sum, item) => sum + item.price * item.quantity, 0);

    res.json({ success: true, cart: rows, subtotal: parseFloat(subtotal.toFixed(2)) });
  } catch (err) {
    next(err);
  }
};

// POST /api/cart
const addToCart = async (req, res, next) => {
  try {
    const { product_id, quantity = 1 } = req.body;

    // Validate product exists and has stock
    const { rows: product } = await productModel.getById(product_id);
    if (!product.length) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    if (product[0].stock < quantity) {
      return res.status(400).json({ success: false, message: 'Insufficient stock' });
    }

    const { rows } = await cartModel.addItem(req.user.id, product_id, quantity);
    res.status(201).json({ success: true, message: 'Item added to cart', item: rows[0] });
  } catch (err) {
    next(err);
  }
};

// PUT /api/cart/:id
const updateCartItem = async (req, res, next) => {
  try {
    const { quantity } = req.body;
    if (!quantity || quantity < 1) {
      return res.status(400).json({ success: false, message: 'Quantity must be at least 1' });
    }

    const { rows: existing } = await cartModel.getCartItemById(req.params.id, req.user.id);
    if (!existing.length) {
      return res.status(404).json({ success: false, message: 'Cart item not found' });
    }

    // Stock check
    const { rows: product } = await productModel.getById(existing[0].product_id);
    if (product[0].stock < quantity) {
      return res.status(400).json({ success: false, message: 'Insufficient stock' });
    }

    const { rows } = await cartModel.updateItem(req.params.id, req.user.id, quantity);
    res.json({ success: true, message: 'Cart updated', item: rows[0] });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/cart/:id
const removeCartItem = async (req, res, next) => {
  try {
    const { rows } = await cartModel.removeItem(req.params.id, req.user.id);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Cart item not found' });
    }
    res.json({ success: true, message: 'Item removed from cart' });
  } catch (err) {
    next(err);
  }
};

module.exports = { getCart, addToCart, updateCartItem, removeCartItem };
