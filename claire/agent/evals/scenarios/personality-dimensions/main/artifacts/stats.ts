/**
 * Statistics utilities for personality-dimensions evals
 */

export function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function variance(arr: number[]): number {
  if (arr.length === 0) return 0;
  const m = mean(arr);
  return arr.reduce((a, b) => a + Math.pow(b - m, 2), 0) / arr.length;
}

export function stddev(arr: number[]): number {
  return Math.sqrt(variance(arr));
}

export function absDiff(a: number, b: number): number {
  return Math.abs(a - b);
}

/**
 * Calculate Cronbach's alpha for inter-item reliability
 * α = (k/(k-1)) * (1 - sum(var_i)/var(sum))
 */
export function cronbachAlpha(itemScores: number[][]): number {
  if (itemScores.length === 0) return 0;
  
  const k = itemScores[0].length;
  if (k <= 1) return 1; // Can't compute alpha with single item
  
  // Item variances
  const itemVariances: number[] = [];
  for (let i = 0; i < k; i++) {
    const itemScores_i = itemScores.map(row => row[i]);
    itemVariances.push(variance(itemScores_i));
  }
  
  // Total score variance
  const totalScores = itemScores.map(row => row.reduce((a, b) => a + b, 0));
  const totalVariance = variance(totalScores);
  
  if (totalVariance === 0) return 0;
  
  return (k / (k - 1)) * (1 - itemVariances.reduce((a, b) => a + b, 0) / totalVariance);
}

/**
 * Pearson correlation coefficient
 */
export function correlation(x: number[], y: number[]): number {
  const n = x.length;
  if (n !== y.length || n === 0) return 0;
  
  const meanX = mean(x);
  const meanY = mean(y);
  
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  
  const denom = Math.sqrt(denomX * denomY);
  return denom === 0 ? 0 : numerator / denom;
}