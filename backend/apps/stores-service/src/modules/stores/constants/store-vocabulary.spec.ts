import { DEFAULT_LISTED_STATUSES, STORE_STATUS_VALUES, STORE_TYPE_VALUES } from './store-vocabulary'

describe('store vocabulary', () => {
  it('matches the statuses the admin panel renders', () => {
    expect([...STORE_STATUS_VALUES]).toEqual(['active', 'maintenance', 'inactive'])
  })

  it('distinguishes a company site from a condominium', () => {
    expect([...STORE_TYPE_VALUES]).toEqual(['company', 'condo'])
  })

  it('defaults listings to active only', () => {
    // The spec requires an unfiltered listing to hide closed stores while
    // keeping them retrievable by id.
    expect(DEFAULT_LISTED_STATUSES).toEqual(['active'])
  })

  it('keeps every default status inside the known vocabulary', () => {
    for (const status of DEFAULT_LISTED_STATUSES) {
      expect(STORE_STATUS_VALUES).toContain(status)
    }
  })
})
