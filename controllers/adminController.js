const userModel = require('../models/userModel');
const orderModel = require('../models/orderModel');
const productModel = require('../models/productModel');

// GET /api/admin/stats
const getDashboardStats = async (req, res, next) => {
  try {
    const [usersResult, ordersResult, revenueResult, productsResult] = await Promise.all([
      userModel.countUsers(),
      orderModel.countOrders(),
      orderModel.sumRevenue(),
      productModel.countProducts(),
    ]);

    res.json({
      success: true,
      stats: {
        totalUsers: parseInt(usersResult.rows[0].count, 10),
        totalOrders: parseInt(ordersResult.rows[0].count, 10),
        totalRevenue: parseFloat(revenueResult.rows[0].revenue),
        totalProducts: parseInt(productsResult.rows[0].count, 10),
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getDashboardStats };
