## 1. Taxonomy and classification (products-service)

- [x] 1.1 Tables `category` and `subcategory`, `product.classification_confirmed`, migration seeding the four categories and the existing subcategory texts
- [x] 1.2 Pure classifier from keywords/synonyms with clear / ambiguous / none
- [x] 1.3 Taxonomy service and routes: list with counts, create/edit/inactivate categories and subcategories, duplicate rules, no delete
- [x] 1.4 Validate category and subcategory on create, update and import; keep a confirmed classification on import
- [x] 1.5 Classification suggest, review list and apply selected

## 2. Draft suggestion (intelligence-service) and gateway

- [x] 2.1 Draft price suggestion read with the margin at a typed price, listing what is missing
- [x] 2.2 Category names from the registry in the pricing report
- [x] 2.3 Gateway routes for taxonomy, classification and the draft suggestion

## 3. Admin

- [ ] 3.1 Taxonomy API and hook used by every product form and filter
- [ ] 3.2 Categorias view (categories, subcategories, keywords, counts, review list)
- [ ] 3.3 Classification from the name in the manual form, the Excel preview and the invoice form
- [ ] 3.4 Unified area with the three views, one menu entry, redirects
- [ ] 3.5 Integrated new-product form with live suggestion, explicit save and approve, pending price

## 4. Verification

- [ ] 4.1 Tests for every item above, typecheck, lint, documentation
