const orderModel = require('../models/orderModel');
const cartModel = require('../models/cartModel');

// POST /api/orders  — create order from cart
const createOrder = async (req, res, next) => {
  try {
    const { rows: cartItems } = await cartModel.getCartByUser(req.user.id);

    if (!cartItems.length) {
      return res.status(400).json({ success: false, message: 'Cart is empty' });
    }

    // Check stock for all items
    for (const item of cartItems) {
      if (item.stock < item.quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for "${item.name}"`,
        });
      }
    }

    const items = cartItems.map((i) => ({
      product_id: i.product_id,
      quantity: i.quantity,
      price: parseFloat(i.price),
    }));

    const totalPrice = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

    const order = await orderModel.createOrder(req.user.id, totalPrice.toFixed(2), items, {
      shipping_address: req.body.shipping_address || {},
      payment_status: req.body.payment_status || 'pending',
      payment_provider: req.body.payment_provider || 'manual',
    });

    // Clear cart after successful order
    await cartModel.clearCart(req.user.id);

    res.status(201).json({ success: true, message: 'Order placed successfully', order });
  } catch (err) {
    next(err);
  }
};

// GET /api/orders/my
const getUserOrders = async (req, res, next) => {
  try {
    const { rows } = await orderModel.getOrdersByUser(req.user.id);
    res.json({ success: true, orders: rows });
  } catch (err) {
    next(err);
  }
};

// GET /api/orders  (admin)
const getAllOrders = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;

    const { rows } = await orderModel.getAllOrders({ limit: limitNum, offset, status });

    const totalCount = rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0;
    const orders = rows.map(({ total_count, ...o }) => o);

    res.json({
      success: true,
      page: pageNum,
      limit: limitNum,
      totalCount,
      totalPages: Math.ceil(totalCount / limitNum),
      orders,
    });
  } catch (err) {
    next(err);
  }
};

// PUT /api/orders/:id/status  (admin)
const updateOrderStatus = async (req, res, next) => {
  try {
    const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
    const { status } = req.body;

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      });
    }

    const { rows } = await orderModel.updateStatus(req.params.id, status);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    res.json({ success: true, message: 'Order status updated', order: rows[0] });
  } catch (err) {
    next(err);
  }
};

module.exports = { createOrder, getUserOrders, getAllOrders, updateOrderStatus };
