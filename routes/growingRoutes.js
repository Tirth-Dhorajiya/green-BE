const express = require('express');
const { body, param, query } = require('express-validator');
const validate = require('../middleware/validate');
const { protect } = require('../middleware/authMiddleware');
const { getOptions, getLocations, getRecommendations, createPlan, listPlans, deletePlan } = require('../controllers/growingController');

const router = express.Router();
const filterQueryRules = [
  query('locationId').optional({ checkFalsy: true }).isLength({ max: 120 }),
  query('region').optional({ checkFalsy: true }).isIn(['north-plains', 'himalayan-hill', 'western-arid', 'central-plateau', 'eastern-humid', 'southern-tropical', 'coastal']),
  query('month').isInt({ min: 1, max: 12 }),
  query('space').isIn(['indoor', 'balcony', 'terrace', 'garden']),
  query('type').isIn(['vegetable', 'herb', 'flower']),
  query('experience').isIn(['beginner', 'experienced']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 24 }),
];
const filterBodyRules = [
  body('locationId').optional({ checkFalsy: true }).isLength({ max: 120 }),
  body('region').optional({ checkFalsy: true }).isIn(['north-plains', 'himalayan-hill', 'western-arid', 'central-plateau', 'eastern-humid', 'southern-tropical', 'coastal']),
  body('month').isInt({ min: 1, max: 12 }),
  body('space').isIn(['indoor', 'balcony', 'terrace', 'garden']),
  body('type').isIn(['vegetable', 'herb', 'flower']),
  body('experience').isIn(['beginner', 'experienced']),
];

router.get('/options', getOptions);
router.get('/locations', [query('search').trim().isLength({ min: 2, max: 60 }).withMessage('Search must contain 2 to 60 characters')], validate, getLocations);
router.get('/recommendations', filterQueryRules, validate, getRecommendations);
router.post('/plans', protect, [body('name').optional().trim().isLength({ min: 1, max: 80 }), ...filterBodyRules], validate, createPlan);
router.get('/plans', protect, listPlans);
router.delete('/plans/:id', protect, [param('id').isUUID().withMessage('Plan ID must be valid')], validate, deletePlan);

module.exports = router;
