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

// GET /api/admin/customers
const getCustomers = async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;

    const { rows } = await userModel.getAllUsers({ limit: limitNum, offset });
    const totalCount = rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0;
    const customers = rows.map(({ total_count, ...customer }) => customer);

    res.json({
      success: true,
      page: pageNum,
      limit: limitNum,
      totalCount,
      totalPages: Math.ceil(totalCount / limitNum),
      customers,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getDashboardStats, getCustomers };
