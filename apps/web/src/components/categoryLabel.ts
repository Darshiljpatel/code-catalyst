/** Friendly labels at the presentation boundary; API category keys stay unchanged. */
export function categoryLabel(category: string) {
  const labels: Record<string, string> = {
    facts_claims: 'Claims',
    terminology: 'Terminology',
    tone: 'Tone',
    visual: 'Visual',
    accessibility: 'Accessibility',
    messaging: 'Messaging',
  };
  return labels[category] || category.replace(/_/g, ' ');
}

