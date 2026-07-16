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
    const { page = 1, limit = 10, search, role, sortBy = 'created_at', order = 'desc' } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;

    const { rows } = await userModel.getAllUsers({ limit: limitNum, offset, search, role, sortBy, order });
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

// GET /api/admin/customers/:id
const getCustomerDetails = async (req, res, next) => {
  try {
    const [{ rows: customerRows }, { rows: orders }] = await Promise.all([
      userModel.findById(req.params.id),
      orderModel.getCustomerOrdersForAdmin(req.params.id),
    ]);

    if (!customerRows.length) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const summary = orders.reduce(
      (acc, order) => {
        const total = Number(order.total_price || 0);
        const discount = Number(order.discount_amount || 0);

        acc.totalOrders += 1;
        acc.totalSpent += order.status === 'cancelled' ? 0 : total;
        acc.totalDiscount += discount;
        acc.deliveredOrders += order.status === 'delivered' ? 1 : 0;
        acc.paidOrders += order.payment_status === 'paid' ? 1 : 0;
        return acc;
      },
      {
        totalOrders: 0,
        totalSpent: 0,
        totalDiscount: 0,
        deliveredOrders: 0,
        paidOrders: 0,
      }
    );

    res.json({
      success: true,
      customer: customerRows[0],
      summary: {
        ...summary,
        lastOrderAt: orders[0]?.created_at || null,
      },
      orders,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getDashboardStats, getCustomers, getCustomerDetails };
