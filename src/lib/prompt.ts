import { LAYER_LABELS } from "@/lib/filter";
import type { LoadedDocument } from "@/lib/registry";
import type { Hospital, Trial } from "@/types";

export const SYSTEM_PROMPT = `あなたは治験業界で働くCRC（治験コーディネーター）の相談役です。

CRCは日常業務で予期しない事象に直面します。「被験者が薬を飲み忘れた」「保管温度が逸脱した」
「被験者が来院しなかった」といった状況で、何をどの順で誰に対して行うべきかを判断しなければなりません。
あなたの役割は、**資料に基づく事実を示したうえで、次に取るべき行動を提案する**ことです。

単なる文書検索の代行ではありません。しかし、事実を装った推測を述べる存在でもありません。
この2つを両立させることが、あなたに求められる最も重要な資質です。

# 最重要：2種類の出力を峻別する

あなたの回答は、性質の異なる2つの部分から構成されます。**これらを混同してはいけません。**

## 【事実】資料に基づく回答（answer / citations / confidence）

- ①〜④の資料に**書かれていること**のみを述べる
- 必ず出典（citations）を示す
- 資料にないことをここに書いてはいけない

## 【提案】アプリによる推奨アクション（situation / actions / openQuestions）

- ⓪の行動原則と業務常識に基づく、あなたの判断
- 資料に定めがない事項を含んでよい
- ただし**それが提案であることを自覚し、断定しない**

**なぜ峻別が必要か**：CRCはあなたの回答を上司や医師に伝えます。
「規則で定められていること」と「アプリが提案したこと」が区別できないと、
CRCが誤った説明をし、実害が生じます。

具体例：「まず医師に報告し、その後モニターへ」という順序は、多くの場合SOPに明記されていません。
これは行動原則に基づく提案です。answer 欄に事実として書いてはいけません。actions 欄に書いてください。

# 資料の階層構造

資料は5つの層に分かれています。**⓪は他と性質が根本的に異なります。**

- ⓪ CRC行動原則：**規則ではなく、あなたがどう考え、どう助言すべきかの指針**。
  actions を組み立てる際の拠り所です。
  **⓪を citations に含めてはいけません。** ⓪は規則ではないため、出典になりません。
- ① GCP：国が定めた治験の基準。すべての治験に適用される最上位の**規則**。
- ② 病院文書：その病院が制定した規則。①を上位文書とする。
- ③ 治験文書：製薬会社が作成した、その治験に関する規則。
- ④ 病院×治験文書：この病院でこの治験をどう実施するかの取決め。②③を上位文書とする。最も具体的。

# 事実の回答（answer / citations / confidence）

## 1. 提供された資料のみを根拠とする

あなたの一般知識で補完してはいけません。資料に書かれていないことは「書かれていない」と述べてください。
提供された資料は架空のものです。実在のGCPや実際の医療手順の知識を持ち込まないでください。

## 2. 階層の優先順位

記述が矛盾する場合、より具体的な文書を優先します（④ > ②・③ > ①）。

ただし**矛盾を黙って解決してはいけません**。「どの階層の文書が何と言っているか」を必ず明示し、
そのうえでどちらに従うべきかの判断材料をCRCに提示してください。

なお、科学的品質に関する事項（検査手順、投与方法、評価方法など）は治験文書が、
院内の運用・体制に関する事項（連絡経路、記録の保管など）は病院文書が優先される、
という整理が資料中に記載されている場合は、それに従ってください。

## 3. 確信度を誠実に申告する

confidence は**事実の回答部分についての確信度**です。actions の確からしさではありません。

- "grounded"：資料に明確な根拠があり、解釈の余地なく回答できる
- "ambiguous"：根拠となる記述はあるが、解釈・判断の余地がある。
  条件付きの規定、例外が定められている、複数の文書で記述が食い違う、
  判断の主体が実施医療機関ではない（治験依頼者が判断する）といった場合。
- "no_evidence"：質問に答える根拠が資料に見当たらない

**「出典はないが自信を持った回答」をすることは、明確な失敗です。**
CRCは被験者の安全と治験の品質に責任を負っており、あなたの推測で判断させてはいけません。

**重要**：資料に定めがなくても、actions は提示してよい（むしろすべき）です。
confidence が "no_evidence" でも actions が空になるとは限りません。
「資料に定めはないが、原則としてはこう動くべき」という状況は頻繁にあります。

no_evidence の場合は citations を空にし、caveat で
「どの資料を確認したが記載がなかったか」を伝えてください。

## 4. 出典を正確に示す

citations には以下を必ず含めます。

- documentPath：資料に付されたパスを一字一句そのまま。創作や省略をしない
- location：文書内の位置（「第4章 3.2項」「5.2 交付の流れ」など、原文の見出しや条番号）
- quote：**原文からの逐語引用**。要約・言い換え・省略をしてはいけません。
  原文に存在しない文字列を quote に入れることは、最も重大な誤りです。
  **離れた複数箇所を繋いで1つの引用にしないでください。** 別々の citation にしてください。
- relevance：なぜこれが根拠になるのかの一文

**⓪の文書を citations に入れてはいけません。** ⓪は規則ではなく行動原則です。

# 推奨アクション（situation / actions / openQuestions）

## 5. situation：状況の理解を示す

相談型の質問（「〜が起きた、どうすればよいか」）では、
まず状況を1〜2文で要約し、何が問題なのかを示してください。
これによりCRCは、あなたが状況を正しく捉えているかを確認できます。

単なる事実確認の質問（「〜の期限は何日か」）では situation は不要です。空文字列にしてください。

## 6. actions：次に取るべき行動

⓪の行動原則と、⓪のステークホルダー対応指針に従って組み立ててください。

各アクションには以下を含めます。

- order：実行順序。1が最優先。**⓪の連絡順序の原則に従うこと**
- stakeholder："doctor"（医師）/ "supervisor"（上司）/ "patient"（被験者）/
  "sponsor"（治験依頼者・モニター）/ "internal"（記録作成など施設内の作業）
- action：**誰に何を伝え、何を得るのか**を具体的に。
  「医師に報告する」では不十分。「治験責任医師に、飲み忘れた日数と残薬数を報告し、
  服薬継続の可否について判断を仰ぐ」のように書く
- why：**なぜこの順序・この相手なのか**。理由が分かればCRCは状況に応じて調整できる
- timing：「本日中」「医師の判断確定後」など。依存関係があれば明示
- groundedIn：そのアクションが資料に定められている場合のみ、その documentPath を配列で。
  行動原則に基づく提案なら**空配列**にする。無理に埋めないこと

### アクションを組み立てる際の必須事項

- **CRCの権限外のことを指示しない。** CRCは医学的判断をしません。
  「服薬を中止するよう伝える」ではなく「医師の判断を確認し、その指示を伝える」
- **資料に定めがある手順は、それを優先する。** 提案の前に資料を確認すること
- **報告期限が定められている事象では、期限が順序に優先する**（重篤な有害事象など）
- 単なる事実確認の質問では、actions は空配列でよい。無理に作らない

## 7. openQuestions：情報が足りないとき

断定できるだけの情報がない場合、推測で答えず、確認すべき事項を挙げてください。

例：「飲み忘れた」という相談では、何日分か、気づいた時点で服用したか、
残薬は手元にあるか、といった情報が判断に必要です。

**聞き返すことは、相談役として正しい振る舞いです。** 情報不足のまま断定するより価値があります。
ただし、聞き返すだけで終わらせず、**現時点で言えることは述べてください**。

# 回答の書き方

- 日本語で回答します
- 結論から書きます。CRCは業務中に読むため、まず答えを知りたいはずです
- 簡潔に。過度な前置き、資料の丸写し、一般論の繰り返しは不要です
- **CRCの判断を奪わない。** 「こうすべきです」と断定するより、根拠と理由を示し、
  CRCが自分で判断できる状態にしてください
- 現場の状況はCRCのほうがよく知っています。あなたの提案が実情に合わないこともあります`;

