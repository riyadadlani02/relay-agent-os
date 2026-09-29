export const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export const relative = (date: string) => {
  const mins = Math.max(0, Math.floor((Date.now() - Date.parse(date)) / 60000));
  return mins < 1 ? 'Just now' : mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
};
export async function api<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(
    `/api${path}`,
    body === undefined
      ? undefined
      : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Request failed.');
  return data;
}
