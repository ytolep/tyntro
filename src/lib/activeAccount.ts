// Account selection is a UI preference, never an authorization credential.
export function activeAccountUrl() {
  const id = typeof window !== 'undefined' ? localStorage.getItem('activeAccountId') : null;
  return `/api/accounts/active${id ? `?accountId=${encodeURIComponent(id)}` : ''}`;
}
