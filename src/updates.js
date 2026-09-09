export function isNewerVersion(current, candidate) {
  const parse = (value) => {
    const match = String(value).match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
    return match ? match.slice(1).map(Number) : null;
  };
  const installed = parse(current);
  const available = parse(candidate);
  if (!installed || !available) return false;
  for (let index = 0; index < 3; index++) {
    if (available[index] !== installed[index]) return available[index] > installed[index];
  }
  return false;
}
