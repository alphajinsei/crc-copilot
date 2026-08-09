import Anthropic from "@anthropic-ai/sdk";
import { ANSWER_SCHEMA, SYSTEM_PROMPT, buildUserMessage } from "@/lib/prompt";
import type { LoadedDocument } from "@/lib/registry";
import type {
  Action,
  Answer,
  Confidence,
  Hospital,
  Stakeholder,
  Trial,
} from "@/types";

export const DEFAULT_MODEL = "claude-sonnet-5";

export function getModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}

/** APIキー未設定なら固定応答で動かす。UI開発時にAPIを消費しないため。 */
export function isMockMode(): boolean {
  return !process.env.ANTHROPIC_API_KEY?.trim();
}

/**
 * ストリーミングされるJSONから、指定したキーの文字列値を逐次取り出す。
 *
 * 構造化出力を使うと本文はJSON文字列の一部として到着するため、そのまま
 * 画面に出すと `{"confidence":"gro...` のように見えてしまう。
 * 目的のキーの値部分だけを抜き出し、JSONエスケープを解いて返す。
 *
 * 完成したJSONのパースは別途行うので、ここは「表示用の best effort」。
 */
export class JsonFieldExtractor {
  private buffer = "";
  private emitted = 0;
  private valueStart = -1;
  private done = false;
  private readonly keyPattern: RegExp;

  constructor(key: string) {
    this.keyPattern = new RegExp(`"${key}"\\s*:\\s*"`);
  }

  /** 値の取り出しが完了したか。 */
  get finished(): boolean {
    return this.done;
  }

  /** 受け取った差分のうち、新たに表示すべきテキストを返す。 */
  push(delta: string): string {
    if (this.done) return "";
    this.buffer += delta;

    if (this.valueStart === -1) {
      // 目的のキーの値の開始位置（開き引用符の次）を探す
      const match = this.keyPattern.exec(this.buffer);
      if (!match) return "";
      this.valueStart = match.index + match[0].length;
      this.emitted = this.valueStart;
    }

    // 値の終端（エスケープされていない引用符）を探す
    let end = -1;
    for (let i = this.valueStart; i < this.buffer.length; i++) {
      if (this.buffer[i] !== '"') continue;
      let backslashes = 0;
      for (let j = i - 1; j >= 0 && this.buffer[j] === "\\"; j--) backslashes++;
      if (backslashes % 2 === 0) {
        end = i;
        break;
      }
    }

    const limit = end === -1 ? this.buffer.length : end;
    if (limit <= this.emitted) {
      if (end !== -1) this.done = true;
      return "";
    }

    // 値の途中で切れている場合、末尾が不完全なエスケープ列の可能性がある。
    // その分だけ送出を保留し、次の差分と連結してから出す。
    // （保留した位置は emitted に含めないので、取りこぼしは起きない）
    let safeLimit = limit;
    if (end === -1) {
      safeLimit = limit - incompleteEscapeLength(this.buffer, this.emitted, limit);
    }
    if (safeLimit <= this.emitted) return "";

    const chunk = this.buffer.slice(this.emitted, safeLimit);
    this.emitted = safeLimit;
    if (end !== -1) this.done = true;

    return unescapeJsonString(chunk);
  }
}

/**
 * 回答全体のストリーミング表示を組み立てる。
 *
 * 構造化出力では situation → answer → actions の順にJSONが生成されるため、
 * answer だけを追うと、actions の生成中（出力の半分以上を占める）は
 * 画面が止まって見える。実測で本文499字に対し総出力1,600字だった。
 *
 * そこで表示用テキストを段階的に組み立て、
 * actions の生成中も進捗が見えるようにする。
 */
export class AnswerStreamFormatter {
  private readonly situation = new JsonFieldExtractor("situation");
  private readonly answer = new JsonFieldExtractor("answer");
  private situationEmitted = false;
  private answerHeaderEmitted = false;
  private actionsNoticeEmitted = false;

  /** 受け取った差分に対応する、表示用テキストの追加分を返す。 */
  push(delta: string): string {
    let out = "";

    const situationText = this.situation.push(delta);
    if (situationText) {
      if (!this.situationEmitted) {
        this.situationEmitted = true;
        out += "【状況の理解】\n";
      }
      out += situationText;
    }

    const answerText = this.answer.push(delta);
    if (answerText) {
      if (!this.answerHeaderEmitted) {
        this.answerHeaderEmitted = true;
        out += this.situationEmitted ? "\n\n【資料に基づく事実】\n" : "";
      }
      out += answerText;
    }

    // answer が終わった後は actions の生成中。ここが最も長い。
    if (this.answer.finished && !this.actionsNoticeEmitted) {
      this.actionsNoticeEmitted = true;
      out += "\n\n推奨アクションを作成しています…";
    }

    return out;
  }
}

