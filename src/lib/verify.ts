import type { LoadedDocument } from "@/lib/registry";
import type {
  Answer,
  CitationMatch,
  VerifiedAnswer,
  VerifiedCitation,
} from "@/types";

/**
 * 照合用に文字列を正規化する。
 *
 * LLMは引用時に空白・改行・全角半角を揺らすことがある。それを理由に
 * 「捏造」と誤判定すると警告が形骸化するため、意味を変えない差異は吸収する。
 * 逆に、文言そのものの改変は吸収しない。
 */
function normalize(text: string): string {
  return text
    .normalize("NFKC")
    // 全角スペース・各種空白・改行をすべて除去して比較する。
    // 原文は表組みや箇条書きを含み、引用時に改行位置が変わりやすいため。
    .replace(/[\s　]+/g, "")
    // 強調のためのMarkdown記法は原文側にのみ存在することがある
    .replace(/\*\*/g, "")
    .toLowerCase();
}

/**
 * LLMが返した引用が、実際にその文書の本文に存在するかを照合する。
 *
 * docs/design.md 「4.5 引用の検証」:
 * 引用の捏造は、ハルシネーションのうち最も検出しやすく最も有害な失敗。
 * LLMの自己申告に頼らない検証をひとつ持っておくことに意味がある。
 */
export function verifyAnswer(
  answer: Answer,
  documents: LoadedDocument[],
): VerifiedAnswer {
  const byPath = new Map(documents.map((d) => [d.path, d]));
  const normalizedCache = new Map<string, string>();

  const getNormalizedContent = (path: string): string | null => {
    const cached = normalizedCache.get(path);
    if (cached !== undefined) return cached;
    const doc = byPath.get(path);
    if (!doc) return null;
    const value = normalize(doc.content);
    normalizedCache.set(path, value);
    return value;
  };

  const citations: VerifiedCitation[] = answer.citations.map((citation) => {
    const doc = byPath.get(citation.documentPath);
    const normalizedContent = getNormalizedContent(citation.documentPath);
    const match = classify(citation.quote, normalizedContent);

    return {
      ...citation,
      match,
      verified: match === "exact",
      documentFound: doc !== undefined,
      documentTitle: doc?.title ?? null,
      layer: doc?.layer ?? null,
    };
  });

  return { ...answer, citations };
}

function classify(quote: string, content: string | null): CitationMatch {
  if (content === null) return "no_document";

  const needle = normalize(quote);
  // 空の引用を「検証済み」と扱わない（空文字列は常に部分一致するため）
  if (needle.length === 0) return "not_found";
  if (content.includes(needle)) return "exact";

  // 離れた複数箇所を繋いだ引用は、捏造とは区別して扱う。
  // 各行が原文に存在し、かつ原文中で順序が保たれていれば「継ぎ接ぎ」とみなす。
  const lines = quote
    .split(/\r?\n+/)
    .map((line) => normalize(line))
    .filter((line) => line.length > 0);

  if (lines.length >= 2) {
    let cursor = 0;
    const allInOrder = lines.every((line) => {
      const at = content.indexOf(line, cursor);
      if (at === -1) return false;
      cursor = at + line.length;
      return true;
    });
    if (allInOrder) return "stitched";
  }

  return "not_found";
}
