import type { DocumentMeta, Layer } from "@/types";

/**
 * 指定された病院・治験に関連する文書だけを抽出する。
 *
 * docs/design.md 「3.2 文書の絞り込みルール」:
 *   ⓪ 常に含める（行動原則。規則ではない）
 *   ① 常に含める
 *   ② hospitalId が一致
 *   ③ trialId が一致
 *   ④ hospitalId と trialId の両方が一致
 *
 * このフィルタは本アプリの根幹であり、LLMに判断させない。
 * 副作用も I/O も持たない純粋関数として切り出してある。
 */
export function selectDocuments(
  documents: DocumentMeta[],
  hospitalId: string,
  trialId: string,
): DocumentMeta[] {
  return documents.filter((d) => isRelevant(d, hospitalId, trialId));
}

function isRelevant(
  doc: DocumentMeta,
  hospitalId: string,
  trialId: string,
): boolean {
  switch (doc.layer) {
    case 0:
    case 1:
      return true;
    case 2:
      return doc.hospitalId === hospitalId;
    case 3:
      return doc.trialId === trialId;
    case 4:
      return doc.hospitalId === hospitalId && doc.trialId === trialId;
    default:
      // 未知の層は既定で除外する。誤って無関係な文書を混ぜるより、
      // 落ちていることに気づけるほうが安全。
      return false;
  }
}

/** 層の昇順、次にパスの辞書順で安定に並べる。プロンプトの再現性のため。 */
export function sortByLayer(documents: DocumentMeta[]): DocumentMeta[] {
  return [...documents].sort(
    (a, b) => a.layer - b.layer || a.path.localeCompare(b.path),
  );
}

export const LAYER_LABELS: Record<Layer, string> = {
  0: "⓪ CRC行動原則（規則ではない。出典として引用しないこと）",
  1: "① GCP（国が定めた基準）",
  2: "② 病院文書（病院が制定）",
  3: "③ 治験文書（製薬会社が作成）",
  4: "④ 病院×治験文書（この病院でこの治験をどう実施するか）",
};

export const LAYER_SHORT: Record<Layer, string> = {
  0: "⓪ 行動原則",
  1: "① GCP",
  2: "② 病院",
  3: "③ 治験",
  4: "④ 病院×治験",
};
