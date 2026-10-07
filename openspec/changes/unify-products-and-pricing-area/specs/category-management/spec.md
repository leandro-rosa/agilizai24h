## ADDED Requirements

### Requirement: Classification from the name

When a name is entered the system SHALL suggest a category and subcategory from the existing taxonomy using each one's keywords and synonyms, SHALL mark the result as suggested, SHALL NOT overwrite a manual choice when the name keeps changing, SHALL offer alternatives (or leave it pending) when the name is ambiguous, and SHALL NOT create a category from a description. The same mechanism SHALL serve the manual form, the Excel import and the invoice flow, and SHALL keep a classification already confirmed.

#### Scenario: Manual choice survives

- **GIVEN** the operator chose a category by hand
- **WHEN** they keep editing the name
- **THEN** the chosen category is not replaced

#### Scenario: Ambiguous

- **WHEN** two different subcategories match equally
- **THEN** both are offered and none is applied

### Requirement: Managed categories and subcategories

The system SHALL let the operator create, edit and inactivate categories and subcategories, link each subcategory to one category, see how many products use each, and set keywords and synonyms. Names SHALL be unique within their level (categories; subcategories of one category). A category or subcategory SHALL NOT be deleted: a used one is inactivated and its products and history stay. A product's subcategory SHALL belong to its category.

#### Scenario: Duplicate name

- **WHEN** a subcategory is created with a name that already exists in that category
- **THEN** it is refused

#### Scenario: Inactivating a used category

- **WHEN** a category with products is inactivated
- **THEN** the products keep it and it is no longer offered for new products

### Requirement: Initial structure is proposed, not applied

The initial taxonomy SHALL come from the categories and subcategory texts that already exist. Products SHALL NOT be reclassified silently: a review list SHALL propose a classification and only the items the operator selects SHALL be applied.

#### Scenario: Review

- **GIVEN** products without a subcategory
- **WHEN** the operator opens the review
- **THEN** each is listed with a proposal and nothing changes until the operator applies selected items
