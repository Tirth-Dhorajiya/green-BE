const couponModel = require('../models/couponModel');

const validateCoupon = async (req, res, next) => {
  try {
    const subtotal = Number(req.body.subtotal || 0);
    if (!subtotal || subtotal < 0) {
      return res.status(400).json({ success: false, message: 'Valid subtotal is required' });
    }

    const { rows } = await couponModel.findActiveByCode(req.body.code);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Coupon is invalid or expired' });
    }

    const coupon = rows[0];
    const discount = couponModel.calculateDiscount(coupon, subtotal);
    if (discount <= 0) {
      return res.status(400).json({
        success: false,
        message: `Minimum order amount is ${Number(coupon.min_order_amount).toFixed(2)}`,
      });
    }

    res.json({
      success: true,
      coupon: {
        code: coupon.code,
        description: coupon.description,
        discount,
      },
      total: Number((subtotal - discount).toFixed(2)),
    });
  } catch (err) {
    next(err);
  }
};

const getAdminCoupons = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      type,
      sortBy = 'created_at',
      order = 'desc',
    } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;

    const { rows } = await couponModel.getAll({ limit: limitNum, offset, search, status, type, sortBy, order });
    const totalCount = rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0;
    const coupons = rows.map(({ total_count, ...coupon }) => coupon);

    res.json({
      success: true,
      page: pageNum,
      limit: limitNum,
      totalCount,
      totalPages: Math.ceil(totalCount / limitNum),
      coupons,
    });
  } catch (err) {
    next(err);
  }
};

const createAdminCoupon = async (req, res, next) => {
  try {
    const { rows } = await couponModel.create(req.body);
    res.status(201).json({ success: true, coupon: rows[0] });
  } catch (err) {
    next(err);
  }
};

const updateAdminCoupon = async (req, res, next) => {
  try {
    const { rows } = await couponModel.update(req.params.id, req.body);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Coupon not found' });
    }
    res.json({ success: true, coupon: rows[0] });
  } catch (err) {
    next(err);
  }
};

module.exports = { validateCoupon, getAdminCoupons, createAdminCoupon, updateAdminCoupon };
