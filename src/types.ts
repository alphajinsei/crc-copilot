/**
 * 文書の階層。docs/design.md 「2. データソースの階層構造」を参照。
 *
 * ⓪は①〜④と性質が異なる。①〜④が「何が定められているか」を示す**規則**
 * であるのに対し、⓪は「どう振る舞うべきか」を示す**行動原則**である。
 * このため⓪は出典として引用しない（4.5参照）。
 */
export type Layer = 0 | 1 | 2 | 3 | 4;

/** 規則の文書（出典として引用しうる層）かどうか。 */
export function isSourceLayer(layer: Layer): boolean {
  return layer !== 0;
}

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

/** アクションの宛先。docs/design.md 「3.4 推奨アクション」を参照。 */
export type Stakeholder =
  | "doctor"
  | "supervisor"
  | "patient"
  | "sponsor"
  | "internal";

/**
 * 推奨アクション。
 *
 * これは**アプリによる提案**であり、資料に定められた手順とは限らない。
 * 事実の回答（answer / citations）とは画面上で明確に区別して表示する。
 */
export type Action = {
  /** 実行順序。1が最優先。 */
  order: number;
  stakeholder: Stakeholder;
  /** 誰に何を伝え、何を得るのか。具体的に。 */
  action: string;
  /** なぜこの順序・この相手なのか。CRCが状況に応じて調整できるようにする。 */
  why: string;
  /** 「本日中」「医師の判断確定後」など。依存関係があれば明示する。 */
  timing?: string;
  /** 資料に根拠がある場合のみ、その documentPath。業務常識による提案なら空。 */
  groundedIn?: string[];
};

export type Answer = {
  // ── 資料に基づく事実 ──
  confidence: Confidence;
  answer: string;
  /** ambiguous / no_evidence のときの注意書き。 */
  caveat?: string;
  citations: Citation[];

  // ── アプリによる提案 ──
  /** 相談内容の理解を示す状況の要約。相談型の質問でのみ埋まる。 */
  situation?: string;
  /** 推奨アクション。優先度順。単なる事実確認の質問では空になりうる。 */
  actions: Action[];
  /** 判断に必要だが情報が不足している点。断定せず聞き返すための欄。 */
  openQuestions?: string[];
};

/**
 * 引用の照合結果。LLMの自己申告に頼らず、引用文が原文に実在するかを
 * サーバー側で照合する。docs/design.md 「4.5 引用の検証」を参照。
 *
 * - `exact`      : 原文に連続した一節として存在する
 * - `stitched`   : 各部分は原文にあるが、連続していない箇所を繋いでいる
 * - `not_found`  : 原文中に見つからない（捏造の疑い）
 * - `no_document`: 参照対象外の文書を出典としている
 * - `policy`     : ⓪行動原則を出典としている（規則ではないため不可）
 */
export type CitationMatch =
  | "exact"
  | "stitched"
  | "not_found"
  | "no_document"
  | "policy";

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
