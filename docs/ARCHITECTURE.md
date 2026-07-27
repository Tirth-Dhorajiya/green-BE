# Backend architecture

The backend follows a layered Express structure:

- `app.js` constructs and exports the Express application.
- `server.js` is the local process entry point and starts the HTTP listener.
- `api/index.js` is the Vercel serverless entry point.
- `routes/` defines HTTP paths, validation, uploads, and authorization boundaries.
- `controllers/` translates HTTP requests and responses.
- `services/` contains provider integrations and domain rules.
- `models/` owns database queries and transactions.
- `middleware/` contains reusable request middleware.
- `config/` contains infrastructure configuration.
- `data/` contains version-controlled growing-guide knowledge.
- `migrations/`, `schema/`, and `seeds/` contain database artifacts.
- `tests/` mirrors behavior-sensitive services, routes, and model transactions.

Dependency direction should remain:

```text
routes -> controllers -> services/models -> config
```

Controllers may coordinate services and models. Routes should not contain business
logic, and models should not depend on controllers or routes. API paths and database
contracts must remain backward compatible unless a versioned migration is provided.

Keep credentials in environment variables. Never place provider secrets in routes,
controllers, source-controlled configuration, or frontend responses.