/**
 * [start, limit) の末尾にある「未完成のエスケープ列」の長さを返す。
 *
 * バックスラッシュの連なりを数え、奇数個で終わっていればエスケープの開始が
 * 途中で切れている。`\uXXXX` は6文字必要なので、揃うまでの分を保留させる。
 * 完成したエスケープ列に対しては 0 を返す（保留しない）。
 */
function incompleteEscapeLength(
  buffer: string,
  start: number,
  limit: number,
): number {
  // 末尾の連続するバックスラッシュを数える
  let backslashes = 0;
  let i = limit - 1;
  while (i >= start && buffer[i] === "\\") {
    backslashes++;
    i--;
  }
  // 奇数 = 最後の \ がエスケープ開始として未完成
  if (backslashes % 2 === 1) return 1;

  // `\uXXXX` が途中で切れていないか。直前が偶数個の \ で終わる \u を探す。
  for (let hex = 0; hex <= 4; hex++) {
    const uPos = limit - 2 - hex;
    if (uPos < start) break;
    if (buffer[uPos] !== "\\" || buffer[uPos + 1] !== "u") continue;

    // この \ が直前のエスケープで打ち消されていないか確認
    let preceding = 0;
    for (let j = uPos - 1; j >= start && buffer[j] === "\\"; j--) preceding++;
    if (preceding % 2 !== 0) continue;

    const digits = buffer.slice(uPos + 2, limit);
    // 4桁揃っていれば完成しているので保留不要
    if (digits.length >= 4) return 0;
    if (!/^[0-9a-fA-F]*$/.test(digits)) return 0;
    return limit - uPos;
  }

  return 0;
}

/** JSON文字列リテラル内のエスケープを解く。 */
function unescapeJsonString(text: string): string {
  try {
    return JSON.parse(`"${text}"`) as string;
  } catch {
    // 断片が不完全な場合の保険。主要なエスケープだけ手で戻す。
    return text
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
}

function isConfidence(value: unknown): value is Confidence {
  return value === "grounded" || value === "ambiguous" || value === "no_evidence";
}

const STAKEHOLDERS: readonly Stakeholder[] = [
  "doctor",
  "supervisor",
  "patient",
  "sponsor",
  "internal",
];

function isStakeholder(value: unknown): value is Stakeholder {
  return STAKEHOLDERS.includes(value as Stakeholder);
}

/** LLMの出力をAnswer型に変換する。想定外の形は握りつぶさずエラーにする。 */
export function parseAnswer(raw: string): Answer {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("回答をJSONとして解釈できませんでした。");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("回答の形式が想定と異なります。");
  }

  const obj = parsed as Record<string, unknown>;
  if (!isConfidence(obj.confidence)) {
    throw new Error("回答に有効な confidence が含まれていません。");
  }
  if (typeof obj.answer !== "string") {
    throw new Error("回答本文が含まれていません。");
  }

  const citations = Array.isArray(obj.citations)
    ? obj.citations.flatMap((item) => {
        if (typeof item !== "object" || item === null) return [];
        const c = item as Record<string, unknown>;
        return [
          {
            documentPath: String(c.documentPath ?? ""),
            location: String(c.location ?? ""),
            quote: String(c.quote ?? ""),
            relevance: String(c.relevance ?? ""),
          },
        ];
      })
    : [];

  const actions = Array.isArray(obj.actions)
    ? obj.actions
        .flatMap((item) => {
          if (typeof item !== "object" || item === null) return [];
          const a = item as Record<string, unknown>;
          if (!isStakeholder(a.stakeholder)) return [];

          const timing = typeof a.timing === "string" ? a.timing.trim() : "";
          const groundedIn = Array.isArray(a.groundedIn)
            ? a.groundedIn.map(String).filter((p) => p.length > 0)
            : [];

          return [
            {
              order: typeof a.order === "number" ? a.order : 0,
              stakeholder: a.stakeholder,
              action: String(a.action ?? ""),
              why: String(a.why ?? ""),
              ...(timing ? { timing } : {}),
              ...(groundedIn.length > 0 ? { groundedIn } : {}),
            } satisfies Action,
          ];
        })
        // LLMが order を飛ばしたり重複させたりしても、表示順は安定させる
        .sort((a, b) => a.order - b.order)
    : [];

  const openQuestions = Array.isArray(obj.openQuestions)
    ? obj.openQuestions.map(String).filter((q) => q.trim().length > 0)
    : [];

  const caveat = typeof obj.caveat === "string" ? obj.caveat.trim() : "";
  const situation =
    typeof obj.situation === "string" ? obj.situation.trim() : "";

  return {
    confidence: obj.confidence,
    answer: obj.answer,
    ...(caveat ? { caveat } : {}),
    citations,
    ...(situation ? { situation } : {}),
    actions,
    ...(openQuestions.length > 0 ? { openQuestions } : {}),
  };
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

export type StreamCallbacks = {
  /** 表示用の回答本文の差分。 */
  onAnswerDelta: (text: string) => void;
};

/**
 * LLMに問い合わせ、回答をストリーミングで受け取る。
 *
 * 文書は全文をそのまま投入する（docs/design.md 「4.2 検索方式」）。
 * 文書部分にキャッシュを効かせるため、同じ組み合わせでの連続質問では
 * 2回目以降の入力コストが大きく下がる。
 */
export async function askClaude(
  hospital: Hospital,
  trial: Trial,
  documents: LoadedDocument[],
  question: string,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<Answer> {
  const userMessage = buildUserMessage(hospital, trial, documents, question);
  const formatter = new AnswerStreamFormatter();

  const stream = getClient().messages.stream(
    {
      model: getModel(),
      max_tokens: 8000,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: userMessage,
              // 文書＋質問までをキャッシュ対象にする。同じ質問の再実行や、
              // 同一組み合わせでの連続質問で入力コストが下がる。
              cache_control: { type: "ephemeral" },
            },
          ],
        },
      ],
      output_config: {
        format: {
          type: "json_schema",
          schema: ANSWER_SCHEMA,
        },
      },
    },
    { signal },
  );

  stream.on("text", (delta) => {
    const visible = formatter.push(delta);
    if (visible) callbacks.onAnswerDelta(visible);
  });

  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new Error(
      "モデルが応答を拒否しました。質問の表現を変えてお試しください。",
    );
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error(
      "回答が長すぎて途中で打ち切られました。質問を絞ってお試しください。",
    );
  }

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  return parseAnswer(text);
}

