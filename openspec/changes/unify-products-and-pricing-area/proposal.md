## Why

The two screens now work, but the operator still moves between "Produtos" and "Precificação Inteligente" to register a product and price it, categories are a closed list written in code (four keys, free-text subcategory on the product, 232 of 255 products without a subcategory), and nothing classifies a product from its name. The owner wants one area, a product form that prices as it is filled, and a managed, reusable classification.

Examined first (read-only, dev stack): 255 products, categories meal 1 / beverage 57 / snack 174 / essential 23, only 8 distinct subcategory texts (Energéticos, refrigerantes, Chás, Salgadinhos, Chocolates, Salgados, Balas, Panetone), the vocabulary is hard-coded in products-service, intelligence and about ten admin files.

## What Changes

- **One area "Produtos e Precificação"** in the menu with three views: Catálogo (all products, including new and without price), Precificação (the existing analysis/simulation/approval) and Categorias. The old routes redirect to the matching view. "Novo produto" is available there and opens an integrated form.
- **Integrated new-product form**: name, SKU, several EANs, category and subcategory, purchase and sale unit, conversion factor, purchase cost and its date. As soon as a valid cost exists it shows the cost per sold unit, the suggested price, the estimated margin and the target used — computed by the same pricing engine (a draft read, no formula in the browser) and recalculated when cost, factor, category or another parameter changes. A product with no sales uses the configured default parameters and is labelled an initial suggestion; no volume or monthly impact is invented; missing parameters are listed; zero is never shown as a price or margin. The operator accepts the suggestion or types another price (with its margin), and saving the registration and approving the price are separate explicit actions (the approval carries validity and history); the registration can be saved with the price pending.
- **Classification from the name** with the existing categories: a deterministic keyword/synonym matcher fills category and subcategory, says it was suggested, never overwrites a manual choice, offers alternatives when ambiguous, never creates a category from a description, and is the same mechanism for the manual form, the Excel import and the invoice flow, respecting classifications already confirmed.
- **Category management** (Categorias view): create, edit and inactivate categories and subcategories, each subcategory under one category, product counts, keywords and synonyms, no duplicate names within a level, no deletion (a used category is inactivated, never removed), products and history untouched. The list is the single source for filters, forms, import, invoices and pricing.
- **Initial structure for review, not applied**: the current four categories and the eight existing subcategory texts become the starting taxonomy (no product changes); a review list proposes category/subcategory for products without one, and only what the operator selects is applied.

## Capabilities

### New Capabilities
- `products-pricing-area`: the unified area, the integrated form and the redirects.
- `category-management`: taxonomy CRUD, classification from the name and the review list.
- `draft-price-suggestion`: the price suggestion for a product that does not exist yet.

### Modified Capabilities
<!-- The registry, import and pricing capabilities live in changes that are not archived yet; this change builds on them. -->

## Impact

- `backend/apps/products-service`: `category` and `subcategory` tables seeded from the current data, `product.classification_confirmed`, taxonomy routes, classifier, classification review/apply, validation of category and subcategory on create/update/import.
- `backend/apps/intelligence-service`: a draft suggestion read, category names from the registry.
- `backend/apps/gateway-service`: taxonomy, classification and draft-suggestion routes.
- `frontend/apps/admin`: the unified area, the Categorias view, the integrated form, classification in every product form, sidebar and redirects.
