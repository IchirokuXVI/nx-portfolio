/**
 * Resolve the image tags to build/push. When PORTFOLIO_IMAGE_TAG is set it takes
 * precedence over the per-configuration versionTags, so CI can stamp a single
 * release version (e.g. 1.1.3) or the staging tag without editing project.json.
 * Accepts a comma-separated list for multiple tags.
 */
export function resolveVersionTags(configured: string[] | undefined): string[] {
  const fromEnv = process.env.PORTFOLIO_IMAGE_TAG;
  if (fromEnv) {
    return fromEnv
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return configured || [];
}
