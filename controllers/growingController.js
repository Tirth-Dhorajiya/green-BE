const growingGuide = require('../services/growingGuideService');
const growingPlanModel = require('../models/growingPlanModel');

const filtersFrom = (source) => ({
  locationId: source.locationId || null,
  region: source.region || null,
  month: Number(source.month),
  space: source.space,
  type: source.type,
  experience: source.experience,
});

const getOptions = (_req, res) => {
  res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  res.json({ success: true, ...growingGuide.getOptions() });
};

const getLocations = (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  res.json({ success: true, locations: growingGuide.searchLocations(req.query.search) });
};

const getRecommendations = async (req, res, next) => {
  try {
    const result = await growingGuide.buildRecommendations(filtersFrom(req.query), {
      page: req.query.page,
      limit: req.query.limit,
    });
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=180');
    res.json({ success: true, ...result });
  } catch (error) { next(error); }
};

const createPlan = async (req, res, next) => {
  try {
    const result = await growingGuide.buildRecommendations(filtersFrom(req.body), { page: 1, limit: 24 });
    if (!result.recommendations.length) {
      return res.status(400).json({ success: false, message: 'There are no recommendations to save for this selection' });
    }
    const defaultName = `${result.selection.type[0].toUpperCase()}${result.selection.type.slice(1)} plan for ${result.selection.month_name}`;
    const { rows } = await growingPlanModel.create({
      userId: req.user.id,
      name: String(req.body.name || defaultName).trim().slice(0, 80),
      filters: filtersFrom(req.body),
      cropSlugs: result.recommendations.map((crop) => crop.slug).slice(0, 50),
      datasetVersion: result.dataset_version,
    });
    res.status(201).json({ success: true, message: 'Growing plan saved', plan: rows[0] });
  } catch (error) { next(error); }
};

const listPlans = async (req, res, next) => {
  try {
    const { rows } = await growingPlanModel.listByUser(req.user.id);
    const activeSlugs = growingGuide.getCropSlugs();
    const plans = rows.map((plan) => ({
      ...plan,
      missing_crop_slugs: (plan.crop_slugs || []).filter((slug) => !activeSlugs.has(slug)),
    }));
    res.json({ success: true, plans });
  } catch (error) { next(error); }
};

const deletePlan = async (req, res, next) => {
  try {
    const { rows } = await growingPlanModel.deleteByUser(req.params.id, req.user.id);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Growing plan not found' });
    res.json({ success: true, message: 'Growing plan deleted' });
  } catch (error) { next(error); }
};

module.exports = { getOptions, getLocations, getRecommendations, createPlan, listPlans, deletePlan };
