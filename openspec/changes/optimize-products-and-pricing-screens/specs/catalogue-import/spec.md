## ADDED Requirements

### Requirement: Excel import with mapping and preview

The import SHALL offer a template, let the operator map spreadsheet columns to catalogue fields, and show a preview of new products, updates and conflicts before anything is written. It SHALL avoid duplicates, SHALL NOT erase an existing value with an empty cell unless the operator explicitly asks for it, and SHALL NOT delete any product.

#### Scenario: Empty cell keeps the value

- **GIVEN** a product with subcategory "Marmitas"
- **WHEN** the spreadsheet row has that cell empty and the clearing option is off
- **THEN** the subcategory is unchanged

#### Scenario: Repeated import

- **WHEN** the same file is applied twice
- **THEN** the second run creates nothing and reports the rows as unchanged

#### Scenario: EAN conflict

- **WHEN** a row carries an EAN that belongs to another product
- **THEN** the row is a conflict in the preview and is not applied
