# What to Grow Now — Implementation Guide

## Purpose

The planner at `/what-to-grow-now` gives public, India-aware home-gardening recommendations without adding any Admin workload. Growing knowledge is stored in version-controlled backend JSON. Live price, stock, image and product links are resolved from the existing product catalog.

The feature does not use live weather, browser geolocation, AI-generated advice or agricultural chemical recommendations.

## Architecture

- `data/growing-regions.json`: seven simplified customer regions.
- `data/growing-locations.json`: supported city/state/alias to region mappings.
- `data/growing-calendar.json`: 36 crops with care, sowing, timeline, regional month and source data.
- `data/growing-product-aliases.json`: exact-word aliases used to connect existing catalog products.
- `data/growing-tool-rules.json`: space, sowing-method and climber support-product keywords.
- `services/growingGuideService.js`: startup validation, location search, recommendation rules and catalog matching.
- `models/growingPlanModel.js`: authenticated saved-plan persistence and the 20-plan limit.
- `routes/growingRoutes.js`: public recommendation routes and protected saved-plan routes.
- Customer UI: `green-FE/app/what-to-grow-now` and `green-FE/components/growing/GrowingPlanner.tsx`.

No Green Admin files or product fields are required by this feature.

## Public behavior

The customer selects a supported city or one of seven regions, month, space, crop type and experience. Beginner mode includes beginner crops only. Experienced mode includes every difficulty.

The service returns exact-month crops first. When none exist, it checks only the next two months and labels the response as coming soon. It never changes location, space, crop type or experience silently.

Product matching uses complete normalized phrases. Seed products rank above live plants; in-stock and featured products rank higher. `Tomatillo` does not match `tomato`, and categories such as `other` cannot become a primary seed/plant result. Planters, tools and support products use separate keyword rules.

A crop remains visible when no catalog product matches. This keeps seasonal guidance complete without inventing a store relationship.

## API reference

### `GET /api/growing/options`

Returns dataset version, regions, months, spaces, crop types and experience choices. Publicly cached.

### `GET /api/growing/locations?search=Bangalore`

Requires 2–60 characters and returns at most 20 city matches, including aliases and their mapped region.

### `GET /api/growing/recommendations`

Required query values:

- `locationId` or `region`
- `month=1..12`
- `space=indoor|balcony|terrace|garden`
- `type=vegetable|herb|flower`
- `experience=beginner|experienced`
- Optional `page` and `limit`; limit cannot exceed 24.

Returns the resolved location/region, result month, total, crop guidance, primary/alternative catalog products and support products. Product price and stock are current at request time.

### Saved plans

- `POST /api/growing/plans` requires authentication and the same filters; `name` is optional and limited to 80 characters.
- `GET /api/growing/plans` returns only the authenticated user's plans.
- `DELETE /api/growing/plans/:id` deletes only a plan owned by the authenticated user.

The backend recomputes results before saving. It never accepts product price, stock or crop descriptions from the browser. Each user may save 20 plans, with at most 50 crop slugs per plan.

## Neon deployment

Run exactly one new migration on an existing Neon database:

```text
migrations/growing_plans.sql
```

Do not rerun `schema/schema.sql` on an existing database. It is updated only for future clean installations. The migration is idempotent and creates `saved_growing_plans` plus its user/date index.

Recommendations work without the migration; only authenticated saving needs the table.

## Updating guidance later

1. Change the applicable JSON file; do not add Admin fields.
2. Increase the dataset version consistently when recommendation meaning changes.
3. Keep crop slugs stable so saved plans can reopen.
4. Add a new slug only with complete care, spaces, timings, all seven region calendars, aliases and an HTTPS reviewed source.
5. Add or correct city aliases without changing a location ID already used in shared URLs.
6. Run `npm test` in `green-BE`; startup validation rejects duplicates, missing fields, invalid months, overlapping ideal/possible months and unsafe source URLs.
7. Run the Green FE lint/build before deployment.

## Important cases

- Unsupported city: customer selects a region manually.
- No exact crop: show the next suitable month within two months.
- No result within two months: show a genuine empty state without broadening filters.
- No matching product: show guidance and remove purchase actions.
- Out-of-stock match: show the product as unavailable and prefer an in-stock alternative when one exists.
- Ambiguous product text: do not link it.
- Anonymous customer: planner and link sharing work; saving redirects to login with the current URL.
- Dataset update: saved filters reopen against current guidance; removed crop slugs are reported to the customer.
- Offline customer: preserve selections and show a reconnect message.

## Verification

Backend tests cover dataset validation, city aliases, exact-word matching, false-positive prevention, recommendation filtering, two-month fallback, public route validation, cache headers and saved-route authorization. Production validation also includes the Green FE build and the unchanged Green Admin build.
