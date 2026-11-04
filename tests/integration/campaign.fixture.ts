export const campaignAccount = { id: 'account-a', organizationId: 'a', externalAccountId: 'act_123', name: 'Client A', provider: 'META_ADS', currency: 'USD', timezone: 'America/New_York', enabled: true, connectionId: 'connection-a' };
export const campaignSpecification = (google = false): any => ({ operation: 'CREATE', objective: google ? 'SEARCH' : 'OUTCOME_TRAFFIC', currency: 'USD', dailyBudget: '12.34',
  start: '2027-01-01T00:00:00Z', end: '2027-01-10T00:00:00Z', bidStrategy: google ? 'MANUAL_CPC' : 'LOWEST_COST_WITHOUT_CAP', countries: ['US'], placements: 'AUTOMATIC',
  headlines: google ? ['First headline', 'Second headline', 'Third headline'] : ['A headline'], descriptions: google ? ['First description', 'Second description'] : ['Advertising message'], destinationUrl: 'https://example.com/', keywords: google ? ['search term'] : [], ...(google ? { maxCpc: '1.23' } : {}),
});
export const campaignBody = () => ({ accountId: 'account-a', name: 'Client campaign', key: 'stable-creation-key-123', spec: campaignSpecification() });