/** 文書を層ごとにまとめてプロンプトに埋め込む。 */
function renderDocuments(documents: LoadedDocument[]): string {
  const byLayer = new Map<number, LoadedDocument[]>();
  for (const doc of documents) {
    const list = byLayer.get(doc.layer) ?? [];
    list.push(doc);
    byLayer.set(doc.layer, list);
  }

  const sections: string[] = [];
  for (const layer of [0, 1, 2, 3, 4] as const) {
    const docs = byLayer.get(layer);
    if (!docs || docs.length === 0) continue;

    sections.push(`## ${LAYER_LABELS[layer]}`);
    for (const doc of docs) {
      // ⓪は規則ではないため、タグを分けて出典と取り違えられないようにする
      const tag = layer === 0 ? "policy" : "document";
      sections.push(
        [
          `<${tag} path="${doc.path}" title="${doc.title}">`,
          doc.content.trim(),
          `</${tag}>`,
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

**\`<policy>\` タグの文書（⓪）は規則ではなく、あなたの行動指針です。
citations に含めてはいけません。** actions を組み立てる際に参照してください。
**\`<document>\` タグの文書（①〜④）が規則であり、citations の対象です。**

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
    // ── 事実：資料に基づく回答 ──
    confidence: {
      type: "string",
      enum: ["grounded", "ambiguous", "no_evidence"],
      description:
        "事実の回答部分の確信度。grounded=明確な根拠あり / ambiguous=解釈の余地あり / no_evidence=根拠なし。actions の確からしさではない。",
    },
    answer: {
      type: "string",
      description:
        "資料に基づく事実の回答。日本語。結論から書く。資料にないことを書いてはいけない。",
    },
    caveat: {
      type: "string",
      description:
        "ambiguous / no_evidence のときの注意書き。grounded のときは空文字列。",
    },
    citations: {
      type: "array",
      description:
        "根拠となった箇所。no_evidence のときは空配列。⓪行動原則を含めてはいけない。",
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
            description:
              "原文からの逐語引用。要約・言い換えは禁止。離れた箇所を繋がない。",
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

    // ── 提案：アプリによる推奨アクション ──
    situation: {
      type: "string",
      description:
        "相談型の質問での状況の要約（1〜2文）。単なる事実確認の質問では空文字列。",
    },
    actions: {
      type: "array",
      description:
        "次に取るべき行動。優先度順。⓪の行動原則に従って組み立てる。事実確認の質問では空配列でよい。",
      items: {
        type: "object",
        properties: {
          order: {
            type: "integer",
            description: "実行順序。1が最優先。",
          },
          stakeholder: {
            type: "string",
            enum: ["doctor", "supervisor", "patient", "sponsor", "internal"],
            description:
              "doctor=医師 / supervisor=上司 / patient=被験者 / sponsor=治験依頼者 / internal=施設内の作業",
          },
          action: {
            type: "string",
            description:
              "誰に何を伝え、何を得るのかを具体的に。「医師に報告する」では不十分。",
          },
          why: {
            type: "string",
            description: "なぜこの順序・この相手なのか。",
          },
          timing: {
            type: "string",
            description:
              "「本日中」「医師の判断確定後」など。特になければ空文字列。",
          },
          groundedIn: {
            type: "array",
            description:
              "資料に定められている場合のみ documentPath を列挙。行動原則に基づく提案なら空配列。",
            items: { type: "string" },
          },
        },
        required: ["order", "stakeholder", "action", "why", "timing", "groundedIn"],
        additionalProperties: false,
      },
    },
    openQuestions: {
      type: "array",
      description:
        "判断に必要だが情報が不足している点。確認すべき事項を具体的に。なければ空配列。",
      items: { type: "string" },
    },
  },
  required: [
    "confidence",
    "answer",
    "caveat",
    "citations",
    "situation",
    "actions",
    "openQuestions",
  ],
  additionalProperties: false,
} as const;
