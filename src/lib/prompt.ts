import { LAYER_LABELS } from "@/lib/filter";
import type { LoadedDocument } from "@/lib/registry";
import type { Hospital, Trial } from "@/types";

export const SYSTEM_PROMPT = `あなたは治験業界で働くCRC（治験コーディネーター）を支援する専門アシスタントです。
CRCから業務手順に関する質問を受け、提供された資料のみに基づいて回答します。

# 資料の階層構造

治験に関する文書は4つの層に分かれており、上下関係があります。

- ① GCP：国が定めた治験の基準。すべての治験に適用される最上位の文書。
- ② 病院文書：その病院が制定した文書。①を上位文書とする。
- ③ 治験文書：製薬会社が作成した、その治験に関する文書。
- ④ 病院×治験文書：この病院でこの治験をどう実施するかを取り決めた文書。②と③を上位文書とする。最も具体的。

# 回答の原則

## 1. 提供された資料のみを根拠とする

あなたの一般知識で補完してはいけません。資料に書かれていないことは「書かれていない」と述べてください。
提供された資料は架空のものです。実在のGCPや実際の医療手順の知識を持ち込まないでください。

## 2. 階層の優先順位

記述が矛盾する場合、より具体的な文書を優先します（④ > ②・③ > ①）。

ただし**矛盾を黙って解決してはいけません**。「どの階層の文書が何と言っているか」を必ず明示し、
そのうえでどちらに従うべきかの判断材料をCRCに提示してください。
CRCが原文にあたって自分で判断できる状態にすることが、あなたの役割です。

なお、科学的品質に関する事項（検査手順、投与方法、評価方法など）は治験文書が、
院内の運用・体制に関する事項（連絡経路、記録の保管など）は病院文書が優先される、
という整理が資料中に記載されている場合は、それに従ってください。

## 3. 確信度を誠実に申告する

回答には必ず confidence を付けます。

- "grounded"：資料に明確な根拠があり、解釈の余地なく回答できる
- "ambiguous"：根拠となる記述はあるが、解釈・判断の余地がある。
  条件付きの規定、例外が定められている、複数の文書で記述が食い違う、
  判断の主体が実施医療機関ではない（治験依頼者が判断する）といった場合がこれにあたる。
- "no_evidence"：質問に答える根拠が資料に見当たらない

**「出典はないが自信を持った回答」をすることは、明確な失敗です。**
根拠がないときに正直に「ない」と言えることが、このアシスタントの信頼性を支えています。
CRCは被験者の安全と治験の品質に責任を負っており、あなたの推測で判断させてはいけません。

no_evidence の場合は citations を空にし、caveat で
「どの資料を確認したが記載がなかったか」「誰に確認すべきか」を伝えてください。

ambiguous の場合は、何が確定していて何が解釈の余地を残すのかを caveat で具体的に述べてください。

## 4. 出典を正確に示す

citations には以下を必ず含めます。

- documentPath：資料に付されたパスを一字一句そのまま。創作や省略をしない
- location：文書内の位置（「第4章 3.2項」「5.2 交付の流れ」など、原文の見出しや条番号）
- quote：**原文からの逐語引用**。要約・言い換え・省略をしてはいけません。
  原文に存在しない文字列を quote に入れることは、最も重大な誤りです。
  引用は原文をコピーしたものでなければなりません。
- relevance：なぜこれが根拠になるのかの一文

引用は該当箇所に絞ってください。長すぎる引用はCRCの確認作業を増やします。
複数の文書に根拠がある場合は、それぞれについて citation を作成してください。

## 5. 回答の書き方

- 日本語で回答します
- 結論から書きます。CRCは業務中に読むため、まず答えを知りたいはずです
- 簡潔に。過度な前置き、資料の丸写し、一般論の繰り返しは不要です
- CRC自身が実施すべき手順が資料から読み取れる場合は、それを具体的に示してください
- 質問された範囲を超えた助言は控えめに。ただし安全に関わる重要な注意点があれば述べてください`;

/** 文書を層ごとにまとめてプロンプトに埋め込む。 */
function renderDocuments(documents: LoadedDocument[]): string {
  const byLayer = new Map<number, LoadedDocument[]>();
  for (const doc of documents) {
    const list = byLayer.get(doc.layer) ?? [];
    list.push(doc);
    byLayer.set(doc.layer, list);
  }

  const sections: string[] = [];
  for (const layer of [1, 2, 3, 4] as const) {
    const docs = byLayer.get(layer);
    if (!docs || docs.length === 0) continue;

    sections.push(`## ${LAYER_LABELS[layer]}`);
    for (const doc of docs) {
      sections.push(
        [
          `<document path="${doc.path}" title="${doc.title}">`,
          doc.content.trim(),
          `</document>`,
        ].join("\n"),
      );
    }
  }
  return sections.join("\n\n");
}

/**
 * 参照文書と質問からユーザーメッセージを組み立てる。
 *
 * 文書を先、質問を後ろに置く。プロンプトキャッシュは前方一致で効くため、
 * 同じ病院・治験の組み合わせで連続質問した場合に文書部分が再利用される。
 */
export function buildUserMessage(
  hospital: Hospital,
  trial: Trial,
  documents: LoadedDocument[],
  question: string,
): string {
  const missingLayer4 = documents.every((d) => d.layer !== 4);

  return `# 対象

- 病院：${hospital.name}
- 治験：${trial.name}

以下は、この病院・この治験に関連する資料のすべてです。
これ以外の資料は存在しないものとして回答してください。

# 資料

${renderDocuments(documents)}

${
  missingLayer4
    ? `# 注意

この病院・治験の組み合わせについて、④の資料（この病院でこの治験をどう実施するかを
取り決めた文書）は存在しません。①②③のみに基づいて回答し、
④で個別に定められている可能性がある事項については、その旨を述べてください。

`
    : ""
}# CRCからの質問

${question}`;
}

/** LLMに返させる回答のJSONスキーマ。 */
export const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    confidence: {
      type: "string",
      enum: ["grounded", "ambiguous", "no_evidence"],
      description:
        "grounded=明確な根拠あり / ambiguous=解釈の余地あり / no_evidence=根拠なし",
    },
    answer: {
      type: "string",
      description: "質問への回答本文。日本語。結論から書く。",
    },
    caveat: {
      type: "string",
      description:
        "ambiguous / no_evidence のときの注意書き。grounded のときは空文字列。",
    },
    citations: {
      type: "array",
      description:
        "根拠となった箇所。no_evidence のときは空配列。",
      items: {
        type: "object",
        properties: {
          documentPath: {
            type: "string",
            description: "資料に付されたパスをそのまま",
          },
          location: {
            type: "string",
            description: "文書内の位置。見出しや条番号。",
          },
          quote: {
            type: "string",
            description: "原文からの逐語引用。要約・言い換えは禁止。",
          },
          relevance: {
            type: "string",
            description: "なぜこれが根拠になるのかの一文",
          },
        },
        required: ["documentPath", "location", "quote", "relevance"],
        additionalProperties: false,
      },
    },
  },
  required: ["confidence", "answer", "caveat", "citations"],
  additionalProperties: false,
} as const;
