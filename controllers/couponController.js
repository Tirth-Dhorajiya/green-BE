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

const getAdminCoupons = async (_req, res, next) => {
  try {
    const { rows } = await couponModel.getAll();
    res.json({ success: true, coupons: rows });
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
