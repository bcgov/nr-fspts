import type { CodeOption } from '@/services/fspSearch';

/**
 * Identify the "DDM decision letter" attachment category among the per-FSP
 * category list returned by {@code getAttachmentCategories}. The codes are
 * environment-driven (a proc, not a fixed enum), so we match by label:
 * prefer an explicit "DDM" / "decision letter" category, then fall back to
 * any "decision" category.
 *
 * Single source of truth shared by the DDM decision modal (which uploads the
 * letter under this category) and the Attachments tab (which hides it from
 * roles that may not attach decision letters), so the two never drift.
 */
export function findDecisionLetterCategory(
  cats: CodeOption[],
): CodeOption | null {
  const find = (re: RegExp) =>
    cats.find((c) => re.test(`${c.description ?? ''} ${c.code ?? ''}`));
  return find(/ddm/i) ?? find(/decision letter/i) ?? find(/decision/i) ?? null;
}