/** モックモード用の固定応答。UI確認とAPI節約のため。 */
export async function askMock(
  documents: LoadedDocument[],
  question: string,
  callbacks: StreamCallbacks,
): Promise<Answer> {
  const first = documents[0];
  // 引用検証が動くことを確認できるよう、原文から実在する一節を切り出す
  const excerpt =
    first?.content
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 20 && !line.startsWith("#") && !line.startsWith(">")) ??
    "（本文なし）";

  const body = `【モックモード】ANTHROPIC_API_KEY が設定されていないため、固定の応答を返しています。

質問：${question}

参照対象として ${documents.length} 件の文書が特定されました。実際の回答を得るには、
.env.local に ANTHROPIC_API_KEY を設定してサーバーを再起動してください。`;

  // ストリーミング表示の動作確認のため、少しずつ送る
  for (const chunk of body.match(/[\s\S]{1,12}/g) ?? []) {
    callbacks.onAnswerDelta(chunk);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }

  return {
    confidence: "no_evidence",
    answer: body,
    caveat:
      "これはモック応答です。回答内容の妥当性は検証されていません。",
    citations: first
      ? [
          {
            documentPath: first.path,
            location: "（モック）冒頭",
            quote: excerpt,
            relevance:
              "引用検証が機能していることを確認するため、原文から実在する一節を引用しています。",
          },
        ]
      : [],
    situation:
      "（モック）UIの表示確認用の固定応答です。実際の状況を解析したものではありません。",
    // アクション表示のUIを確認できるよう、各ステークホルダーを1件ずつ含める
    actions: [
      {
        order: 1,
        stakeholder: "doctor",
        action:
          "（モック）治験責任医師に状況を報告し、医学的判断を仰ぐ",
        why: "医学的判断の権限は医師にあり、判断が出ないと他の関係者に伝える内容が確定しないため",
        timing: "速やかに",
        groundedIn: [],
      },
      {
        order: 2,
        stakeholder: "supervisor",
        action: "（モック）CRCリーダーに一報を入れる",
        why: "組織として対応の要否を判断できるようにするため",
        groundedIn: [],
      },
      {
        order: 3,
        stakeholder: "patient",
        action: "（モック）医師の判断を踏まえて被験者に連絡する",
        why: "医師の判断が出る前に説明すると、後で覆って混乱を招くため",
        timing: "医師の判断確定後",
        groundedIn: [],
      },
      {
        order: 4,
        stakeholder: "internal",
        action: "（モック）経過を記録し、必要に応じてNote to Fileを作成する",
        why: "記録は即時に行い、記憶に頼らないため",
        groundedIn: [],
      },
    ],
    openQuestions: [
      "（モック）これはUI確認用の固定応答です。ANTHROPIC_API_KEY を設定してください。",
    ],
  };
}
