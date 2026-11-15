/** Up to `n` distinct items, each drawn with chance proportional to its weight (Efraimidis-Spirakis: biggest u^(1/w) wins). */
export function drawWeighted<T>(items: readonly { item: T; weight: number }[], n: number, random: () => number = Math.random): T[] {
  for (const { weight } of items) if (!(weight > 0)) throw new Error(`a draw weight must be positive, not ${weight}`);
  return items
    .map(({ item, weight }) => ({ item, key: Math.pow(random(), 1 / weight) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, n)
    .map(({ item }) => item);
}
