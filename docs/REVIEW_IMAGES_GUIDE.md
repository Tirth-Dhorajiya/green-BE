# Customer Review Images — Implementation and Operations Guide

This guide documents the implemented review-photo workflow across `green-BE`, `green-FE`, and `green-admin` for future maintenance and deployment.

## Implemented behavior

- Only an authenticated customer with an unreviewed, paid, delivered order containing the product can submit a review.
- A review may contain zero to five photos.
- Accepted formats are JPEG, PNG, and WebP, with a maximum size of 5 MB per photo.
- Text, rating, and photos are submitted in one multipart request.
- Images are uploaded to the `green-website/reviews` Cloudinary folder.
- Review and image database rows are created in one PostgreSQL transaction.
- If validation or database creation fails after upload, the uploaded Cloudinary assets are removed.
- Public product APIs return only photos whose review and individual image are both visible.
- The customer UI provides local thumbnail previews, removal before submission, optimized review thumbnails, and a full-size lightbox.
- Admin can open every photo, independently hide/show it, or permanently delete it after confirmation.
- Permanent photo deletion removes both the Cloudinary asset and database row.
- Permanent product deletion also cleans up Cloudinary assets belonging to its reviews before database cascade removal.
- Return-evidence attachments are not queried, copied, or reused by the review workflow.

## Database migration

For an existing Neon database, run only:

```sql
-- green-BE/migrations/review_images.sql
```

The migration creates `review_images`, its constraints, and indexes. It is idempotent through `IF NOT EXISTS`. Do not rerun `schema/schema.sql` on an existing database for this feature. `schema/schema.sql` has also been updated so a brand-new database includes this table.

After this feature, the full ordered migration set is:

1. `commerce_completion.sql`
2. `add_product_images.sql`
3. `order_fulfillment_tracking.sql`
4. `shipping_integration.sql`
5. `returns_refunds.sql`
6. `review_images.sql`

Use the full list only for a database that has not already received the earlier migrations.

## Environment requirements

The backend uses its existing Cloudinary configuration:

```text
CLOUDINARY_URL
```

or all three individual values:

```text
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
```

These values must remain backend-only. No customer or admin response contains Cloudinary API credentials or image `public_id` values.

## API contract

### Submit a customer review

`POST /api/products/:id/reviews`

- Authentication: customer bearer token required.
- Content type: `multipart/form-data`.
- Fields: `rating`, optional `comment`, and repeated `images` file fields.
- Authorization and purchase eligibility are checked before files are accepted.

### Read product reviews

`GET /api/products/:id/reviews?page=1&limit=10`

Each visible review may contain:

```json
{
  "images": [
    { "id": "uuid", "url": "https://...", "sort_order": 0 }
  ]
}
```

Hidden image rows and internal Cloudinary identifiers are omitted.

### Admin photo moderation

- `PUT /api/admin/reviews/:reviewId/images/:imageId/status`
  - Body: `{ "status": "visible" }` or `{ "status": "hidden" }`
- `DELETE /api/admin/reviews/:reviewId/images/:imageId`
  - Permanently removes the provider asset and database row.

Both endpoints require admin authentication and validate both UUIDs.

## Important cases

| Case | Implemented result |
|---|---|
| Unauthenticated submission | Rejected before upload |
| Order is not both paid and delivered | Rejected before upload |
| Customer already reviewed that order/product | Eligibility is false and submission is rejected |
| No photos selected | Text/rating review works normally |
| More than five photos | Client blocks it and backend enforces the limit |
| Unsupported image format | Client warns and backend returns a 400 response |
| Photo larger than 5 MB | Client warns and backend returns a 400 response |
| Customer removes a preview | File is excluded before the request; nothing is uploaded |
| Database review creation fails | Uploaded Cloudinary files are cleaned up |
| Review is hidden | Review and all of its photos disappear publicly |
| One photo is hidden | Only that photo disappears publicly |
| Admin deletes one photo | Confirmation is required, then Cloudinary and DB are updated |
| Product is permanently deleted | Associated product and review Cloudinary images are cleaned up |
| Review pagination | Remains at ten reviews per page, including their image arrays |
| Return evidence exists | It remains separate and is never reused automatically |

## Main files

Backend:

- `green-BE/migrations/review_images.sql`
- `green-BE/config/cloudinary.js`
- `green-BE/controllers/reviewController.js`
- `green-BE/models/reviewModel.js`
- `green-BE/routes/productRoutes.js`
- `green-BE/routes/adminRoutes.js`

Customer site:

- `green-FE/components/reviews/ReviewPhotos.tsx`
- `green-FE/app/products/[id]/page.tsx`

Admin panel:

- `green-admin/src/pages/Reviews.tsx`
- `green-admin/src/config/apiConfig.ts`
- `green-admin/src/types.ts`

Homepage refactor:

- `green-FE/app/page.tsx`
- `green-FE/components/home/HomeHero.tsx`
- `green-FE/components/home/GreenStandardSection.tsx`
- `green-FE/components/home/FeaturedProductsSection.tsx`

## Deployment checklist

1. Back up the target Neon database and confirm the selected project/branch.
2. Run `green-BE/migrations/review_images.sql` once.
3. Confirm production Cloudinary credentials exist in the backend environment.
4. Deploy the backend before the frontends, because the updated review queries require the new table.
5. Deploy `green-admin` and `green-FE`.
6. Test an eligible review with no photo, one photo, and five photos.
7. Verify public hide/show behavior and permanent deletion from the admin Reviews page.
8. Confirm the product page still paginates after ten reviews.

## Verification completed locally

- Backend Node test suite passes.
- Admin TypeScript production build passes.
- Customer Next.js production build passes.
- Customer lint has no errors.

Live Cloudinary upload and Neon migration execution still require the configured target environments and should be verified during staging deployment.
