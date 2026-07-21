const calendarData = require('../data/growing-calendar.json');
const regionData = require('../data/growing-regions.json');
const locationData = require('../data/growing-locations.json');
const aliasData = require('../data/growing-product-aliases.json');
const toolRuleData = require('../data/growing-tool-rules.json');
const productModel = require('../models/productModel');

const SPACES = ['indoor', 'balcony', 'terrace', 'garden'];
const CROP_TYPES = ['vegetable', 'herb', 'flower'];
const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];
const EXPERIENCES = ['beginner', 'experienced'];
const METHODS = ['direct-sow', 'nursery', 'transplant'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const fail = (message) => {
  throw new Error(`Growing guide dataset is invalid: ${message}`);
};

const uniqueValues = (values) => new Set(values).size === values.length;
const validMonthList = (months) => Array.isArray(months)
  && uniqueValues(months)
  && months.every((month) => Number.isInteger(month) && month >= 1 && month <= 12);

const validateDatasets = () => {
  const regions = regionData.regions || [];
  const locations = locationData.locations || [];
  const crops = calendarData.crops || [];
  const regionSlugs = regions.map((region) => region.slug);
  const cropSlugs = crops.map((crop) => crop.slug);

  if ([regionData.version, locationData.version, aliasData.version, toolRuleData.version].some((version) => version !== calendarData.version)) fail('all dataset versions must match');

  if (regions.length !== 7 || !uniqueValues(regionSlugs)) fail('exactly seven unique regions are required');
  if (!uniqueValues(locations.map((location) => location.id))) fail('location IDs must be unique');
  if (!uniqueValues(locations.map((location) => `${location.city.toLowerCase()}|${location.state.toLowerCase()}`))) fail('city and state mappings must be unique');
  locations.forEach((location) => {
    if (!location.id || !location.city || !location.state || !regionSlugs.includes(location.region)) fail(`location ${location.id || '(unknown)'} has invalid fields`);
    if (!Array.isArray(location.aliases)) fail(`location ${location.id} aliases must be an array`);
  });

  if (crops.length !== 36 || !uniqueValues(cropSlugs)) fail('exactly 36 unique crops are required');
  const expectedCounts = { vegetable: 18, herb: 8, flower: 10 };
  Object.entries(expectedCounts).forEach(([type, expected]) => {
    if (crops.filter((crop) => crop.type === type).length !== expected) fail(`${type} crop count must be ${expected}`);
  });

  crops.forEach((crop) => {
    if (!crop.slug || !crop.name || !crop.summary || !CROP_TYPES.includes(crop.type)) fail(`${crop.slug || '(unknown)'} has incomplete identity fields`);
    if (!DIFFICULTIES.includes(crop.difficulty)) fail(`${crop.slug} has an invalid difficulty`);
    if (!Array.isArray(crop.aliases) || !crop.aliases.length || !uniqueValues(crop.aliases)) fail(`${crop.slug} needs unique aliases`);
    if (!Array.isArray(crop.spaces) || !crop.spaces.length || crop.spaces.some((space) => !SPACES.includes(space))) fail(`${crop.slug} has invalid spaces`);
    if (!crop.sunlight || !crop.watering || !crop.container || crop.container.diameter_cm <= 0 || crop.container.depth_cm <= 0) fail(`${crop.slug} has incomplete care details`);
    if (!crop.sowing || !METHODS.includes(crop.sowing.method) || crop.sowing.depth_cm < 0 || crop.sowing.spacing_cm <= 0) fail(`${crop.slug} has invalid sowing details`);
    if (!Array.isArray(crop.germination_days) || crop.germination_days.length !== 2 || crop.germination_days[0] > crop.germination_days[1]) fail(`${crop.slug} has invalid germination days`);
    if (!Array.isArray(crop.harvest_days) || crop.harvest_days.length !== 2 || crop.harvest_days[0] > crop.harvest_days[1]) fail(`${crop.slug} has invalid harvest days`);
    if (!Array.isArray(crop.instructions) || crop.instructions.length < 3 || !crop.common_mistake) fail(`${crop.slug} needs complete guidance`);
    if (!crop.source?.title || !crop.source?.publisher || !/^https:\/\//.test(crop.source?.url || '') || !/^\d{4}-\d{2}-\d{2}$/.test(crop.source?.reviewed_at || '')) fail(`${crop.slug} has an invalid source`);
    if (!aliasData.aliases[crop.slug]?.length) fail(`${crop.slug} is missing automatic product aliases`);
    regionSlugs.forEach((regionSlug) => {
      const window = crop.regions?.[regionSlug];
      if (!window || !validMonthList(window.ideal) || !validMonthList(window.possible)) fail(`${crop.slug} has an invalid ${regionSlug} calendar`);
      if (window.ideal.some((month) => window.possible.includes(month))) fail(`${crop.slug} overlaps ideal and possible months for ${regionSlug}`);
    });
  });

  if (!toolRuleData.rules?.spaces || !toolRuleData.rules?.methods || !Array.isArray(toolRuleData.rules?.climber)) fail('tool rules are incomplete');
  return { regions: regions.length, locations: locations.length, crops: crops.length, version: calendarData.version };
};

const validationSummary = validateDatasets();
const regionBySlug = new Map(regionData.regions.map((region) => [region.slug, region]));
const locationById = new Map(locationData.locations.map((location) => [location.id, location]));
const cropBySlug = new Map(calendarData.crops.map((crop) => [crop.slug, crop]));

const normalizeSearchText = (value = '') => String(value)
  .normalize('NFKD')
  .replace(/<[^>]*>/g, ' ')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\b(?:seed|seeds|plant|plants|pack|packet|pcs|piece|pieces|gm|gram|grams|kg)\b/g, ' ')
  .replace(/\b\d+(?:\.\d+)?\b/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const hasWholePhrase = (text, phrase) => {
  const normalizedText = ` ${normalizeSearchText(text)} `;
  const normalizedPhrase = normalizeSearchText(phrase);
  return Boolean(normalizedPhrase) && normalizedText.includes(` ${normalizedPhrase} `);
};

const safeProduct = (product) => ({
  id: product.id,
  name: product.name,
  price: product.price,
  category: product.category,
  image_url: product.image_url,
  thumbnail_url: product.thumbnail_url,
  stock: Number(product.stock || 0),
  is_featured: product.is_featured === true,
});

const productScore = (crop, product) => {
  if (!['seeds', 'plants'].includes(product.category)) return -1;
  const aliases = aliasData.aliases[crop.slug] || crop.aliases;
  const normalizedName = normalizeSearchText(product.name);
  const normalizedDescription = normalizeSearchText(product.description);
  let matchScore = -1;

  aliases.forEach((alias) => {
    const normalizedAlias = normalizeSearchText(alias);
    if (!normalizedAlias) return;
    if (normalizedName === normalizedAlias) matchScore = Math.max(matchScore, 100);
    else if (hasWholePhrase(normalizedName, normalizedAlias)) matchScore = Math.max(matchScore, 80);
    else if (hasWholePhrase(normalizedDescription, normalizedAlias)) matchScore = Math.max(matchScore, 35);
  });

  if (matchScore < 0) return -1;
  return matchScore
    + (product.category === 'seeds' ? 25 : 15)
    + (Number(product.stock) > 0 ? 30 : 0)
    + (product.is_featured === true ? 5 : 0);
};

const matchCropProducts = (crop, products) => products
  .map((product) => ({ product, score: productScore(crop, product) }))
  .filter(({ score }) => score >= 0)
  .sort((a, b) => b.score - a.score || new Date(b.product.created_at || 0) - new Date(a.product.created_at || 0))
  .slice(0, 4)
  .map(({ product }) => safeProduct(product));

const supportKeywordsFor = (crop, space) => [
  ...(toolRuleData.rules.spaces[space] || []),
  ...(toolRuleData.rules.methods[crop.sowing.method] || []),
  ...(crop.is_climber ? toolRuleData.rules.climber : []),
];

const matchSupportProducts = (crop, space, products) => {
  const keywords = supportKeywordsFor(crop, space);
  return products
    .filter((product) => ['tools', 'planters', 'other'].includes(product.category))
    .map((product) => {
      const searchText = `${product.name} ${product.description || ''}`;
      const matches = keywords.filter((keyword) => hasWholePhrase(searchText, keyword)).length;
      return {
        product,
        score: matches * 25 + (Number(product.stock) > 0 ? 20 : 0) + (product.is_featured === true ? 5 : 0),
      };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || String(a.product.name).localeCompare(String(b.product.name)))
    .slice(0, 3)
    .map(({ product }) => safeProduct(product));
};

const searchLocations = (search) => {
  const query = normalizeSearchText(search);
  if (query.length < 2) return [];
  return locationData.locations
    .filter((location) => [location.city, location.state, ...(location.aliases || [])]
      .some((value) => normalizeSearchText(value).includes(query)))
    .sort((a, b) => a.city.localeCompare(b.city) || a.state.localeCompare(b.state))
    .slice(0, 20)
    .map((location) => ({ ...location, region_name: regionBySlug.get(location.region).name }));
};

const getRegionSelection = ({ locationId, region }) => {
  if (locationId) {
    const location = locationById.get(locationId);
    if (!location) {
      const error = new Error('This city is not currently supported. Choose a climate region instead.');
      error.statusCode = 400;
      throw error;
    }
    return { region: regionBySlug.get(location.region), location };
  }
  const selectedRegion = regionBySlug.get(region);
  if (!selectedRegion) {
    const error = new Error('Choose a supported city or climate region');
    error.statusCode = 400;
    throw error;
  }
  return { region: selectedRegion, location: null };
};

const validateRecommendationFilters = (filters) => {
  const month = Number(filters.month);
  if (!Number.isInteger(month) || month < 1 || month > 12) throw Object.assign(new Error('Month must be between 1 and 12'), { statusCode: 400 });
  if (!SPACES.includes(filters.space)) throw Object.assign(new Error('Growing space is invalid'), { statusCode: 400 });
  if (!CROP_TYPES.includes(filters.type)) throw Object.assign(new Error('Crop type is invalid'), { statusCode: 400 });
  if (!EXPERIENCES.includes(filters.experience)) throw Object.assign(new Error('Experience level is invalid'), { statusCode: 400 });
  return { ...filters, month };
};

const candidatesForMonth = ({ region, month, space, type, experience }) => calendarData.crops
  .filter((crop) => crop.type === type)
  .filter((crop) => crop.spaces.includes(space))
  .filter((crop) => experience === 'experienced' || crop.difficulty === 'beginner')
  .map((crop) => {
    const window = crop.regions[region];
    const suitability = window.ideal.includes(month) ? 'ideal' : window.possible.includes(month) ? 'possible' : null;
    return suitability ? { crop, suitability } : null;
  })
  .filter(Boolean);

const nextMonth = (month, offset) => ((month - 1 + offset) % 12) + 1;

const buildRecommendations = async (rawFilters, { page = 1, limit = 12 } = {}) => {
  const filters = validateRecommendationFilters(rawFilters);
  const selection = getRegionSelection(filters);
  let candidateMonth = filters.month;
  let comingSoon = false;
  let candidates = candidatesForMonth({ ...filters, region: selection.region.slug, month: candidateMonth });

  if (!candidates.length) {
    for (let offset = 1; offset <= 2 && !candidates.length; offset += 1) {
      candidateMonth = nextMonth(filters.month, offset);
      candidates = candidatesForMonth({ ...filters, region: selection.region.slug, month: candidateMonth });
      comingSoon = candidates.length > 0;
    }
  }

  const { rows: products } = await productModel.getGrowingCandidates();
  const enriched = candidates.map(({ crop, suitability }) => {
    const matchedProducts = matchCropProducts(crop, products);
    const primaryProduct = matchedProducts[0] || null;
    return {
      ...crop,
      aliases: undefined,
      regions: undefined,
      source: crop.source,
      suitability,
      coming_soon: comingSoon,
      recommended_month: candidateMonth,
      why: `${crop.name} suits ${selection.region.name}, ${spaceLabel(filters.space)} growing and a ${experienceLabel(filters.experience)} gardener in ${MONTHS[candidateMonth - 1]}.`,
      primary_product: primaryProduct,
      alternative_products: matchedProducts.slice(1),
      support_products: matchSupportProducts(crop, filters.space, products),
      has_in_stock_product: Boolean(primaryProduct && primaryProduct.stock > 0),
    };
  }).sort((a, b) => {
    if (a.suitability !== b.suitability) return a.suitability === 'ideal' ? -1 : 1;
    if (a.has_in_stock_product !== b.has_in_stock_product) return a.has_in_stock_product ? -1 : 1;
    return b.display_priority - a.display_priority || a.name.localeCompare(b.name);
  });

  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(24, Math.max(1, Number(limit) || 12));
  const start = (safePage - 1) * safeLimit;
  return {
    dataset_version: calendarData.version,
    selection: {
      location: selection.location ? { id: selection.location.id, city: selection.location.city, state: selection.location.state } : null,
      region: selection.region,
      month: filters.month,
      month_name: MONTHS[filters.month - 1],
      result_month: candidateMonth,
      result_month_name: MONTHS[candidateMonth - 1],
      space: filters.space,
      type: filters.type,
      experience: filters.experience,
    },
    page: safePage,
    limit: safeLimit,
    total_count: enriched.length,
    total_pages: Math.ceil(enriched.length / safeLimit),
    coming_soon: comingSoon,
    recommendations: enriched.slice(start, start + safeLimit),
  };
};

const spaceLabel = (space) => ({ indoor: 'indoor', balcony: 'balcony', terrace: 'terrace', garden: 'garden' }[space] || space);
const experienceLabel = (experience) => experience === 'beginner' ? 'beginner' : 'more experienced';

const getOptions = () => ({
  dataset_version: calendarData.version,
  regions: regionData.regions,
  months: MONTHS.map((name, index) => ({ value: index + 1, name })),
  spaces: SPACES,
  crop_types: CROP_TYPES,
  experience_levels: EXPERIENCES,
});

const getCropSlugs = () => new Set(calendarData.crops.map((crop) => crop.slug));

module.exports = {
  MONTHS,
  validationSummary,
  validateDatasets,
  normalizeSearchText,
  hasWholePhrase,
  matchCropProducts,
  searchLocations,
  validateRecommendationFilters,
  candidatesForMonth,
  buildRecommendations,
  getOptions,
  getCropSlugs,
};
