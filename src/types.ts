/** 文書の階層。docs/design.md 「2. データソースの4層構造」を参照。 */
export type Layer = 1 | 2 | 3 | 4;

export type Hospital = { id: string; name: string };
export type Trial = { id: string; name: string };

export type DocumentMeta = {
  /** data/ からの相対パス。スラッシュ区切り。 */
  path: string;
  layer: Layer;
  /** 層②④のみ設定される。 */
  hospitalId: string | null;
  /** 層③④のみ設定される。 */
  trialId: string | null;
  title: string;
  docType: string;
};

export type Registry = {
  generatedAt: string;
  hospitals: Hospital[];
  trials: Trial[];
  documents: DocumentMeta[];
};

/** 根拠の確度。docs/design.md 「3.3 出力」を参照。 */
export type Confidence = "grounded" | "ambiguous" | "no_evidence";

export type Citation = {
  /** registry の path と一致すること。 */
  documentPath: string;
  /** 「第4章 3.2項」など文書内の位置。 */
  location: string;
  /** 原文の逐語引用。 */
  quote: string;
  /** なぜこれが根拠になるのかの一文。 */
  relevance: string;
};

export type Answer = {
  confidence: Confidence;
  answer: string;
  /** ambiguous / no_evidence のときの注意書き。 */
  caveat?: string;
  citations: Citation[];
};

/**
 * 引用の検証結果。LLMの自己申告に頼らず、引用文が原文に実在するかを
 * サーバー側で照合した結果を持つ。docs/design.md 「4.5 引用の検証」を参照。
 */
/**
 * 引用の照合結果。
 * - `exact`      : 原文に連続した一節として存在する
 * - `stitched`   : 各部分は原文にあるが、連続していない箇所を繋いでいる
 * - `not_found`  : 原文中に見つからない（捏造の疑い）
 * - `no_document`: 参照対象外の文書を出典としている
 */
export type CitationMatch = "exact" | "stitched" | "not_found" | "no_document";

export type VerifiedCitation = Citation & {
  /** 原文に連続した一節として存在するか。 */
  verified: boolean;
  match: CitationMatch;
  /** documentPath が参照文書の一覧に存在したか。 */
  documentFound: boolean;
  /** 表示用の文書タイトル。未知の文書なら null。 */
  documentTitle: string | null;
  layer: Layer | null;
};

export type VerifiedAnswer = Omit<Answer, "citations"> & {
  citations: VerifiedCitation[];
};

/** 参照した文書の一覧をUIに出すための情報。 */
export type ReferencedDocument = {
  path: string;
  title: string;
  layer: Layer;
  docType: string;
  /** 概算の文字数。規模感の把握用。 */
  chars: number;
};

/** /api/ask がSSEで送るイベント。 */
export type AskStreamEvent =
  | {
      type: "meta";
      hospital: Hospital;
      trial: Trial;
      documents: ReferencedDocument[];
      /** LLMを呼ばずに固定応答を返すモード。 */
      mock: boolean;
      model: string;
      estimatedInputChars: number;
    }
  /** 回答本文の差分。到着順に連結する。 */
  | { type: "answer_delta"; text: string }
  | { type: "done"; answer: VerifiedAnswer }
  | { type: "error"; message: string };
