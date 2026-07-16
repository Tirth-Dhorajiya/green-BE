const { sendContactEmail } = require('../services/emailService');

const submitContact = async (req, res, next) => {
  try {
    const delivery = await sendContactEmail(req.body);
    res.status(201).json({
      success: true,
      message: delivery.delivered
        ? 'Message sent successfully'
        : 'Message received. Email delivery is not configured in this environment.',
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { submitContact };
